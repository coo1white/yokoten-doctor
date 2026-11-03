import json
import logging
import pytest
from fixes.muse import parse_reply, BadReply, ask_muse, SYSTEM_PROMPT, PROMPT_ID
from fixes.build import build_fixes, muse_cache_key

# parse_reply
def test_parse_reply_good():
    data = {"summary": "A short summary", "this_project": "### Build\nmake"}
    text = json.dumps(data)
    out = parse_reply(text)
    assert out == data

def test_parse_reply_inside_code_fence():
    data = {"summary": "A short summary", "this_project": "### Build\nmake"}
    text = "```json\n" + json.dumps(data) + "\n```"
    out = parse_reply(text)
    assert out == data
    # also generic fence without language
    text2 = "```\n" + json.dumps(data) + "\n```"
    assert parse_reply(text2) == data

def test_parse_reply_extra_fields_dropped():
    data = {"summary": "s", "this_project": "p", "extra": 123, "another": "x"}
    out = parse_reply(json.dumps(data))
    assert out == {"summary": "s", "this_project": "p"}
    assert "extra" not in out

def test_parse_reply_bad_not_a_string():
    with pytest.raises(BadReply):
        parse_reply(123)

def test_parse_reply_bad_not_json():
    with pytest.raises(BadReply):
        parse_reply("not json")

def test_parse_reply_bad_not_object():
    with pytest.raises(BadReply):
        parse_reply(json.dumps([1,2,3]))

def test_parse_reply_bad_missing_field():
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": "s"}))
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"this_project": "p"}))

def test_parse_reply_bad_summary():
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": "", "this_project": "p"}))
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": 123, "this_project": "p"}))

def test_parse_reply_bad_this_project():
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": "s", "this_project": ""}))
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": "s", "this_project": None}))

def test_parse_reply_summary_too_long():
    long_summary = "a" * 301
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": long_summary, "this_project": "p"}))

def test_parse_reply_this_project_too_long():
    long_tp = "a" * 4001
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": "s", "this_project": long_tp}))

def test_parse_reply_too_many_lines():
    many = "\n".join(["line"] * 41)
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": "s", "this_project": many}))

def test_parse_reply_bad_heading():
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": "s", "this_project": "# bad heading"}))
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": "s", "this_project": "## bad"}))
    # ### is allowed
    out = parse_reply(json.dumps({"summary": "s", "this_project": "### ok"}))
    assert out["this_project"] == "### ok"

def test_parse_reply_email_found():
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": "contact a.person@example.org", "this_project": "p"}))
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": "s", "this_project": "mail me@example.com please"}))

def test_parse_reply_allowed_npx_and_git():
    data = {"summary": "use npx yokoten@0.2.0 to run", "this_project": "clone git@github.com:a/b.git"}
    out = parse_reply(json.dumps(data))
    assert out == data

def test_parse_reply_refuses_email():
    with pytest.raises(BadReply):
        parse_reply(json.dumps({"summary": "s", "this_project": "write to a.person@example.org"}))

# ask_muse with fake post and sleep
def _make_facts():
    return {"files": {"README.md": "hello"}}

def _good_outer(summary="sum", tp="### Build\nmake"):
    inner = json.dumps({"summary": summary, "this_project": tp})
    outer = json.dumps({"choices": [{"message": {"content": inner}}]})
    return outer

def test_ask_muse_good_reply():
    def post(url, key, body, timeout):
        return (200, _good_outer())
    out = ask_muse(_make_facts(), key="k", post=post, sleep=lambda x: None)
    assert out == {"summary": "sum", "this_project": "### Build\nmake"}

def test_ask_muse_429_then_good_with_one_sleep():
    sleeps = []
    calls = []
    def post(url, key, body, timeout):
        calls.append(1)
        if len(calls) == 1:
            return (429, "")
        return (200, _good_outer())
    def sleep(s):
        sleeps.append(s)
    out = ask_muse(_make_facts(), key="k", post=post, sleep=sleep)
    assert out is not None
    assert sleeps == [5]
    assert len(calls) == 2

