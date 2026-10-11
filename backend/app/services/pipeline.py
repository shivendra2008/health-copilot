"""Document processing pipeline (runs in a worker thread via BackgroundTasks).

uploaded → extracting_text → analyzing → needs_review   (or failed)
Each run creates a NEW extraction version; history is never overwritten.
"""
import logging
from datetime import datetime, timedelta, timezone

from pydantic import ValidationError

from ..audit import audit
from ..config import get_settings
from ..db import get_db
from ..schemas.extraction import ExtractionData, LLMExtraction, LLM_EXTRACTION_JSON_SCHEMA
from .groq_client import LLMError, chat_json
from .ocr import OcrUnavailable
from .prompts import EXTRACTION_SYSTEM, extraction_user
from .summary import generate_summary
from .text_extraction import extract_text
from .validation import assign_keys, validate

log = logging.getLogger("healthcopilot.pipeline")

IN_PROGRESS = ("extracting_text", "analyzing")
STALE_AFTER = timedelta(minutes=10)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_stale(doc: dict) -> bool:
    started = doc.get("processing_started_at")
    if not started:
        return True
    ts = datetime.fromisoformat(started.replace("Z", "+00:00"))
    return datetime.now(timezone.utc) - ts > STALE_AFTER


def _set(db, doc_id: str, user_id: str, **fields):
    db.table("documents").update(fields).eq("id", doc_id).eq("user_id", user_id).execute()


def _fail(db, doc_id, user_id, code, message):
    _set(db, doc_id, user_id, status="failed", error_code=code, status_detail=message)
    audit(db, user_id, "document.process_failed", "document", doc_id, {"code": code})


def process_document(doc_id: str, user_id: str, language: str = "en") -> None:
    db = get_db()
    s = get_settings()
    doc = (db.table("documents").select("*").eq("id", doc_id).eq("user_id", user_id)
           .maybe_single().execute())
    doc = doc.data if doc else None
    if not doc:
        return

    try:
        # 1) text (re-used on retries so OCR is not repeated)
        text = doc.get("extracted_text")
        method, ocr_conf = doc.get("text_method"), doc.get("ocr_confidence")
        ocr_conf = float(ocr_conf) if ocr_conf is not None else None
        if not text:
            pages = doc.get("page_count") or 1
            _set(db, doc_id, user_id, status="extracting_text",
                 status_detail="Reading the image with OCR" if doc["mime_type"].startswith("image/")
                 else f"Reading {pages} page{'s' if pages != 1 else ''}")
            data = db.storage.from_(s.storage_bucket).download(doc["storage_path"])
            try:
                ext = extract_text(data, doc["mime_type"])
            except OcrUnavailable as e:
                return _fail(db, doc_id, user_id, "ocr_unavailable",
                             f"{e} Upload a digital PDF, or enable OCR on the server.")
            text, method, ocr_conf = ext.text, ext.method, ext.ocr_confidence
            if len(text.strip()) < 15:
                return _fail(db, doc_id, user_id, "no_text_found",
                             "No readable text was found. Try a clearer scan or photo with good lighting.")
            _set(db, doc_id, user_id, extracted_text=text, text_method=method,
                 ocr_confidence=ocr_conf, page_count=ext.page_count)

        # 2) structured extraction
        how = {"native": "digital text", "ocr": "OCR", "mixed": "digital text and OCR"}.get(method or "", "text")
        _set(db, doc_id, user_id, status="analyzing",
             status_detail=f"Read {len(text):,} characters using {how}. Extracting medical information")
        truncated = text[: s.llm_max_input_chars]
        raw, model = chat_json(EXTRACTION_SYSTEM, extraction_user(truncated, doc["file_name"]),
                               "medical_document_extraction", LLM_EXTRACTION_JSON_SCHEMA, max_tokens=6000)
        try:
            llm = LLMExtraction.model_validate(raw)
        except ValidationError:
            return _fail(db, doc_id, user_id, "ai_invalid_output",
                         "The AI response did not pass validation. Please retry processing.")

        data = assign_keys(ExtractionData.model_validate(llm.model_dump()))
        issues = validate(data, text, ocr_conf)
        if len(text) > s.llm_max_input_chars:
            issues.append({"path": "document", "field": None, "severity": "warning", "code": "text_truncated",
                           "message": "This document is very long; only the first part was analysed."})

        counts = ((len(data.lab_results), "lab result", "lab results"), (len(data.medications), "medicine", "medicines"),
                  (len(data.conditions), "diagnosis", "diagnoses"))
        found = [f"{n} {one if n == 1 else many}" for n, one, many in counts if n]
        flagged = sum(1 for i in issues if i["severity"] != "info")
        _set(db, doc_id, user_id, status_detail=(f"Found {', '.join(found)}" if found else "No structured data found")
             + f". Checked against the source ({flagged} to review). Writing a plain-language summary")

        # 3) summary (non-fatal)
        summary = None
        try:
            summary = {language: generate_summary(data, language)}
        except (LLMError, ValidationError) as e:
            log.warning("summary failed for doc=%s: %s", doc_id, getattr(e, "code", type(e).__name__))

        # 4) persist new extraction version
        prev = (db.table("extractions").select("version").eq("document_id", doc_id).eq("user_id", user_id)
                .order("version", desc=True).limit(1).execute().data)
        version = (prev[0]["version"] + 1) if prev else 1
        db.table("extractions").update({"status": "superseded"}).eq("document_id", doc_id) \
            .eq("user_id", user_id).eq("status", "pending_review").execute()
        dumped = data.model_dump()
        ins = db.table("extractions").insert({
            "user_id": user_id, "document_id": doc_id, "version": version, "model": model,
            "ai_output": dumped, "current_data": dumped, "issues": issues, "summary": summary,
            "status": "pending_review",
        }).execute()
        _set(db, doc_id, user_id, status="needs_review", status_detail=None, error_code=None,
             doc_type=data.document_type, document_date=data.document_date if not _bad_date(issues) else None,
             source_facility=data.facility, source_clinician=data.clinician)
        audit(db, user_id, "document.processed", "document", doc_id,
              {"extraction_id": ins.data[0]["id"], "version": version, "method": method,
               "issues": len(issues), "lab_results": len(data.lab_results)})
    except LLMError as e:
        _fail(db, doc_id, user_id, e.code, e.message)
    except Exception as e:  # noqa: BLE001
        log.exception("processing failed doc=%s (%s)", doc_id, type(e).__name__)
        _fail(db, doc_id, user_id, "processing_error", "Processing failed unexpectedly. Please retry.")


def _bad_date(issues: list[dict]) -> bool:
    return any(i["path"] == "document" and i["field"] == "document_date" and i["severity"] == "error" for i in issues)
