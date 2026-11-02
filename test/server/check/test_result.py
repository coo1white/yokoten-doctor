import json
import pathlib
import pytest

from check.result import summarize

FIXTURE = pathlib.Path("test/fixtures/doctor-files-0.2.0.json")


def load_fixture():
    if FIXTURE.exists():
        return json.loads(FIXTURE.read_text())
    return None


def _step(step_id, title, mark, source="files", how="h", why="w", reason=None):
    entry = {"id": step_id, "title": title, "mark": mark, "how": how, "why": why, "source": source}
    if reason is not None:
        entry["reason"] = reason
    return entry


def _doctor(steps, findings=None, next_id=None):
    doctor_payload = {"steps": steps, "findings": findings if findings is not None else [], "next": {}}
    if next_id is not None:
        doctor_payload["next"] = {"id": next_id}
    return doctor_payload


def test_fixture_counts():
    data = load_fixture()
    if data is None:
        pytest.skip("fixture missing")
    out = summarize(data)
    # done counts only files source with mark done
    files_steps = [s for s in data.get("steps", []) if s.get("source") == "files"]
    assert out["total"] == len(files_steps)
    assert out["done"] == sum(1 for s in files_steps if s.get("mark") == "done")
    # each step has required keys
    for st in out["steps"]:
        assert "id" in st and "title" in st and "mark" in st and "how" in st and "why" in st


def test_next_points_at_files():
    data = load_fixture()
    if data is None:
        pytest.skip("fixture missing")
    out = summarize(data)
    if out["next"] is not None:
        assert out["next"]["id"] not in (None, "")


def test_not_now_keeps_reason():
    doctor = _doctor(
        steps=[
            _step("a", "A", "done"),
            _step("b", "B", "not now", reason="later"),
        ],
    )
    out = summarize(doctor)
    assert out["done"] == 1
    assert out["total"] == 2
    b = next(s for s in out["steps"] if s["id"] == "b")
    assert b["reason"] == "later"
    # next should be None because only remaining is not now
    assert out["next"] is None


def test_unknown_mark():
    doctor = _doctor(steps=[_step("a", "A", "weird")])
    out = summarize(doctor)
    assert out["steps"][0]["mark"] == "unknown"


def test_next_points_at_non_files():
    doctor = _doctor(
        steps=[
            _step("tool-hook", "Hook", "next", source="other"),
            _step("a", "A", "to do"),
            _step("b", "B", "to do"),
        ],
        next_id="tool-hook",
    )
    out = summarize(doctor)
    # next points at non-files, so fallback to first files not done/not now
    assert out["next"]["id"] == "a"


def test_findings_lookup():
    doctor = _doctor(
        steps=[
            _step("a", "A", "to do"),
            _step("b", "B", "to do"),
        ],
        findings=[
            {"id": "a", "what": "bad", "why": "because", "fix": "do x", "docs": "http://x"},
            {"id": "other", "what": "ignore", "why": "y", "fix": "z"},
        ],
        next_id="a",
    )
    out = summarize(doctor)
    a = next(s for s in out["steps"] if s["id"] == "a")
    b = next(s for s in out["steps"] if s["id"] == "b")
    assert a["what"] == "bad"
    assert a["fix"] == "do x"
    assert a["docs"] == "http://x"
    assert "what" not in b


def test_install_only_not_chosen():
    doctor = _doctor(
        steps=[
            _step("runtime", "R", "to do"),
            _step("a", "A", "to do"),
        ],
    )
    out = summarize(doctor)
    assert out["next"]["id"] == "a"


def test_install_only_when_alone():
    doctor = _doctor(
        steps=[
            _step("a", "A", "done"),
            _step("runtime", "R", "to do"),
        ],
    )
    out = summarize(doctor)
    assert out["next"]["id"] == "runtime"


def test_next_explicit_files():
    doctor = _doctor(
        steps=[
            _step("a", "A", "to do"),
            _step("b", "B", "to do"),
        ],
        next_id="b",
    )
    out = summarize(doctor)
    assert out["next"]["id"] == "b"


# Tests for 1 and 2: install_only field and next never install-only while other files step open

def test_install_only_field_includes_all_install_only_not_done():
    doctor = _doctor(
        steps=[
            _step("tool-hook", "Hook", "to do"),
            _step("runtime", "Runtime", "done"),
            _step("sandbox", "Sandbox", "next"),
            _step("a", "A", "to do"),
        ],
    )
    out = summarize(doctor)
    assert "install_only" in out
    ids = [s["id"] for s in out["install_only"]]
    assert "tool-hook" in ids
    assert "sandbox" in ids
    assert "runtime" not in ids
    assert "a" not in ids


def test_install_only_empty_when_all_done():
    doctor = _doctor(
        steps=[
            _step("tool-hook", "Hook", "done"),
            _step("a", "A", "done"),
        ],
    )
    out = summarize(doctor)
    assert out["install_only"] == []


def test_next_never_install_only_even_when_next_id_names_install_only():
    doctor = _doctor(
        steps=[
            _step("tool-hook", "Hook", "next"),
            _step("a", "A", "to do"),
            _step("b", "B", "to do"),
        ],
        next_id="tool-hook",
    )
    out = summarize(doctor)
    assert out["next"] is not None
    assert out["next"]["id"] == "a"
    assert out["next"]["id"] not in ("tool-hook", "runtime", "sandbox")


def test_next_id_done_is_not_open():
    doctor = _doctor(
        steps=[
            _step("a", "A", "done"),
            _step("b", "B", "to do"),
            _step("c", "C", "to do"),
        ],
        next_id="a",
    )
    out = summarize(doctor)
    # next.id is done, so not open -> fallback to first open non-install-only
    assert out["next"]["id"] == "b"


def test_next_prefers_first_open_non_install_only():
    doctor = _doctor(
        steps=[
            _step("runtime", "R", "to do"),
            _step("a", "A", "not now", reason="later"),
            _step("b", "B", "to do"),
            _step("sandbox", "S", "to do"),
        ],
    )
    out = summarize(doctor)
    assert out["next"]["id"] == "b"


def test_fixture_with_only_yokoten_steps_open():
    data = load_fixture()
    if data is None:
        pytest.skip("fixture missing")
    # this repo has done all 8 checks that need no yokoten, so only install steps are open
    assert data.get("next", {}).get("id") == "tool-hook"
    out = summarize(data)
    assert out["done"] == 8
    assert out["next"]["id"] == "tool-hook"
    ids = {s["id"] for s in out["install_only"]}
    assert ids == {"tool-hook", "runtime", "ci", "titles", "sandbox"}


def test_ci_and_titles_open_appear_in_install_only():
    doctor = _doctor(
        steps=[
            _step("ci", "CI", "to do"),
            _step("titles", "Titles", "next"),
            _step("a", "A", "to do"),
            _step("b", "B", "to do"),
        ],
    )
    out = summarize(doctor)
    ids = [s["id"] for s in out["install_only"]]
    assert "ci" in ids
    assert "titles" in ids
    assert out["next"] is not None
    assert out["next"]["id"] == "a"


def test_next_id_titles_falls_back_to_other_open_step():
    doctor = _doctor(
        steps=[
            _step("titles", "Titles", "next"),
            _step("a", "A", "to do"),
            _step("b", "B", "to do"),
        ],
        next_id="titles",
    )
    out = summarize(doctor)
    assert out["next"] is not None
    assert out["next"]["id"] == "a"
    assert out["next"]["id"] != "titles"
