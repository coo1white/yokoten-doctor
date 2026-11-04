import hashlib
import json

import pytest

from record.document import document_hash, make_report_document, report_memo_text, report_record_key
from record.write import write_report_record


class DictStore:
    def __init__(self, d=None):
        self.d = d if d is not None else {}

    def get(self, key, default=None):
        return self.d.get(key, default)

    def put(self, key, value):
        self.d[key] = value


def _report(cw_version="1", extra=None):
    base = {"owner": "owner", "repo": "repo", "commit": "abc123", "cw_version": cw_version, "findings": []}
    if extra:
        base.update(extra)
    return base


def test_report_document_has_schema_check_and_report_without_record():
    store = DictStore()
    check_sha256 = "a" * 64
    report = _report()
    report["record"] = {"should": "be excluded"}
    calls = {}

    def fake_rekor(doc, pem):
        calls["rekor_doc"] = doc
        return {"url": "https://example.test/x"}

    def fake_solana(memo, seed_hex):
        calls["solana_memo"] = memo
        return {"url": "https://example.test/x"}

    env = {"REKOR_SIGNING_KEY": "pem", "SOLANA_DEVNET_SEED": "00" * 32}
    rec = write_report_record(report, check_sha256, store=store, now=lambda: 0, rekor=fake_rekor, solana=fake_solana, environ=env)
    assert rec is not None
    doc_obj = json.loads(rec["document"])
    assert doc_obj["schema"] == "yokoten-doctor-report/1"
    assert doc_obj["check_sha256"] == check_sha256
    assert "record" not in doc_obj["report"]
    assert doc_obj["report"]["owner"] == "owner"
    expected_doc = make_report_document({k: v for k, v in report.items() if k != "record"}, check_sha256, rec["recorded_at"])
    assert rec["document"] == expected_doc.decode("utf-8")
    assert rec["sha256"] == hashlib.sha256(expected_doc).hexdigest()
    assert rec["sha256"] == document_hash(expected_doc)
    assert rec["check_sha256"] == check_sha256


def test_report_memo_has_app_check_commit_cw_repo_sha256_and_size():
    store = DictStore()
    check_sha256 = "b" * 64
    report = _report(cw_version="2.0")
    captured = {}

    def fake_rekor(doc, pem):
        return {"url": "https://example.test/x"}

    def fake_solana(memo, seed_hex):
        captured["memo"] = memo
        captured["seed"] = seed_hex
        return {"url": "https://example.test/x"}

    env = {"REKOR_SIGNING_KEY": "pem", "SOLANA_DEVNET_SEED": "ab" * 32}
    rec = write_report_record(report, check_sha256, store=store, now=lambda: 0, rekor=fake_rekor, solana=fake_solana, environ=env)
    assert rec is not None
    memo_text = captured["memo"]
    obj = json.loads(memo_text)
    assert obj["app"] == "yokoten-doctor-report/1"
    assert obj["check"] == check_sha256
    assert obj["commit"] == "abc123"
    assert obj["cw"] == "2.0"
    assert obj["repo"] == "owner/repo"
    assert obj["sha256"] == rec["sha256"]
    assert len(memo_text.encode("utf-8")) <= 500


def test_second_call_returns_stored_and_fakes_not_called_again():
    store = DictStore()
    check_sha256 = "c" * 64
    report = _report()
    calls = {"rekor": 0, "solana": 0}

    def fake_rekor(doc, pem):
        calls["rekor"] += 1
        return {"url": "https://example.test/x"}

    def fake_solana(memo, seed_hex):
        calls["solana"] += 1
        return {"url": "https://example.test/x"}

    env = {"REKOR_SIGNING_KEY": "pem", "SOLANA_DEVNET_SEED": "00" * 32}
    rec1 = write_report_record(report, check_sha256, store=store, now=lambda: 0, rekor=fake_rekor, solana=fake_solana, environ=env)
    assert rec1 is not None
    assert calls["rekor"] == 1
    assert calls["solana"] == 1

    def fake_rekor2(doc, pem):
        calls["rekor"] += 1
        return {"url": "https://example.test/x2"}

    def fake_solana2(memo, seed_hex):
        calls["solana"] += 1
        return {"url": "https://example.test/x2"}

    rec2 = write_report_record(report, check_sha256, store=store, now=lambda: 0, rekor=fake_rekor2, solana=fake_solana2, environ=env)
    assert rec2 is rec1
    assert calls["rekor"] == 1
    assert calls["solana"] == 1


