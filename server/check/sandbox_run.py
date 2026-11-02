import json
import logging

import modal

from check.github_check import RepoRefused
from check.result import summarize
from fixes.select_files import cap_files, choose_muse_paths, fill_owner, is_private_path, select_fix_paths

YOKOTEN_VERSION = "0.2.0"
CLONE_FAILED_MSG = "We couldn't copy this repo in time. It may be too big to check here."
CHECK_FAILED_MSG = "This repo took too long to check. It may be too big to check here."

logger = logging.getLogger(__name__)

image = (
    modal.Image.from_registry("node:22-slim")
    .apt_install("git", "ca-certificates")
    .run_commands(f"npm install -g yokoten@{YOKOTEN_VERSION}")
)

READ_FILES_SCRIPT = r"""
const fs=require('fs');
const path=require('path');
const args=JSON.parse(process.argv[1]);
const limit=args.limit;
const out={};
for(const p of args.paths){
  try{
    if(p.includes('\\')||p.split('/').includes('..')) continue;
    const full=path.join('/tmp/repo',p);
    const resolved=path.resolve(full);
    if(!resolved.startsWith('/tmp/repo/') && resolved!=='/tmp/repo') continue;
    if(fs.realpathSync(resolved)!==resolved && !fs.realpathSync(resolved).startsWith('/tmp/repo/')) continue;
    try{
      const real=fs.realpathSync(resolved);
      if(!real.startsWith('/tmp/repo/') && real!=='/tmp/repo') continue;
    }catch(e){ continue; }
    let st;
    try{ st=fs.lstatSync(resolved); }catch(e){ continue; }
    if(!st.isFile()) continue;
    const buf=Buffer.alloc(limit+1);
    const fd=fs.openSync(resolved,'r');
    let bytes=0;
    try{ bytes=fs.readSync(fd,buf,0,limit+1,0); }finally{ fs.closeSync(fd); }
    if(bytes>limit) bytes=limit;
    const txt=buf.slice(0,bytes).toString('utf8');
    out[p]=txt;
  }catch(e){}
}
process.stdout.write(JSON.stringify(out));
"""


class SandboxFailed(Exception):
    pass


def _read_process(proc):
    stdout = proc.stdout.read()
    stderr = proc.stderr.read()
    proc.wait()
    if isinstance(stdout, bytes):
        stdout = stdout.decode("utf-8", errors="replace")
    if isinstance(stderr, bytes):
        stderr = stderr.decode("utf-8", errors="replace")
    return stdout, stderr, proc.returncode


def _exec_read(sandbox, *command, timeout):
    proc = sandbox.exec(*command, timeout=timeout)
    return _read_process(proc)


def _notify_progress(callback, stage):
    if callback is None:
        return
    try:
        callback(stage)
    except Exception:
        pass


def _run_yokoten(sandbox, *args) -> str:
    # A second try would likely fail too, so this does not say to try again.
    try:
        stdout, stderr, return_code = _exec_read(sandbox, "env", "-C", "/tmp/repo", "yokoten", *args, timeout=30)
    except Exception as exc:
        logger.error(type(exc).__name__)
        raise RepoRefused(CHECK_FAILED_MSG) from exc
    if return_code not in (0, 1):
        logger.error("yokoten %s failed with %s: %s", args[0], return_code, stderr.strip()[:200])
        raise RepoRefused(CHECK_FAILED_MSG)
    return stdout


def _read_files(sandbox, paths, limit) -> dict:
    if not paths:
        return {}
    payload = json.dumps({"paths": paths, "limit": limit})
    stdout, _, return_code = _exec_read(
        sandbox, "env", "-C", "/tmp/repo", "node", "-e", READ_FILES_SCRIPT, payload, timeout=20
    )
    if return_code != 0:
        return {}
    try:
        data = json.loads(stdout)
        if not isinstance(data, dict):
            return {}
        return data
    except Exception:
        return {}


