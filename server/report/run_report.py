import io
import json
import logging
import os
import pathlib
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import modal

logger = logging.getLogger(__name__)

CW_VERSION = "0.4.0"
QUESTION = "What should an AI coding agent know about this repo before it changes it? Rank the risks."
MAX_TARBALL = 40 * 1024 * 1024
MAX_FILES = 6000
MAX_TOTAL = 120 * 1024 * 1024

HERE = pathlib.Path(__file__).parent

report_image = modal.Image.from_registry("node:22-slim", add_python="3.12").apt_install("ca-certificates").run_commands(f"npm install -g cool-workflow@{CW_VERSION}")


class ReportFailed(Exception):
    pass


def safe_extract(data: bytes, dest: pathlib.Path) -> int:
    dest.mkdir(parents=True, exist_ok=True)
    dest_resolved = dest.resolve()
    total = 0
    count = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar:
            name = member.name
            if name.startswith("/"):
                continue
            parts = name.split("/")
            if len(parts) <= 1:
                continue
            rest = "/".join(parts[1:])
            if not rest:
                continue
            if rest.startswith("/"):
                continue
            segs = rest.split("/")
            if ".." in segs:
                continue
            if member.size > 5 * 1024 * 1024:
                continue
            if not (member.isreg() or member.isdir()):
                continue
            target = dest / rest
            try:
                resolved = target.resolve()
                resolved.relative_to(dest_resolved)
            except Exception:
                continue
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if count >= MAX_FILES:
                raise ReportFailed("too big")
            if total + member.size > MAX_TOTAL:
                raise ReportFailed("too big")
            target.parent.mkdir(parents=True, exist_ok=True)
            f = tar.extractfile(member)
            if f is None:
                continue
            with open(target, "wb") as out:
                shutil.copyfileobj(f, out)
            count += 1
            total += member.size
            if count > MAX_FILES:
                raise ReportFailed("too big")
            if total > MAX_TOTAL:
                raise ReportFailed("too big")
    return count


def parse_verdict(text: str) -> dict:
    pat = re.compile(r"```cw:result[^\n]*\n(.*?)\n```", re.DOTALL)
    matches = list(pat.finditer(text))
    if not matches:
        raise ReportFailed("no result")
    body = matches[-1].group(1)
    try:
        data = json.loads(body)
    except Exception:
        raise ReportFailed("no result")
    if not isinstance(data, dict):
        raise ReportFailed("no result")
    summary_raw = data.get("summary")
    summary = summary_raw if isinstance(summary_raw, str) else ""
    summary = summary[:1200]
    findings_raw = data.get("findings")
    if not isinstance(findings_raw, list):
        findings_raw = []
    order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    kept = []
    for f in findings_raw:
        if not isinstance(f, dict):
            continue
        title = f.get("title")
        severity = f.get("severity")
        if not isinstance(title, str) or not isinstance(severity, str):
            continue
        if severity not in order:
            continue
        kept.append(f)
    kept.sort(key=lambda x: order[x["severity"]])
    kept = kept[:20]
    out = []
    ev_pat = re.compile(r"^[A-Za-z0-9_.@+/-]{1,200}:[0-9]{1,6}$")
    for f in kept:
        title = f.get("title", "")
        title = title[:200] if isinstance(title, str) else ""
        severity = f["severity"]
        cls = f.get("classification")
        if cls not in ("real", "conditional", "non-issue", "unknown"):
            cls = "unknown"
        evidence_raw = f.get("evidence")
        if not isinstance(evidence_raw, list):
            evidence_raw = []
        evidence = []
        for e in evidence_raw:
            if not isinstance(e, str):
                continue
            if len(evidence) >= 8:
                break
            if not ev_pat.match(e):
                continue
            if e.startswith("/") or e.startswith(".cw/"):
                continue
            if ".." in e:
                continue
            evidence.append(e)
        out.append({"severity": severity, "title": title, "classification": cls, "evidence": evidence})
    return {"summary": summary, "findings": out}


def scrub(text: str, root: str) -> str:
    if root:
        text = text.replace(root + "/", "")
        text = text.replace(root, "")
    return re.sub(r"/tmp/[^\s`'\")]*", "", text)


def latest_run(repo_dir: pathlib.Path) -> pathlib.Path:
    runs_dir = repo_dir / ".cw" / "runs"
    if not runs_dir.is_dir():
        raise ReportFailed("no run")
    entries = [p for p in runs_dir.iterdir() if p.is_dir()]
    if not entries:
        raise ReportFailed("no run")
    entries.sort(key=lambda p: p.name)
    return entries[-1]


def make_report(owner: str, repo: str, commit: str, fetch=None, run=None) -> dict:
    if fetch is None:
        def _fetch(o, r, c):
            url = f"https://codeload.github.com/{o}/{r}/tar.gz/{c}"
            req = urllib.request.Request(url, headers={"User-Agent": "yokoten-doctor"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read(MAX_TARBALL + 1)
                if len(data) > MAX_TARBALL:
                    raise ReportFailed("too big")
                return data
        fetch = _fetch
    if run is None:
        def _run(cmd, env=None, cwd=None, timeout=None, capture_output=None):
            return subprocess.run(cmd, env=env, cwd=cwd, timeout=timeout, capture_output=capture_output)
        run = _run
    work = tempfile.mkdtemp(prefix="cw-")
    work_path = pathlib.Path(work)
    repo_dir = work_path / "repo"
    key_path = pathlib.Path("/tmp/cw-key/key")
    try:
        api_key = os.environ.get("BASETEN_API_KEY")
        if not api_key:
            raise ReportFailed("no key")
        key_dir = key_path.parent
        key_dir.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(key_dir, 0o700)
        except Exception:
            pass
        fd = os.open(str(key_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, api_key.encode("utf-8"))
        finally:
            os.close(fd)
        data = fetch(owner, repo, commit)
        safe_extract(data, repo_dir)
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": work,
            "CW_HOME": str(work_path / "cw-home"),
            "CW_AGENT_COMMAND": "node /root/report/muse_agent.mjs {{input}} {{result}}",
            "NO_COLOR": "1",
            "CI": "1",
        }
        cmd = ["cw", "-q", QUESTION, "-r", str(repo_dir), "--fast", "--no-color", "--quiet"]
        run(cmd, env=env, cwd=work, timeout=840, capture_output=True)
        run_dir = latest_run(repo_dir)
        result_file = run_dir / "results" / "verdict:fast-synthesis.md"
        if not result_file.is_file():
            raise ReportFailed("no result")
        text = result_file.read_text(encoding="utf-8", errors="ignore")
        parsed = parse_verdict(text)
        markdown = scrub(text, str(repo_dir))[:60000]
        return {"status": "done", "owner": owner, "repo": repo, "commit": commit, "cw_version": CW_VERSION, "model": "muse-spark-open-1026", "summary": parsed["summary"], "findings": parsed["findings"], "markdown": markdown}
    except Exception as e:
        try:
            logging.getLogger(__name__).error(type(e).__name__)
        except Exception:
            pass
        raise
    finally:
        try:
            if key_path.exists():
                key_path.unlink()
        except Exception:
            pass
        try:
            shutil.rmtree(work, ignore_errors=True)
        except Exception:
            pass