def test_same_key_different_summary_writes_new_record_and_replaces_store():
    store = DictStore()
    check_sha256 = "c" * 64
    report1 = _report(extra={"summary": "first"})
    calls = {"rekor": 0, "solana": 0}

    def fake_rekor(doc, pem):
        calls["rekor"] += 1
        return {"url": "https://example.test/x"}

    def fake_solana(memo, seed_hex):
        calls["solana"] += 1
        return {"url": "https://example.test/x"}

    env = {"REKOR_SIGNING_KEY": "pem", "SOLANA_DEVNET_SEED": "00" * 32}
    rec1 = write_report_record(report1, check_sha256, store=store, now=lambda: 0, rekor=fake_rekor, solana=fake_solana, environ=env)
    assert rec1 is not None
    assert calls["rekor"] == 1
    assert calls["solana"] == 1
    key = report_record_key("owner", "repo", "abc123", "1")
    assert store.get(key) is rec1

    report2 = _report(extra={"summary": "second"})

    def fake_rekor2(doc, pem):
        calls["rekor"] += 1
        return {"url": "https://example.test/x2"}

    def fake_solana2(memo, seed_hex):
        calls["solana"] += 1
        return {"url": "https://example.test/x2"}

    rec2 = write_report_record(report2, check_sha256, store=store, now=lambda: 1, rekor=fake_rekor2, solana=fake_solana2, environ=env)
    assert rec2 is not None
    assert rec2 is not rec1
    assert calls["rekor"] == 2
    assert calls["solana"] == 2
    assert rec2["sha256"] != rec1["sha256"]
    assert store.get(key) is rec2


def test_with_no_env_keys_record_has_none_and_nothing_stored():
    store = DictStore()
    report = _report()
    check_sha256 = "d" * 64

    def fake_rekor(doc, pem):
        raise AssertionError("should not be called")

    def fake_solana(memo, seed_hex):
        raise AssertionError("should not be called")

    env = {}
    rec = write_report_record(report, check_sha256, store=store, now=lambda: 0, rekor=fake_rekor, solana=fake_solana, environ=env)
    assert rec is not None
    assert rec["rekor"] is None
    assert rec["solana"] is None
    assert len(store.d) == 0


def test_report_missing_cw_version_gives_none():
    store = DictStore()
    report = {"owner": "owner", "repo": "repo", "commit": "abc123"}

    def fake_rekor(doc, pem):
        raise AssertionError("should not be called")

    def fake_solana(memo, seed_hex):
        raise AssertionError("should not be called")

    env = {"REKOR_SIGNING_KEY": "pem", "SOLANA_DEVNET_SEED": "00" * 32}
    rec = write_report_record(report, "e" * 64, store=store, now=lambda: 0, rekor=fake_rekor, solana=fake_solana, environ=env)
    assert rec is None
    assert len(store.d) == 0


def test_check_sha256_none_still_works_and_memo_check_empty():
    store = DictStore()
    report = _report()
    captured = {}

    def fake_rekor(doc, pem):
        return {"url": "https://example.test/x"}

    def fake_solana(memo, seed_hex):
        captured["memo"] = memo
        return {"url": "https://example.test/x"}

    env = {"REKOR_SIGNING_KEY": "pem", "SOLANA_DEVNET_SEED": "00" * 32}
    rec = write_report_record(report, None, store=store, now=lambda: 0, rekor=fake_rekor, solana=fake_solana, environ=env)
    assert rec is not None
    assert rec["check_sha256"] is None
    doc_obj = json.loads(rec["document"])
    assert doc_obj["check_sha256"] is None
    memo_obj = json.loads(captured["memo"])
    assert memo_obj["check"] == ""
    assert memo_obj["app"] == "yokoten-doctor-report/1"