def test_ask_muse_429_twice_returns_none():
    def post(url, key, body, timeout):
        return (429, "")
    out = ask_muse(_make_facts(), key="k", post=post, sleep=lambda x: None)
    assert out is None

def test_ask_muse_bad_json_then_good_no_sleep():
    sleeps = []
    calls = []
    def post(url, key, body, timeout):
        calls.append(1)
        if len(calls) == 1:
            # valid outer but inner is bad json
            outer = json.dumps({"choices": [{"message": {"content": "not json"}}]})
            return (200, outer)
        return (200, _good_outer())
    out = ask_muse(_make_facts(), key="k", post=post, sleep=lambda s: sleeps.append(s))
    assert out is not None
    assert sleeps == []
    assert len(calls) == 2

def test_ask_muse_content_null_then_good():
    calls = []
    def post(url, key, body, timeout):
        calls.append(1)
        if len(calls) == 1:
            outer = json.dumps({"choices": [{"message": {"content": None}}]})
            return (200, outer)
        return (200, _good_outer())
    out = ask_muse(_make_facts(), key="k", post=post, sleep=lambda x: None)
    assert out is not None
    assert len(calls) == 2

def test_ask_muse_at_most_two_calls():
    calls = []
    def post(url, key, body, timeout):
        calls.append(1)
        # always bad json
        outer = json.dumps({"choices": [{"message": {"content": "not json"}}]})
        return (200, outer)
    out = ask_muse(_make_facts(), key="k", post=post, sleep=lambda x: None)
    assert out is None
    assert len(calls) == 2

def test_ask_muse_no_key_returns_none_no_call():
    calls = []
    def post(url, key, body, timeout):
        calls.append(1)
        return (200, _good_outer())
    # ensure env not set
    import os
    if "BASETEN_API_KEY" in os.environ:
        del os.environ["BASETEN_API_KEY"]
    out = ask_muse(_make_facts(), key=None, post=post, sleep=lambda x: None)
    assert out is None
    assert calls == []
    out2 = ask_muse(_make_facts(), key="", post=post, sleep=lambda x: None)
    assert out2 is None
    assert calls == []

def test_ask_muse_post_raises_does_not_leak_secret(caplog):
    def post(url, key, body, timeout):
        raise RuntimeError("SECRET-TEXT")
    caplog.set_level(logging.ERROR)
    out = ask_muse(_make_facts(), key="KEY-VALUE", post=post, sleep=lambda x: None)
    assert out is None
    assert "SECRET-TEXT" not in caplog.text
    assert "KEY-VALUE" not in caplog.text

# build_fixes
def test_build_fixes_merged_source():
    result = {
        "fix_files": [{"path": "AGENTS.md", "content": "core\n"}, {"path": ".github/CODEOWNERS", "content": "* @me"}],
        "too_big": False,
        "muse_facts": {},
        "owner": "o",
        "repo": "r",
        "commit": "c",
        "yokoten_version": "v",
    }
    def fake_ask(facts):
        return {"summary": "sum", "this_project": "### Build\nmake"}
    out = build_fixes(result, ask=fake_ask, cache=None)
    assert out["muse"] == "ok"
    assert out["summary"] == "sum"
    by_path = {f["path"]: f for f in out["files"]}
    assert by_path["AGENTS.md"]["source"] == "yokoten and Muse"
    assert "### Build" in by_path["AGENTS.md"]["content"]
    assert by_path[".github/CODEOWNERS"]["source"] == "yokoten"

def test_build_fixes_no_new_agents_no_call():
    result = {
        "fix_files": [{"path": ".github/CODEOWNERS", "content": "x"}],
        "too_big": False,
        "muse_facts": {},
        "owner": "o",
        "repo": "r",
        "commit": "c",
        "yokoten_version": "v",
    }
    called = []
    def fake_ask(facts):
        called.append(1)
        return {"summary": "s", "this_project": "p"}
    out = build_fixes(result, ask=fake_ask, cache=None)
    assert called == []
    assert out["muse"] == "not needed"
    assert out["summary"] == ""

