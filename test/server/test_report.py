import io
import json
import pathlib
import tarfile
import time
import hashlib
from fastapi.testclient import TestClient
import pytest
from app import create_api, RateLimiter, ReportLimiter, REPORT_BAD, REPORT_OFF, REPORT_FAILED, report_key
from report.run_report import safe_extract, parse_verdict, scrub, make_report, ReportFailed, CW_VERSION, MAX_FILES


class DictStore:
    def __init__(self):
        self.d = {}
    def get(self, key, default=None):
        return self.d.get(key, default)
    def put(self, key, value):
        self.d[key] = value
    def pop(self, key, default=None):
        return self.d.pop(key, default)
    def __contains__(self, key):
        return key in self.d


def test_safe_extract_normal_file_lands():
    dest = pathlib.Path("/tmp/test_extract_ok")
    import shutil
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True, exist_ok=True)
    bio = io.BytesIO()
    with tarfile.open(fileobj=bio, mode="w:gz") as tar:
        info = tarfile.TarInfo("repo-abc/a.txt")
        data = b"hello"
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    count = safe_extract(bio.getvalue(), dest)
    assert count == 1
    assert (dest / "a.txt").read_text() == "hello"
    shutil.rmtree(dest, ignore_errors=True)


def test_safe_extract_skips_bad_entries():
    dest = pathlib.Path("/tmp/test_extract_bad")
    import shutil
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True, exist_ok=True)
    bio = io.BytesIO()
    with tarfile.open(fileobj=bio, mode="w:gz") as tar:
        # normal file
        info = tarfile.TarInfo("repo-abc/ok.txt")
        data = b"ok"
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
        # symlink
        info2 = tarfile.TarInfo("repo-abc/link")
        info2.type = tarfile.SYMTYPE
        info2.linkname = "ok.txt"
        info2.size = 0
        tar.addfile(info2)
        # .. traversal
        info3 = tarfile.TarInfo("repo-abc/../evil")
        info3.size = 3
        tar.addfile(info3, io.BytesIO(b"evil"))
        # absolute
        info4 = tarfile.TarInfo("/etc/x")
        info4.size = 1
        tar.addfile(info4, io.BytesIO(b"x"))
        # big file >5MB (we simulate with size header, but not actually write 6MB to keep test fast; use 6MB size and dummy)
        info5 = tarfile.TarInfo("repo-abc/big.bin")
        info5.size = 6 * 1024 * 1024
        tar.addfile(info5, io.BytesIO(b"0" * (6 * 1024 * 1024)))
    count = safe_extract(bio.getvalue(), dest)
    assert count == 1
    assert (dest / "ok.txt").exists()
    assert not (dest / "evil").exists()
    shutil.rmtree(dest, ignore_errors=True)


def test_safe_extract_too_many_files_raises():
    import report.run_report as rr
    orig = rr.MAX_FILES
    rr.MAX_FILES = 3
    try:
        dest = pathlib.Path("/tmp/test_extract_many")
        import shutil
        shutil.rmtree(dest, ignore_errors=True)
        dest.mkdir(parents=True, exist_ok=True)
        bio = io.BytesIO()
        with tarfile.open(fileobj=bio, mode="w:gz") as tar:
            for i in range(5):
                info = tarfile.TarInfo(f"repo-abc/{i}.txt")
                d = b"x"
                info.size = len(d)
                tar.addfile(info, io.BytesIO(d))
        try:
            safe_extract(bio.getvalue(), dest)
            assert False, "should have raised"
        except ReportFailed as e:
            assert str(e) == "too big"
        shutil.rmtree(dest, ignore_errors=True)
    finally:
        rr.MAX_FILES = orig


def test_parse_verdict_last_block_wins_sorted_capped():
    block1 = "```cw:result\n" + json.dumps({"summary": "first", "findings": [{"title": "a", "severity": "P2", "classification": "real", "evidence": []}]}) + "\n```"
    block2 = "```cw:result\n" + json.dumps({"summary": "second", "findings": [{"title": "b", "severity": "P0", "classification": "real", "evidence": ["lib/a.js:12"]}, {"title": "c", "severity": "P1", "classification": "real", "evidence": []}]}) + "\n```"
    text = block1 + "\n" + block2
    out = parse_verdict(text)
    assert out["summary"] == "second"
    assert out["findings"][0]["severity"] == "P0"
    assert out["findings"][1]["severity"] == "P1"


def test_parse_verdict_capped_20_and_bad_severity_dropped():
    findings = []
    for i in range(25):
        findings.append({"title": f"t{i}", "severity": "P0", "classification": "real", "evidence": []})
    findings.append({"title": "bad", "severity": "P5", "classification": "real", "evidence": []})
    body = json.dumps({"summary": "s", "findings": findings})
    text = "```cw:result\n" + body + "\n```"
    out = parse_verdict(text)
    assert len(out["findings"]) == 20
    assert all(f["severity"] == "P0" for f in out["findings"])


