import hashlib
import json


def make_document(result, recorded_at) -> bytes:
    obj = {"schema": "yokoten-doctor/1", "recorded_at": recorded_at, "result": result}
    text = json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False)
    text = text + "\n"
    return text.encode("utf-8")


def document_hash(document) -> str:
    return hashlib.sha256(document).hexdigest()


def record_key(owner, repo, commit, version) -> str:
    return f"record:{owner}/{repo}@{commit}@{version}".lower()


def memo_text(owner, repo, commit, version, sha256) -> str:
    obj = {
        "app": "yokoten-doctor/1",
        "commit": commit,
        "repo": f"{owner}/{repo}",
        "sha256": sha256,
        "yokoten": version,
    }
    text = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    if len(text.encode("utf-8")) > 500:
        raise ValueError("memo too long")
    return text


def make_report_document(report, check_sha256, recorded_at) -> bytes:
    obj = {"schema": "yokoten-doctor-report/1", "recorded_at": recorded_at, "check_sha256": check_sha256, "report": report}
    text = json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False)
    text = text + "\n"
    return text.encode("utf-8")


def report_record_key(owner, repo, commit, cw_version) -> str:
    return f"report-record:{owner}/{repo}@{commit}@{cw_version}".lower()


def report_memo_text(owner, repo, commit, cw_version, sha256, check_sha256) -> str:
    obj = {
        "app": "yokoten-doctor-report/1",
        "check": check_sha256 or "",
        "commit": commit,
        "cw": cw_version,
        "repo": f"{owner}/{repo}",
        "sha256": sha256,
    }
    text = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    if len(text.encode("utf-8")) > 500:
        raise ValueError("memo too long")
    return text