def test_build_fixes_too_big_no_call():
    result = {
        "fix_files": [{"path": "AGENTS.md", "content": "core"}],
        "too_big": True,
        "muse_facts": {},
        "owner": "o",
        "repo": "r",
        "commit": "c",
        "yokoten_version": "v",
    }
    called = []
    def fake_ask(facts):
        called.append(1)
        return {"summary": "s", "this_project": "p"}
    out = build_fixes(result, ask=fake_ask, cache=None)
    assert called == []
    assert out["muse"] == "not needed"

def test_build_fixes_cached_makes_no_call():
    result = {
        "fix_files": [{"path": "AGENTS.md", "content": "core"}],
        "too_big": False,
        "muse_facts": {"x": 1},
        "owner": "o",
        "repo": "r",
        "commit": "c",
        "yokoten_version": "v",
    }
    key = muse_cache_key("o", "r", "c", "v")
    cache_store = {key: {"at": 1000, "summary": "cached sum", "this_project": "cached tp"}}
    class FakeCache:
        def get(self, k, d=None):
            return cache_store.get(k, d)
        def put(self, k, v):
            cache_store[k] = v
    called = []
    def fake_ask(facts):
        called.append(1)
        return {"summary": "new", "this_project": "new tp"}
    out = build_fixes(result, ask=fake_ask, cache=FakeCache(), now=lambda: 1000 + 3600)
    assert called == []
    assert out["summary"] == "cached sum"
    assert out["muse"] == "ok"

def test_build_fixes_older_than_24h_calls_again():
    result = {
        "fix_files": [{"path": "AGENTS.md", "content": "core"}],
        "too_big": False,
        "muse_facts": {"x": 1},
        "owner": "o",
        "repo": "r",
        "commit": "c",
        "yokoten_version": "v",
    }
    key = muse_cache_key("o", "r", "c", "v")
    cache_store = {key: {"at": 0, "summary": "old", "this_project": "old tp"}}
    class FakeCache:
        def get(self, k, d=None):
            return cache_store.get(k, d)
        def put(self, k, v):
            cache_store[k] = v
    called = []
    def fake_ask(facts):
        called.append(1)
        return {"summary": "new", "this_project": "new tp"}
    out = build_fixes(result, ask=fake_ask, cache=FakeCache(), now=lambda: 24*3600 + 1)
    assert len(called) == 1
    assert out["summary"] == "new"

def test_build_fixes_good_reply_stored_under_key():
    result = {
        "fix_files": [{"path": "AGENTS.md", "content": "core"}],
        "too_big": False,
        "muse_facts": {},
        "owner": "Owner",
        "repo": "Repo",
        "commit": "AbC",
        "yokoten_version": "V1",
    }
    stored = {}
    class FakeCache:
        def get(self, k, d=None):
            return None
        def put(self, k, v):
            stored[k] = v
    def fake_ask(facts):
        return {"summary": "s", "this_project": "p"}
    out = build_fixes(result, ask=fake_ask, cache=FakeCache(), now=lambda: 12345)
    assert out["muse"] == "ok"
    expected_key = muse_cache_key("Owner", "Repo", "AbC", "V1")
    assert expected_key in stored
    assert stored[expected_key]["summary"] == "s"
    assert stored[expected_key]["this_project"] == "p"
    assert stored[expected_key]["at"] == 12345

def test_build_fixes_failed_reply_not_stored():
    result = {
        "fix_files": [{"path": "AGENTS.md", "content": "core"}],
        "too_big": False,
        "muse_facts": {},
        "owner": "o",
        "repo": "r",
        "commit": "c",
        "yokoten_version": "v",
    }
    class FakeCache:
        def get(self, k, d=None):
            return None
        def put(self, k, v):
            pytest.fail("should not store on failure")
    def fake_ask(facts):
        return None
    out = build_fixes(result, ask=fake_ask, cache=FakeCache())
    assert out["muse"] == "failed"

