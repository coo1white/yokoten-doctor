import logging
import time

from .muse import PROMPT_ID, ask_muse as _ask_muse_default
from .select_files import fill_owner, merge_this_project

logger = logging.getLogger(__name__)


def muse_cache_key(owner, repo, commit, version) -> str:
    return f"{owner}/{repo}@{commit}@{version}@{PROMPT_ID}".lower()


def _claude_import_for(result, fix_files):
    try:
        has_agents = False
        if isinstance(fix_files, list):
            for f in fix_files:
                if isinstance(f, dict) and f.get("path") == "AGENTS.md":
                    has_agents = True
                    break
        if not has_agents:
            return None
        claude_file = result.get("claude_file") if isinstance(result, dict) else None
        if claude_file == "CLAUDE.md":
            return {"file": "CLAUDE.md", "line": "@AGENTS.md"}
        if claude_file == ".claude/CLAUDE.md":
            return {"file": ".claude/CLAUDE.md", "line": "@../AGENTS.md"}
        return None
    except Exception:
        return None


def _get_after(result):
    try:
        after = result.get("after") if isinstance(result, dict) else None
        if isinstance(after, dict):
            done = after.get("done")
            total = after.get("total")
            if isinstance(done, int) and isinstance(total, int) and not isinstance(done, bool) and not isinstance(total, bool):
                return {"done": done, "total": total}
    except Exception:
        pass
    return None


def _with_after(out, result):
    after = _get_after(result)
    if after is not None:
        out["after"] = after
    return out


def build_fixes(result, ask=_ask_muse_default, cache=None, now=time.time) -> dict:
    try:
        fix_files = result.get("fix_files") if isinstance(result, dict) else None
        too_big = result.get("too_big") if isinstance(result, dict) else False
        muse_facts = result.get("muse_facts") if isinstance(result, dict) else None
        owner = result.get("owner") if isinstance(result, dict) else ""
        repo = result.get("repo") if isinstance(result, dict) else ""
        commit = result.get("commit") if isinstance(result, dict) else ""
        yokoten_version = result.get("yokoten_version") if isinstance(result, dict) else ""

        has_agents = False
        if isinstance(fix_files, list):
            for f in fix_files:
                if isinstance(f, dict) and f.get("path") == "AGENTS.md":
                    has_agents = True
                    break
        if not has_agents or too_big:
            files_out = []
            if isinstance(fix_files, list):
                for f in fix_files:
                    if isinstance(f, dict):
                        files_out.append({
                            "path": f.get("path"),
                            "content": f.get("content"),
                            "source": "yokoten",
                        })
            return _with_after({"files": files_out, "summary": "", "muse": "not needed", "claude_import": _claude_import_for(result, fix_files)}, result)

        cache_key = muse_cache_key(owner or "", repo or "", commit or "", yokoten_version or "")
        cached = None
        use_cached = False
        cached_entry = None
        if cache is not None:
            try:
                cached_entry = cache.get(cache_key, None)
            except Exception as e:
                logger.error(type(e).__name__)
                cached_entry = None
            if isinstance(cached_entry, dict):
                at = cached_entry.get("at")
                summary = cached_entry.get("summary")
                this_project = cached_entry.get("this_project")
                if isinstance(at, (int, float)) and isinstance(summary, str) and isinstance(this_project, str):
                    try:
                        cur = now()
                    except Exception:
                        cur = time.time()
                    if cur - at < 24 * 3600:
                        use_cached = True
                        cached = cached_entry

        reply = None
        if use_cached:
            reply = {"summary": cached["summary"], "this_project": cached["this_project"]}
        else:
            try:
                reply = ask(muse_facts)
            except Exception as e:
                logger.error(type(e).__name__)
                reply = None
            if reply is not None:
                if cache is not None:
                    try:
                        cur2 = now()
                    except Exception:
                        cur2 = time.time()
                    entry = {"at": cur2, "summary": reply.get("summary"), "this_project": reply.get("this_project")}
                    try:
                        cache.put(cache_key, entry)
                    except Exception as e:
                        logger.error(type(e).__name__)

        files_out = []
        summary_out = ""
        muse_status = "failed"
        if reply is not None and isinstance(reply.get("summary"), str) and isinstance(reply.get("this_project"), str):
            summary_out = reply["summary"]
            muse_status = "ok"
            for f in fix_files:
                if not isinstance(f, dict):
                    continue
                path = f.get("path")
                content = f.get("content")
                if path == "AGENTS.md":
                    try:
                        merged = merge_this_project(content or "", reply["this_project"])
                    except Exception as e:
                        logger.error(type(e).__name__)
                        merged = content
                    files_out.append({"path": path, "content": merged, "source": "yokoten and Muse"})
                else:
                    files_out.append({"path": path, "content": content, "source": "yokoten"})
        else:
            for f in fix_files:
                if isinstance(f, dict):
                    files_out.append({"path": f.get("path"), "content": f.get("content"), "source": "yokoten"})
            summary_out = ""
            muse_status = "failed"

        return _with_after({"files": files_out, "summary": summary_out, "muse": muse_status, "claude_import": _claude_import_for(result, fix_files)}, result)
    except Exception as e:
        logger.error(type(e).__name__)
        try:
            fix_files = result.get("fix_files") if isinstance(result, dict) else []
            files_out = []
            if isinstance(fix_files, list):
                for f in fix_files:
                    if isinstance(f, dict):
                        files_out.append({"path": f.get("path"), "content": f.get("content"), "source": "yokoten"})
            return {"files": files_out, "summary": "", "muse": "failed", "claude_import": _claude_import_for(result, fix_files)}
        except Exception:
            return {"files": [], "summary": "", "muse": "failed", "claude_import": None}
