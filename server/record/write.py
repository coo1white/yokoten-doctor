import datetime
import json
import logging
import os
import time

from .document import document_hash, make_document, make_report_document, memo_text, record_key, report_memo_text, report_record_key

logger = logging.getLogger(__name__)


class RecordFailed(Exception):
    pass


def has_different_result(record, result) -> bool:
    try:
        return json.loads(record["document"])["result"] != json.loads(json.dumps(result))
    except Exception:
        return False


def write_record(result, store=None, now=time.time, rekor=None, solana=None, environ=os.environ) -> dict | None:
    # default imports here to avoid circular at import time for callers that patch
    if rekor is None:
        from .rekor import write_entry as rekor
    if solana is None:
        from .solana import write_memo as solana
    try:
        if not isinstance(result, dict):
            return None
        owner = result.get("owner")
        repo = result.get("repo")
        commit = result.get("commit")
        version = result.get("yokoten_version")
        if not owner or not repo or not commit or not version:
            return None
        owner = str(owner)
        repo = str(repo)
        commit = str(commit)
        version = str(version)

        key = record_key(owner, repo, commit, version)
        if store is not None:
            try:
                existing = store.get(key, None)
            except Exception as e:
                logger.error(type(e).__name__)
                existing = None
            if isinstance(existing, dict) and existing.get("rekor") is not None and not has_different_result(existing, result):
                # both rekor and solana set: return as is
                if existing.get("solana") is not None:
                    return existing
                # rekor set, solana None -> try solana-only retry if seed present
                solana_seed = environ.get("SOLANA_DEVNET_SEED") if hasattr(environ, "get") else None
                try:
                    seed_hex = solana_seed.strip() if isinstance(solana_seed, str) else None
                except Exception:
                    seed_hex = None
                if seed_hex:
                    # keep stored sha256, recorded_at, document, rekor; write only memo
                    sha256 = existing.get("sha256")
                    recorded_at = existing.get("recorded_at")
                    document = existing.get("document")
                    # if stored record lacks sha256, fall back to using it anyway; memo needs sha256
                    # use stored sha256 if present, otherwise cannot retry
                    if sha256:
                        try:
                            memo = memo_text(owner, repo, commit, version, sha256)
                        except Exception as e:
                            logger.error(type(e).__name__)
                            return existing
                        solana_result = None
                        try:
                            solana_result = solana(memo, seed_hex)
                        except Exception as e:
                            logger.error(type(e).__name__)
                            return existing
                        if solana_result is not None:
                            record = {
                                "sha256": sha256,
                                "recorded_at": recorded_at,
                                "document": document,
                                "rekor": existing.get("rekor"),
                                "solana": solana_result,
                            }
                            try:
                                store.put(key, record)
                            except Exception as e:
                                logger.error(type(e).__name__)
                            return record
                        else:
                            return existing
                    # no sha256 stored: return existing without write
                    return existing
                else:
                    return existing

        # recorded_at
        try:
            ts = now()
        except Exception:
            ts = time.time()
        try:
            recorded_at = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            recorded_at = "1970-01-01T00:00:00Z"

        document = make_document(result, recorded_at)
        sha256 = document_hash(document)
        memo = memo_text(owner, repo, commit, version, sha256)

        rekor_result = None
        solana_result = None

        rekor_pem = environ.get("REKOR_SIGNING_KEY") if hasattr(environ, "get") else None
        solana_seed = environ.get("SOLANA_DEVNET_SEED") if hasattr(environ, "get") else None

        if rekor_pem:
            try:
                # turn back \n sequences
                pem_str = rekor_pem.replace("\\n", "\n")
                if pem_str:
                    rekor_result = rekor(document, pem_str)
            except Exception as e:
                logger.error(type(e).__name__)
                rekor_result = None

        if solana_seed:
            try:
                seed_hex = solana_seed.strip()
                if seed_hex:
                    solana_result = solana(memo, seed_hex)
            except Exception as e:
                logger.error(type(e).__name__)
                solana_result = None

        record = {
            "sha256": sha256,
            "recorded_at": recorded_at,
            "document": document.decode("utf-8"),
            "rekor": rekor_result,
            "solana": solana_result,
        }

        if rekor_result is not None or solana_result is not None:
            if store is not None:
                try:
                    store.put(key, record)
                except Exception as e:
                    logger.error(type(e).__name__)

        return record
    except Exception as e:
        logger.error(type(e).__name__)
        return None


def write_report_record(report, check_sha256, store=None, now=time.time, rekor=None, solana=None, environ=os.environ) -> dict | None:
    if rekor is None:
        from .rekor import write_entry as rekor
    if solana is None:
        from .solana import write_memo as solana
    try:
        if not isinstance(report, dict):
            return None
        owner = report.get("owner")
        repo = report.get("repo")
        commit = report.get("commit")
        cw_version = report.get("cw_version")
        if not isinstance(owner, str) or not isinstance(repo, str) or not isinstance(commit, str) or not isinstance(cw_version, str):
            return None
        if not owner or not repo or not commit or not cw_version:
            return None
        body = {k: v for k, v in report.items() if k != "record"}
        key = report_record_key(owner, repo, commit, cw_version)
        if store is not None:
            try:
                existing = store.get(key, None)
            except Exception as e:
                logger.error(type(e).__name__)
                existing = None
            if isinstance(existing, dict) and (existing.get("rekor") is not None or existing.get("solana") is not None):
                try:
                    stored_report = json.loads(existing["document"])["report"]
                    body_norm = json.loads(json.dumps(body))
                    if stored_report == body_norm:
                        return existing
                except Exception:
                    pass
        try:
            ts = now()
        except Exception:
            ts = time.time()
        try:
            recorded_at = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            recorded_at = "1970-01-01T00:00:00Z"
        document = make_report_document(body, check_sha256, recorded_at)
        sha256 = document_hash(document)
        memo = report_memo_text(owner, repo, commit, cw_version, sha256, check_sha256)
        rekor_result = None
        solana_result = None
        rekor_pem = environ.get("REKOR_SIGNING_KEY") if hasattr(environ, "get") else None
        solana_seed = environ.get("SOLANA_DEVNET_SEED") if hasattr(environ, "get") else None
        if rekor_pem:
            try:
                pem_str = rekor_pem.replace("\\n", "\n")
                if pem_str:
                    rekor_result = rekor(document, pem_str)
            except Exception as e:
                logger.error(type(e).__name__)
                rekor_result = None
        if solana_seed:
            try:
                seed_hex = solana_seed.strip()
                if seed_hex:
                    solana_result = solana(memo, seed_hex)
            except Exception as e:
                logger.error(type(e).__name__)
                solana_result = None
        record = {
            "sha256": sha256,
            "recorded_at": recorded_at,
            "document": document.decode("utf-8"),
            "check_sha256": check_sha256,
            "rekor": rekor_result,
            "solana": solana_result,
        }
        if rekor_result is not None or solana_result is not None:
            if store is not None:
                try:
                    store.put(key, record)
                except Exception as e:
                    logger.error(type(e).__name__)
        return record
    except Exception as e:
        logger.error(type(e).__name__)
        return None
