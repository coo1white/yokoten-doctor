import hashlib
import json
import logging
import pathlib
import queue
import re
import threading
import time
from typing import Callable
from check.github_check import RepoRefused
from check.github_check import check_public as _check_public_default
from check.repo_url import BadRepoUrl
from check.repo_url import parse_repo_url as _parse_repo_url_default
from check.result import summarize as _summarize_default
from check.sandbox_run import run_in_sandbox
from check.sandbox_run import YOKOTEN_VERSION
from fixes.build import build_fixes
from record.document import record_key
from report.run_report import CW_VERSION, report_image, make_report
import modal
import modal.exception
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

logger = logging.getLogger(__name__)

ALLOWED_ORIGINS = ["https://doctor.yokoten.app", "http://localhost:8000"]
GENERIC_ERROR = "The check couldn't finish. Try again in a minute."
BAD_URL_MSG = "That doesn't look like a public GitHub repo. Try https://github.com/owner/repo."
NO_FIXES = {"files": [], "summary": "", "muse": "failed", "claude_import": None}
REPORT_BAD = "Run a check first, then ask for the report."
REPORT_OFF = "Reports are off right now. Try again later."
REPORT_FAILED = "The report couldn't finish. Try again in a few minutes."
REPORT_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
REPORT_COMMIT = re.compile(r"^[0-9a-f]{40}$")


def report_key(owner, repo, commit):
    return f"report:{owner}/{repo}@{commit}@{CW_VERSION}@r2".lower()


HERE = pathlib.Path(__file__).parent

web_image = (
    modal.Image.debian_slim().pip_install("fastapi==0.162.0", "modal==1.6.3", "cryptography==50.0.2")
    .add_local_dir(HERE / "check", "/root/check")
    .add_local_dir(HERE / "fixes", "/root/fixes")
    .add_local_dir(HERE / "record", "/root/record")
    .add_local_dir(HERE / "report", "/root/report")
)

job_image = (
    report_image.pip_install("fastapi==0.162.0", "cryptography==50.0.2")
    .add_local_dir(HERE / "check", "/root/check")
    .add_local_dir(HERE / "fixes", "/root/fixes")
    .add_local_dir(HERE / "record", "/root/record")
    .add_local_dir(HERE / "report", "/root/report")
)

app = modal.App("yokoten-doctor")


