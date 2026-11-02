import hashlib
import json

from record.document import document_hash, make_document


def test_document_has_one_line_per_field():
    doc = make_document({"ok": True}, "2024-01-01T00:00:00Z")
    assert b"\n" in doc
    lines = doc.decode("utf-8").splitlines()
    assert '  "schema": "yokoten-doctor/1"' in lines


def test_document_ends_with_single_newline():
    doc = make_document({"ok": True}, "2024-01-01T00:00:00Z")
    assert doc.endswith(b"\n")
    assert not doc.endswith(b"\n\n")


def test_json_loads_returns_input():
    result = {"value": 123, "nested": {"a": 1}}
    recorded_at = "2024-01-01T00:00:00Z"
    doc = make_document(result, recorded_at)
    obj = json.loads(doc)
    assert obj["schema"] == "yokoten-doctor/1"
    assert obj["recorded_at"] == recorded_at
    assert obj["result"] == result


def test_non_ascii_stays_utf8():
    result = {"text": "café 日本"}
    doc = make_document(result, "2024-01-01T00:00:00Z")
    text = doc.decode("utf-8")
    assert "café 日本" in text
    assert "café 日本".encode("utf-8") in doc
    assert b"\\u00e9" not in doc


def test_document_hash_matches_sha256():
    doc = make_document({"x": 1}, "2024-01-01T00:00:00Z")
    assert document_hash(doc) == hashlib.sha256(doc).hexdigest()