def _score_after_fixes(sandbox, selected, fix_files):
    try:
        if not selected:
            return None
        _, _, return_code = _exec_read(sandbox, "git", "-C", "/tmp/repo", "checkout", "--", ".", timeout=10)
        if return_code != 0:
            return None
        clean_command = ["git", "-C", "/tmp/repo", "clean", "-fdqx"]
        for path in selected:
            clean_command.extend(["-e", f"/{path}"])
        _, _, return_code = _exec_read(sandbox, *clean_command, timeout=10)
        if return_code != 0:
            return None
        for fix in fix_files or []:
            if isinstance(fix, dict) and fix.get("path") == ".github/CODEOWNERS":
                content = fix.get("content") or ""
                _, _, return_code = _exec_read(
                    sandbox,
                    "env",
                    "-C",
                    "/tmp/repo",
                    "node",
                    "-e",
                    "require('fs').writeFileSync(process.argv[1], process.argv[2])",
                    ".github/CODEOWNERS",
                    content,
                    timeout=10,
                )
                if return_code != 0:
                    return None
                break
        stdout, _, return_code = _exec_read(
            sandbox, "env", "-C", "/tmp/repo", "yokoten", "doctor", "--files", "--json", timeout=30
        )
        if return_code not in (0, 1):
            return None
        data = json.loads(stdout)
        summary = summarize(data)
        done = summary.get("done")
        total = summary.get("total")
        if (
            isinstance(done, int)
            and isinstance(total, int)
            and not isinstance(done, bool)
            and not isinstance(total, bool)
        ):
            return {"done": done, "total": total}
        return None
    except Exception as exc:
        logger.error(type(exc).__name__)
        return None


def _collect_fix_data(sandbox, owner, repo, doctor, check) -> dict:
    fix_files = []
    muse_facts = {}
    too_big = False
    claude_file = None
    selected = []
    after = None
    try:
        stdout_ls, _, return_code = _exec_read(sandbox, "git", "-C", "/tmp/repo", "ls-files", timeout=10)
        if return_code == 0:
            tracked = [line for line in stdout_ls.splitlines() if line]
        else:
            tracked = []
        if len(tracked) > 20000:
            too_big = True
        if "CLAUDE.md" in tracked:
            claude_file = "CLAUDE.md"
        elif ".claude/CLAUDE.md" in tracked:
            claude_file = ".claude/CLAUDE.md"
        else:
            claude_file = None
        try:
            findings = check.get("findings") or []
        except Exception:
            findings = []
        filtered_for_list = [path for path in tracked if not is_private_path(path)]
        file_list = filtered_for_list[:500]
        open_checks = []
        try:
            steps = summarize(doctor)["steps"]
            for step in steps:
                if not isinstance(step, dict):
                    continue
                mark = step.get("mark")
                if mark == "done" or mark == "not now":
                    continue
                open_checks.append({"id": step.get("id"), "title": step.get("title"), "what": step.get("what")})
        except Exception:
            open_checks = []
        chosen = choose_muse_paths(tracked, findings)
        changelog_paths = [path for path in chosen if path == "CHANGELOG.md"]
        other_paths = [path for path in chosen if path != "CHANGELOG.md"]
        read_files = {}
        if other_paths:
            data = _read_files(sandbox, other_paths, 20 * 1024)
            for path in other_paths:
                if path in data:
                    read_files[path] = data[path]
        if changelog_paths:
            data2 = _read_files(sandbox, changelog_paths, 3 * 1024)
            for path in changelog_paths:
                if path in data2:
                    read_files[path] = data2[path]
        capped = cap_files(read_files, 120 * 1024)
        muse_facts = {
            "owner": owner,
            "repo": repo,
            "file_list": file_list,
            "files": capped,
            "open_checks": open_checks,
        }
        _, _, return_code = _exec_read(sandbox, "env", "-C", "/tmp/repo", "yokoten", "init", timeout=30)
        if return_code == 0:
            stdout_st, _, return_code = _exec_read(
                sandbox, "git", "-C", "/tmp/repo", "status", "--porcelain", "--untracked-files=all", timeout=10
            )
            new_paths = []
            if return_code == 0:
                for line in stdout_st.splitlines():
                    if line.startswith("?? "):
                        path_part = line[3:]
                        if path_part.startswith('"'):
                            continue
                        new_paths.append(path_part)
            selected = select_fix_paths(new_paths, tracked)
            if selected:
                data_f = _read_files(sandbox, selected, 64 * 1024)
                for path in selected:
                    if path in data_f:
                        content = data_f[path]
                        if path == ".github/CODEOWNERS":
                            content = fill_owner(content, owner)
                        fix_files.append({"path": path, "content": content})
        after = _score_after_fixes(sandbox, selected, fix_files)
    except Exception as exc:
        logger.error(type(exc).__name__)
        fix_files = []
        muse_facts = {}
        too_big = False
        claude_file = None
        after = None
    return {"fix_files": fix_files, "muse_facts": muse_facts, "too_big": too_big, "claude_file": claude_file, "after": after}