class RateLimiter:
    HOURLY_LIMIT_PER_IP = 10
    DAILY_LIMIT_TOTAL = 300
    PREFIX = "limit"

    def __init__(self, store, now=time.time):
        self.store = store
        self.now = now

    def _read_count(self, key: str) -> int:
        count = self.store.get(key, 0)
        if count is None:
            return 0
        return count

    def allow(self, client_ip) -> str:
        try:
            current_time = self.now()
            day_number = int(current_time // 86400)
            hour_number = int(current_time // 3600)
            day_key = f"{self.PREFIX}:day:{day_number}"
            day_count = self._read_count(day_key)
            if day_count >= self.DAILY_LIMIT_TOTAL:
                return "day"
            ip_hash = hashlib.sha256(client_ip.encode("utf-8")).hexdigest()[:16]
            hour_key = f"{self.PREFIX}:ip:{ip_hash}:{hour_number}"
            ip_count = self._read_count(hour_key)
            if ip_count >= self.HOURLY_LIMIT_PER_IP:
                return "ip"
            try:
                self.store.put(day_key, day_count + 1)
            except Exception:
                raise
            try:
                self.store.put(hour_key, ip_count + 1)
            except Exception:
                raise
            return "ok"
        except Exception as error:
            logger.error(type(error).__name__)
            return "ok"


class ReportLimiter(RateLimiter):
    HOURLY_LIMIT_PER_IP = 3
    DAILY_LIMIT_TOTAL = 40
    PREFIX = "report"


def open_cache():
    try:
        return modal.Dict.from_name("yokoten-doctor-cache", create_if_missing=True)
    except Exception:
        return None


def build_result(res) -> dict:
    doctor = res.get("doctor", {})
    check_data = res.get("check", {})
    summary = _summarize_default(doctor)
    findings = []
    if isinstance(check_data, dict):
        findings = check_data.get("findings", []) or []
    secrets = []
    allowed = {"id", "what", "file", "line", "grade", "why", "fix"}
    for finding in findings:
        if not isinstance(finding, dict):
            continue
        if finding.get("id") == "layout":
            continue
        secrets.append({key: finding.get(key) for key in allowed})
    return {
        "owner": res.get("owner"),
        "repo": res.get("repo"),
        "commit": res.get("commit"),
        "yokoten_version": res.get("yokoten_version"),
        "about": res.get("about", ""),
        "rerun": res.get("rerun"),
        "summary": summary,
        "secrets": secrets,
    }


def build_result_event(res) -> dict:
    payload = build_result(res)
    payload["default_branch"] = res.get("branch") if isinstance(res, dict) else None
    return payload


def create_api(run: Callable = run_in_sandbox, public: Callable = _check_public_default, make_fixes=None, limiter=None, write_public_record=None, start_report=None, report_store=None, report_limiter=None, poll_report=None):  # type: ignore
    if make_fixes is None:
        def _default_make_fixes(result):
            cache = open_cache()
            return build_fixes(result, cache=cache)
        make_fixes = _default_make_fixes
    api = FastAPI()
    api.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
        allow_credentials=False,
    )

    @api.get("/api/health")
    def health():
        return {"ok": True}

    @api.post("/api/check")
    async def check(request: Request):
        body_bytes = await request.body()
        def sse_event(name: str, data: dict):
            return f"event: {name}\ndata: {json.dumps(data)}\n\n"
        def error_generator(message: str):
            def gen():
                yield sse_event("error", {"message": message})
            return StreamingResponse(gen(), media_type="text/event-stream")
        if len(body_bytes) > 2048:
            return error_generator(BAD_URL_MSG)
        try:
            payload = json.loads(body_bytes.decode("utf-8") if body_bytes else "{}")
        except Exception:
            return error_generator(BAD_URL_MSG)
        url_value = payload.get("url") if isinstance(payload, dict) else None
        if not isinstance(url_value, str):
            url_value = ""
        if len(url_value) > 300:
            return error_generator(BAD_URL_MSG)
        def gen():
            yield sse_event("progress", {"step": "reading"})
            try:
                owner, repo = _parse_repo_url_default(url_value)
            except (BadRepoUrl, RepoRefused) as error:
                yield sse_event("error", {"message": str(error)})
                return
            except Exception:
                logger.exception("check failed reading")
                yield sse_event("error", {"message": GENERIC_ERROR})
                return
            if limiter is not None:
                try:
                    client_ip = request.client.host if request.client else ""
                except Exception:
                    client_ip = ""
                decision = limiter.allow(client_ip)
                if decision == "ip":
                    yield sse_event(
                        "error",
                        {"message": "10 checks this hour is the limit. Try later, or run it on your machine: npx yokoten"},
                    )
                    return
                if decision == "day":
                    yield sse_event(
                        "error",
                        {"message": "This page is at its daily limit. Try tomorrow, or run it on your machine: npx yokoten"},
                    )
                    return
            try:
                public(owner, repo)
            except (BadRepoUrl, RepoRefused) as error:
                yield sse_event("error", {"message": str(error)})
                return
            except Exception:
                logger.exception("check failed reading")
                yield sse_event("error", {"message": GENERIC_ERROR})
                return
            event_queue: queue.Queue = queue.Queue()
            def on_progress(step: str):
                try:
                    event_queue.put(("progress", step))
                except Exception:
                    pass
            def worker():
                try:
                    result = run(owner, repo, on_progress=on_progress)  # type: ignore
                    event_queue.put(("done", result))
                    try:
                        fixes_output = make_fixes(result)
                        event_queue.put(("fixes", fixes_output))
                    except Exception as error:
                        logger.error(type(error).__name__)
                        event_queue.put(("fixes", NO_FIXES))
                    if write_public_record is not None:
                        try:
                            payload_out = build_result_event(result)
                            record = write_public_record(payload_out)
                            event_queue.put(("record", record))
                        except Exception as error:
                            logger.error(type(error).__name__)
                            event_queue.put(("record", None))
                except (BadRepoUrl, RepoRefused) as error:
                    event_queue.put(("error_known", str(error)))
                except Exception:
                    logger.exception("sandbox run failed")
                    event_queue.put(("error_generic", GENERIC_ERROR))
            thread = threading.Thread(target=worker, daemon=True)
            thread.start()
            start = time.monotonic()
            result_sent = False
            fixes_sent = False
            while True:
                elapsed = time.monotonic() - start
                remaining = 170 - elapsed
                if remaining <= 0:
                    if not result_sent:
                        yield sse_event("error", {"message": GENERIC_ERROR})
                    elif result_sent and not fixes_sent:
                        yield sse_event("fixes", NO_FIXES)
                    return
                try:
                    item = event_queue.get(timeout=remaining)
                except queue.Empty:
                    if not result_sent:
                        yield sse_event("error", {"message": GENERIC_ERROR})
                    elif result_sent and not fixes_sent:
                        yield sse_event("fixes", NO_FIXES)
                    return
                kind = item[0]
                if kind == "progress":
                    yield sse_event("progress", {"step": item[1]})
                elif kind == "done":
                    try:
                        payload_out = build_result_event(item[1])
                        yield sse_event("result", payload_out)
                    except Exception:
                        logger.exception("building result failed")
                        yield sse_event("error", {"message": GENERIC_ERROR})
                        return
                    result_sent = True
                elif kind == "fixes":
                    yield sse_event("fixes", item[1])
                    fixes_sent = True
                    if write_public_record is None:
                        return
                elif kind == "record":
                    if item[1] is not None:
                        yield sse_event("record", item[1])
                    return
                elif kind == "error_known":
                    yield sse_event("error", {"message": item[1]})
                    return
                elif kind == "error_generic":
                    yield sse_event("error", {"message": item[1]})
                    return
        return StreamingResponse(gen(), media_type="text/event-stream")

    @api.post("/api/report")
    async def post_report(request: Request):
        body_bytes = await request.body()
        if len(body_bytes) > 1024:
            return JSONResponse(status_code=400, content={"status": "error", "message": REPORT_BAD})
        try:
            payload = json.loads(body_bytes.decode("utf-8") if body_bytes else "{}")
        except Exception:
            return JSONResponse(status_code=400, content={"status": "error", "message": REPORT_BAD})
        if not isinstance(payload, dict):
            return JSONResponse(status_code=400, content={"status": "error", "message": REPORT_BAD})
        owner = payload.get("owner")
        repo = payload.get("repo")
        commit = payload.get("commit")
        if not isinstance(owner, str) or not isinstance(repo, str) or not isinstance(commit, str):
            return JSONResponse(status_code=400, content={"status": "error", "message": REPORT_BAD})
        if not REPORT_NAME.match(owner) or not REPORT_NAME.match(repo) or not REPORT_COMMIT.match(commit):
            return JSONResponse(status_code=400, content={"status": "error", "message": REPORT_BAD})
        if report_store is None or start_report is None:
            return JSONResponse(status_code=503, content={"status": "error", "message": REPORT_OFF})
        key = report_key(owner, repo, commit)
        try:
            entry = report_store.get(key)
        except Exception:
            return JSONResponse(status_code=503, content={"status": "error", "message": REPORT_OFF})
        if isinstance(entry, dict):
            if entry.get("status") == "done":
                return JSONResponse(status_code=200, content=entry)
            if entry.get("status") == "working":
                started = entry.get("started")
                if isinstance(started, (int, float)):
                    if time.time() - started < 900:
                        return JSONResponse(status_code=200, content={"status": "working"})
        if report_limiter is not None:
            try:
                client_ip = request.client.host if request.client else ""
            except Exception:
                client_ip = ""
            decision = report_limiter.allow(client_ip)
            if decision == "ip":
                return JSONResponse(status_code=429, content={"status": "error", "message": "3 reports an hour is the limit. Try again later."})
            if decision == "day":
                return JSONResponse(status_code=429, content={"status": "error", "message": "This page made all its reports for today. Try tomorrow."})
        try:
            public(owner, repo)
        except (BadRepoUrl, RepoRefused) as error:
            return JSONResponse(status_code=400, content={"status": "error", "message": str(error)})
        except Exception:
            logger.error(type(error).__name__ if 'error' in locals() else "Exception")
            return JSONResponse(status_code=400, content={"status": "error", "message": REPORT_BAD})
        try:
            call_id = start_report(owner, repo, commit)
        except Exception as error:
            logger.error(type(error).__name__)
            return JSONResponse(status_code=200, content={"status": "failed", "message": REPORT_FAILED})
        working = {"status": "working", "call_id": call_id, "started": time.time()}
        try:
            report_store.put(key, working)
        except Exception:
            return JSONResponse(status_code=503, content={"status": "error", "message": REPORT_OFF})
        return JSONResponse(status_code=202, content={"status": "working"})

    @api.get("/api/report")
    async def get_report(request: Request):
        owner = request.query_params.get("owner")
        repo = request.query_params.get("repo")
        commit = request.query_params.get("commit")
        if not isinstance(owner, str) or not isinstance(repo, str) or not isinstance(commit, str):
            return JSONResponse(status_code=400, content={"status": "error", "message": REPORT_BAD})
        if not REPORT_NAME.match(owner) or not REPORT_NAME.match(repo) or not REPORT_COMMIT.match(commit):
            return JSONResponse(status_code=400, content={"status": "error", "message": REPORT_BAD})
        if report_store is None:
            return JSONResponse(status_code=503, content={"status": "error", "message": REPORT_OFF})
        key = report_key(owner, repo, commit)
        try:
            entry = report_store.get(key)
        except Exception:
            return JSONResponse(status_code=503, content={"status": "error", "message": REPORT_OFF})
        if entry is None:
            return JSONResponse(status_code=404, content={"status": "none"})
        if not isinstance(entry, dict):
            return JSONResponse(status_code=404, content={"status": "none"})
        if entry.get("status") == "done":
            return JSONResponse(status_code=200, content=entry)
        if entry.get("status") == "working":
            started = entry.get("started")
            is_expired = isinstance(started, (int, float)) and (time.time() - started >= 900)
            if is_expired:
                try:
                    report_store.pop(key, None)
                except Exception:
                    pass
                logger.error("TimeoutError")
                return JSONResponse(status_code=200, content={"status": "failed", "message": REPORT_FAILED})
            if poll_report is None:
                return JSONResponse(status_code=200, content={"status": "working"})
            try:
                result = poll_report(entry.get("call_id"))
            except Exception as error:
                logger.error(type(error).__name__)
                try:
                    report_store.pop(key, None)
                except Exception:
                    pass
                return JSONResponse(status_code=200, content={"status": "failed", "message": REPORT_FAILED})
            if isinstance(result, dict) and result.get("status") == "done":
                try:
                    report_store.put(key, result)
                except Exception:
                    return JSONResponse(status_code=503, content={"status": "error", "message": REPORT_OFF})
                return JSONResponse(status_code=200, content=result)
            if result is None:
                if isinstance(started, (int, float)) and (time.time() - started < 900):
                    return JSONResponse(status_code=200, content={"status": "working"})
                try:
                    report_store.pop(key, None)
                except Exception:
                    pass
                logger.error("TimeoutError")
                return JSONResponse(status_code=200, content={"status": "failed", "message": REPORT_FAILED})
            # anything else
            try:
                report_store.pop(key, None)
            except Exception:
                pass
            logger.error(type(result).__name__ if result is not None else "Exception")
            return JSONResponse(status_code=200, content={"status": "failed", "message": REPORT_FAILED})
        # unknown status treat as failed
        try:
            report_store.pop(key, None)
        except Exception:
            pass
        return JSONResponse(status_code=200, content={"status": "failed", "message": REPORT_FAILED})
    return api


@app.function(image=job_image, timeout=900, max_containers=4, secrets=[modal.Secret.from_name("yokoten-doctor-baseten"), modal.Secret.from_name("yokoten-doctor-record")])
def report_job(owner: str, repo: str, commit: str) -> dict:
    result = make_report(owner, repo, commit)
    try:
        from record.write import write_report_record

        store = open_cache()
        check_sha256 = None
        if store is not None:
            check = store.get(record_key(owner, repo, commit, YOKOTEN_VERSION), None)
            if isinstance(check, dict) and isinstance(check.get("sha256"), str):
                check_sha256 = check["sha256"]
        result["record"] = write_report_record(result, check_sha256, store=store)
    except Exception as error:
        logger.error(type(error).__name__)
        result["record"] = None
    return result


@app.function(image=web_image, timeout=180, max_containers=3, secrets=[modal.Secret.from_name("yokoten-doctor-baseten"), modal.Secret.from_name("yokoten-doctor-record")])
@modal.concurrent(max_inputs=10)
@modal.asgi_app()
def fastapi_app():
    cache = open_cache()
    limiter = None
    if cache is not None:
        try:
            limiter = RateLimiter(cache)
        except Exception:
            limiter = None
    report_limiter = None
    if cache is not None:
        try:
            report_limiter = ReportLimiter(cache)
        except Exception:
            report_limiter = None

    def _write_public_record(result):
        from record.write import write_record
        return write_record(result, store=open_cache())

    def _poll_report(call_id):
        call = modal.FunctionCall.from_id(call_id)
        try:
            return call.get(timeout=0)
        except (TimeoutError, modal.exception.TimeoutError):
            return None
    return create_api(limiter=limiter, write_public_record=_write_public_record, start_report=lambda owner, repo, commit: report_job.spawn(owner, repo, commit).object_id, poll_report=_poll_report, report_store=cache, report_limiter=report_limiter)