def test_build_fixes_ask_raising_gives_failed():
    result = {
        "fix_files": [{"path": "AGENTS.md", "content": "orig"}, {"path": ".github/CODEOWNERS", "content": "c"}],
        "too_big": False,
        "muse_facts": {},
        "owner": "o",
        "repo": "r",
        "commit": "c",
        "yokoten_version": "v",
    }
    def fake_ask(facts):
        raise RuntimeError("boom")
    out = build_fixes(result, ask=fake_ask, cache=None)
    assert out["muse"] == "failed"
    # yokoten's files unchanged
    by_path = {f["path"]: f for f in out["files"]}
    assert by_path["AGENTS.md"]["content"] == "orig"
    assert by_path["AGENTS.md"]["source"] == "yokoten"

def test_build_fixes_cache_get_put_raise_still_ok():
    result = {
        "fix_files": [{"path": "AGENTS.md", "content": "core"}],
        "too_big": False,
        "muse_facts": {},
        "owner": "o",
        "repo": "r",
        "commit": "c",
        "yokoten_version": "v",
    }
    class BadCache:
        def get(self, k, d=None):
            raise RuntimeError("get fail")
        def put(self, k, v):
            raise RuntimeError("put fail")
    def fake_ask(facts):
        return {"summary": "s", "this_project": "p"}
    out = build_fixes(result, ask=fake_ask, cache=BadCache())
    assert out["muse"] == "ok"


import pytest
from fixes.build import build_fixes

def _base_result(fix_files=None, claude_file=None, too_big=False, muse_facts=None):
    if fix_files is None:
        fix_files = [{"path": "AGENTS.md", "content": "# agents"}]
    return {
        "owner": "o",
        "repo": "r",
        "commit": "abc",
        "yokoten_version": "1.0",
        "fix_files": fix_files,
        "claude_file": claude_file,
        "too_big": too_big,
        "muse_facts": muse_facts or {"facts": "x"},
    }

def test_claude_import_for_claude_md():
    fix_files = [{"path": "AGENTS.md", "content": "x"}]
    result = _base_result(fix_files=fix_files, claude_file="CLAUDE.md")
    out = build_fixes(result, cache=None)
    assert out["claude_import"] == {"file": "CLAUDE.md", "line": "@AGENTS.md"}

def test_claude_import_for_dot_claude():
    fix_files = [{"path": "AGENTS.md", "content": "x"}]
    result = _base_result(fix_files=fix_files, claude_file=".claude/CLAUDE.md")
    out = build_fixes(result, cache=None)
    assert out["claude_import"] == {"file": ".claude/CLAUDE.md", "line": "@../AGENTS.md"}

def test_claude_import_null_when_claude_file_none():
    fix_files = [{"path": "AGENTS.md", "content": "x"}]
    result = _base_result(fix_files=fix_files, claude_file=None)
    out = build_fixes(result, cache=None)
    assert out["claude_import"] is None

def test_claude_import_null_when_no_agents_md():
    fix_files = [{"path": "OTHER.md", "content": "x"}, {"path": "README.md", "content": "y"}]
    result = _base_result(fix_files=fix_files, claude_file="CLAUDE.md")
    out = build_fixes(result, cache=None)
    assert out["claude_import"] is None

def test_claude_import_present_when_claude_fails():
    fix_files = [{"path": "AGENTS.md", "content": "x"}]
    result = _base_result(fix_files=fix_files, claude_file="CLAUDE.md", muse_facts={"facts": "x"})
    def failing_ask(facts):
        raise RuntimeError("Muse boom")
    out = build_fixes(result, ask=failing_ask, cache=None)
    # muse failed but claude_import should still be present
    assert out["muse"] == "failed"
    assert out["claude_import"] == {"file": "CLAUDE.md", "line": "@AGENTS.md"}