def test_parse_verdict_evidence_filtering():
    findings = [{"title": "t", "severity": "P0", "classification": "real", "evidence": ["lib/a.js:12", "/etc/passwd:1", ".cw/runs/x.md:3", "../a.js:1", "lib/a.js"]}]
    body = json.dumps({"summary": "s", "findings": findings})
    text = "```cw:result\n" + body + "\n```"
    out = parse_verdict(text)
    assert out["findings"][0]["evidence"] == ["lib/a.js:12"]


def test_parse_verdict_no_block_raises():
    try:
        parse_verdict("no block here")
        assert False
    except ReportFailed as e:
        assert str(e) == "no result"


def test_scrub_removes_root_and_tmp():
    root = "/tmp/work123/repo"
    text = f"file at {root}/a.txt and {root} plus /tmp/other/path and /tmp/secret"
    out = scrub(text, root)
    assert root not in out
    assert "/tmp/other" not in out
    assert "a.txt" in out


def test_make_report_with_fake_fetch_and_run():
    import os, shutil, pathlib, io, tarfile, json
    commit = "a"*40
    owner = "owner"
    repo = "repo"
    # build tarball
    bio = io.BytesIO()
    with tarfile.open(fileobj=bio, mode="w:gz") as tar:
        info = tarfile.TarInfo("repo-abc/file.txt")
        d = b"hello"
        info.size = len(d)
        tar.addfile(info, io.BytesIO(d))
    tar_data = bio.getvalue()
    def fake_fetch(o, r, c):
        assert o == owner and r == repo and c == commit
        return tar_data
    captured_env = {}
    def fake_run(cmd, env=None, cwd=None, timeout=None, capture_output=None):
        captured_env.update(env or {})
        # check env keys
        assert set(env.keys()) == {"PATH", "HOME", "CW_HOME", "CW_AGENT_COMMAND", "NO_COLOR", "CI"}
        assert "BASETEN_API_KEY" not in env
        repo_dir = pathlib.Path(env["CW_HOME"]).parent / "repo"
        # cwd is work dir
        work = pathlib.Path(cwd)
        repo_dir2 = work / "repo"
        run_dir = repo_dir2 / ".cw" / "runs" / "r1" / "results"
        run_dir.mkdir(parents=True, exist_ok=True)
        verdict = "# hi\n```cw:result\n" + json.dumps({"summary": "my summary", "findings": [{"title": "risk", "severity": "P1", "classification": "real", "evidence": ["file.txt:1"]}]}) + "\n```"
        (run_dir / "verdict:fast-synthesis.md").write_text(verdict)
        class R:
            returncode = 0
        return R()
    os.environ["BASETEN_API_KEY"] = "secret123"
    orig_env = os.environ.get("PATH")
    result = make_report(owner, repo, commit, fetch=fake_fetch, run=fake_run)
    assert result["status"] == "done"
    assert result["summary"] == "my summary"
    assert len(result["findings"]) == 1
    assert not pathlib.Path("/tmp/cw-key/key").exists()
    assert captured_env["CW_AGENT_COMMAND"] == "node /root/report/muse_agent.mjs {{input}} {{result}}"


def test_make_report_no_key_raises():
    import os
    if "BASETEN_API_KEY" in os.environ:
        del os.environ["BASETEN_API_KEY"]
    try:
        make_report("o", "r", "a"*40, fetch=lambda o,r,c: b"", run=lambda *a, **k: None)
        assert False
    except ReportFailed as e:
        assert str(e) == "no key"
    finally:
        os.environ["BASETEN_API_KEY"] = "test"


def test_parse_verdict_conditional_capped_to_p2():
    findings = [
        {"title": "conditional p0", "severity": "P0", "classification": "conditional", "evidence": []},
        {"title": "conditional p1", "severity": "P1", "classification": "conditional", "evidence": []},
        {"title": "real p1", "severity": "P1", "classification": "real", "evidence": []},
    ]
    body = json.dumps({"summary": "s", "findings": findings})
    text = "```cw:result\n" + body + "\n```"
    out = parse_verdict(text)
    assert [f["severity"] for f in out["findings"]] == ["P1", "P2", "P2"]


def test_api_bad_commit_400():
    store = DictStore()
    api = create_api(public=lambda o,r: None, start_report=lambda o,r,c: "id", report_store=store, report_limiter=ReportLimiter(store))
    client = TestClient(api)
    resp = client.post("/api/report", json={"owner": "owner", "repo": "repo", "commit": "bad"})
    assert resp.status_code == 400
    assert resp.json()["message"] == REPORT_BAD