def run_in_sandbox(owner: str, repo: str, on_progress=None) -> dict:
    app = modal.App.lookup("yokoten-doctor", create_if_missing=True)
    sandbox = modal.Sandbox.create(
        app=app,
        image=image,
        timeout=120,
        cpu=1.0,
        memory=1024,
        env={
            "HOME": "/tmp/home",
            "TMPDIR": "/tmp/work",
            "TEMP": "/tmp/work",
            "TMP": "/tmp/work",
            "GIT_TERMINAL_PROMPT": "0",
        },
        outbound_domain_allowlist=["github.com", "*.github.com", "*.githubusercontent.com"],
        outbound_cidr_allowlist=[],
    )
    try:
        _, _, return_code = _exec_read(sandbox, "mkdir", "-p", "/tmp/home", "/tmp/work", timeout=10)
        if return_code != 0:
            raise SandboxFailed("Could not prepare sandbox.")
        _notify_progress(on_progress, "copying")
        clone_url = f"https://github.com/{owner}/{repo}.git"
        # A second try would likely fail too, so this does not say to try again.
        try:
            _, stderr, return_code = _exec_read(
                sandbox,
                "git",
                "-c",
                "core.hooksPath=/dev/null",
                "clone",
                "--depth",
                "1",
                "--no-recurse-submodules",
                "--quiet",
                clone_url,
                "/tmp/repo",
                timeout=60,
            )
        except Exception as exc:
            logger.error(type(exc).__name__)
            raise RepoRefused(CLONE_FAILED_MSG) from exc
        if return_code != 0:
            logger.error("clone failed with %s: %s", return_code, stderr.strip()[:200])
            raise RepoRefused(CLONE_FAILED_MSG)
        stdout, stderr, return_code = _exec_read(sandbox, "git", "-C", "/tmp/repo", "rev-parse", "HEAD", timeout=10)
        if return_code != 0:
            raise SandboxFailed(f"Could not read commit: {stderr.strip()}")
        commit = stdout.strip()
        stdout_branch, _, return_code_branch = _exec_read(
            sandbox, "git", "-C", "/tmp/repo", "rev-parse", "--abbrev-ref", "HEAD", timeout=10
        )
        branch = stdout_branch.strip() if return_code_branch == 0 else None
        try:
            sandbox._experimental_set_outbound_network_policy(
                outbound_domain_allowlist=[],
                outbound_cidr_allowlist=[],
            )
        except Exception as exc:
            raise SandboxFailed("Could not lock down network before running checks.") from exc
        _notify_progress(on_progress, "checking")
        about = ""
        try:
            stdout_a, _, return_code_a = _exec_read(
                sandbox,
                "node",
                "-p",
                "require('/usr/local/lib/node_modules/yokoten/package.json').description",
                timeout=10,
            )
            if return_code_a == 0:
                about = stdout_a.strip()
                if about is None:
                    about = ""
            else:
                about = ""
        except Exception:
            about = ""
        stdout_d = _run_yokoten(sandbox, "doctor", "--files", "--json")
        try:
            doctor = json.loads(stdout_d)
        except Exception as exc:
            raise SandboxFailed(f"Could not parse doctor output: {exc}") from exc
        stdout_c = _run_yokoten(sandbox, "check", "--json")
        try:
            check = json.loads(stdout_c)
        except Exception as exc:
            raise SandboxFailed(f"Could not parse check output: {exc}") from exc
        yokoten_version = doctor.get("version", YOKOTEN_VERSION)
        rerun = {
            "doctor": "\n".join(
                [
                    f"git clone --filter=blob:none https://github.com/{owner}/{repo}",
                    f"cd {repo}",
                    f"git checkout {commit}",
                    f"npx yokoten@{yokoten_version} doctor --files --json",
                ]
            ),
            "check": f'HOME="$(mktemp -d)" npx yokoten@{yokoten_version} check --json',
        }
        collected = _collect_fix_data(sandbox, owner, repo, doctor, check)
        fix_files = collected["fix_files"]
        muse_facts = collected["muse_facts"]
        too_big = collected["too_big"]
        claude_file = collected.get("claude_file")
        after = collected.get("after")
        return {
            "owner": owner,
            "repo": repo,
            "commit": commit,
            "branch": branch,
            "yokoten_version": yokoten_version,
            "about": about,
            "doctor": doctor,
            "check": check,
            "rerun": rerun,
            "fix_files": fix_files,
            "muse_facts": muse_facts,
            "too_big": too_big,
            "claude_file": claude_file,
            "after": after,
        }
    finally:
        try:
            sandbox.terminate()
        except Exception:
            pass