def test_claude_import_null_when_claude_file_unexpected_value():
    fix_files = [{"path": "AGENTS.md", "content": "x"}]
    result = _base_result(fix_files=fix_files, claude_file="something/else.md")
    out = build_fixes(result, cache=None)
    assert out["claude_import"] is None

def test_build_fixes_not_needed_still_returns_claude_import():
    # too_big or no agents should return not needed but still include claude_import if applicable
    fix_files = [{"path": "AGENTS.md", "content": "x"}]
    result = _base_result(fix_files=fix_files, claude_file="CLAUDE.md", too_big=True)
    out = build_fixes(result, cache=None)
    assert out["claude_import"] == {"file": "CLAUDE.md", "line": "@AGENTS.md"}
    assert out["muse"] == "not needed"

def test_build_fixes_without_agents_never_has_claude_import():
    fix_files = [{"path": "OTHER.md", "content": "x"}]
    result = _base_result(fix_files=fix_files, claude_file="CLAUDE.md")
    def should_not_be_called(facts):
        raise AssertionError("should not call Muse when no AGENTS.md")
    out = build_fixes(result, ask=should_not_be_called, cache=None)
    assert out["claude_import"] is None

def test_build_fixes_after_passed_when_muse_works():
    result = _base_result()
    result["after"] = {"done": 7, "total": 13}
    def fake_ask(facts):
        return {"summary": "s", "this_project": "### X\nhello"}
    out = build_fixes(result, ask=fake_ask, cache=None)
    assert out["after"] == {"done": 7, "total": 13}

def test_build_fixes_after_passed_when_muse_fails():
    result = _base_result()
    result["after"] = {"done": 2, "total": 10}
    def fake_ask(facts):
        raise RuntimeError("fail")
    out = build_fixes(result, ask=fake_ask, cache=None)
    assert out["after"] == {"done": 2, "total": 10}
    assert out["muse"] == "failed"

def test_build_fixes_after_passed_when_not_needed():
    result = _base_result(fix_files=[{"path": "README.md", "content": "x"}])
    result["after"] = {"done": 5, "total": 8}
    out = build_fixes(result, cache=None)
    assert out["after"] == {"done": 5, "total": 8}
    assert out["muse"] == "not needed"

def test_build_fixes_bad_after_left_out():
    result = _base_result()
    result["after"] = {"done": "7", "total": 13}
    out = build_fixes(result, cache=None)
    assert "after" not in out
    result2 = _base_result()
    result2["after"] = {"done": 1}
    out2 = build_fixes(result2, cache=None)
    assert "after" not in out2
    result3 = _base_result()
    result3["after"] = "bad"
    out3 = build_fixes(result3, cache=None)
    assert "after" not in out3

def test_parse_reply_drops_a_stray_line_before_the_first_heading():
    text = json.dumps({"summary": "s", "this_project": "This project\n\n### Build\nmake"})
    assert parse_reply(text)["this_project"] == "### Build\nmake"


def test_parse_reply_keeps_text_with_no_heading():
    text = json.dumps({"summary": "s", "this_project": "make"})
    assert parse_reply(text)["this_project"] == "make"


def test_prompt_asks_for_the_three_parts_the_page_shows():
    for heading in ("### Build", "### Test", "### What not to touch"):
        assert heading in SYSTEM_PROMPT


def test_prompt_forbids_todo_lines_and_made_up_rules():
    assert 'Never write "TODO"' in SYSTEM_PROMPT
    assert "Never invent a command, a rule, a version or a folder" in SYSTEM_PROMPT
    assert "starting with" not in SYSTEM_PROMPT


def test_cache_key_changes_with_the_prompt():
    assert muse_cache_key("o", "r", "c", "v") == f"o/r@c@v@{PROMPT_ID}"