def test_api_no_store_503():
    api = create_api(public=lambda o,r: None)
    client = TestClient(api)
    resp = client.post("/api/report", json={"owner": "owner", "repo": "repo", "commit": "a"*40})
    assert resp.status_code == 503


def test_api_cached_done_200():
    store = DictStore()
    key = report_key("owner", "repo", "a"*40)
    done = {"status": "done", "summary": "s", "findings": []}
    store.put(key, done)
    api = create_api(public=lambda o,r: None, start_report=lambda o,r,c: "id", report_store=store)
    client = TestClient(api)
    resp = client.post("/api/report", json={"owner": "owner", "repo": "repo", "commit": "a"*40})
    assert resp.status_code == 200
    assert resp.json() == done


def test_api_start_makes_202_and_stores_working():
    store = DictStore()
    api = create_api(public=lambda o,r: None, start_report=lambda o,r,c: "call123", report_store=store, report_limiter=ReportLimiter(store))
    client = TestClient(api)
    resp = client.post("/api/report", json={"owner": "owner", "repo": "repo", "commit": "a"*40})
    assert resp.status_code == 202
    assert resp.json()["status"] == "working"
    key = report_key("owner", "repo", "a"*40)
    assert store.get(key)["status"] == "working"
    assert store.get(key)["call_id"] == "call123"


def test_api_ip_limit_429():
    store = DictStore()
    class LimitIP:
        def allow(self, ip):
            return "ip"
    api = create_api(public=lambda o,r: None, start_report=lambda o,r,c: "id", report_store=store, report_limiter=LimitIP())
    client = TestClient(api)
    resp = client.post("/api/report", json={"owner": "owner", "repo": "repo", "commit": "a"*40})
    assert resp.status_code == 429


def test_api_ip_limit_does_not_call_public():
    store = DictStore()
    class LimitIP:
        def allow(self, ip):
            return "ip"
    calls = []
    def public_fake(o, r):
        calls.append((o, r))
    api = create_api(public=public_fake, start_report=lambda o,r,c: "id", report_store=store, report_limiter=LimitIP())
    client = TestClient(api)
    resp = client.post("/api/report", json={"owner": "owner", "repo": "repo", "commit": "a"*40})
    assert resp.status_code == 429
    assert calls == []


def test_api_get_no_entry_404():
    store = DictStore()
    api = create_api(public=lambda o,r: None, report_store=store)
    client = TestClient(api)
    resp = client.get("/api/report", params={"owner": "owner", "repo": "repo", "commit": "a"*40})
    assert resp.status_code == 404
    assert resp.json()["status"] == "none"


def test_api_get_working_poll_done_stores_and_200():
    store = DictStore()
    key = report_key("owner", "repo", "a"*40)
    store.put(key, {"status": "working", "call_id": "cid", "started": time.time()})
    done = {"status": "done", "owner": "owner", "repo": "repo", "commit": "a"*40, "summary": "s", "findings": []}
    api = create_api(public=lambda o,r: None, report_store=store, poll_report=lambda cid: done)
    client = TestClient(api)
    resp = client.get("/api/report", params={"owner": "owner", "repo": "repo", "commit": "a"*40})
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"
    assert store.get(key)["status"] == "done"


def test_api_get_poll_raising_gives_failed_and_removes():
    store = DictStore()
    key = report_key("owner", "repo", "a"*40)
    store.put(key, {"status": "working", "call_id": "cid", "started": time.time()})
    def bad_poll(cid):
        raise RuntimeError("fail")
    api = create_api(public=lambda o,r: None, report_store=store, poll_report=bad_poll)
    client = TestClient(api)
    resp = client.get("/api/report", params={"owner": "owner", "repo": "repo", "commit": "a"*40})
    assert resp.status_code == 200
    assert resp.json()["status"] == "failed"
    assert key not in store.d


def test_api_get_expired_gives_failed():
    store = DictStore()
    key = report_key("owner", "repo", "a"*40)
    store.put(key, {"status": "working", "call_id": "cid", "started": time.time() - 1000})
    api = create_api(public=lambda o,r: None, report_store=store, poll_report=lambda cid: None)
    client = TestClient(api)
    resp = client.get("/api/report", params={"owner": "owner", "repo": "repo", "commit": "a"*40})
    assert resp.status_code == 200
    assert resp.json()["status"] == "failed"


def test_existing_check_keys_unchanged():
    store = DictStore()
    limiter = RateLimiter(store)
    limiter.allow("192.0.2.1")
    assert any(k.startswith("limit:day:") for k in store.d.keys())
    assert any(k.startswith("limit:ip:") for k in store.d.keys())
    assert not any(k.startswith("report:") for k in store.d.keys())


def test_report_key_format():
    k = report_key("O", "R", "a" * 40)
    assert k.endswith("@r4")
    assert k == k.lower()
