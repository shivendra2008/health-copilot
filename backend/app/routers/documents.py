import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, Response, UploadFile
from pydantic import ValidationError

from ..audit import audit
from ..auth import CurrentUser, get_current_user
from ..config import get_settings
from ..deps import Pagination, get_db, owned_document
from ..errors import ApiError
from ..ratelimit import check_rate_limit
from ..schemas.api import (ConfirmResponse, DocumentOut, ExtractionHistoryItem, ExtractionOut, ExtractionPatch,
                           Page, ProcessRequest, SummaryRequest, UploadResponse)
from ..schemas.extraction import SECTIONS, ExtractionData
from ..services.files import validate_upload
from ..services.groq_client import LLMError
from ..services.med_safety import kidney
from ..services.pipeline import IN_PROGRESS, is_stale, now_iso, process_document
from ..services.records import replace_records
from ..services.summary import derived_comparisons, generate_summary
from ..services.validation import assign_keys, has_blocking, validate

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])

DOC_COLS = ("id,file_name,mime_type,size_bytes,page_count,doc_type,document_date,source_facility,source_clinician,"
            "status,status_detail,error_code,text_method,ocr_confidence,attempts,created_at,updated_at,confirmed_at")


def _start_processing(db, bg: BackgroundTasks, doc: dict, user_id: str, language: str) -> dict:
    if doc["status"] in IN_PROGRESS and not is_stale(doc):
        raise ApiError(409, "already_processing", "This document is already being processed.")
    upd = (db.table("documents").update({
        "status": "extracting_text", "status_detail": "Queued", "error_code": None,
        "attempts": (doc.get("attempts") or 0) + 1, "processing_started_at": now_iso(),
    }).eq("id", doc["id"]).eq("user_id", user_id).execute())
    bg.add_task(process_document, doc["id"], user_id, language)
    return upd.data[0]


@router.post("", response_model=UploadResponse, status_code=201)
def upload_document(response: Response, bg: BackgroundTasks, file: UploadFile = File(...),
                    language: str = Query("en", pattern="^(en|hi|mr|te)$"),
                    user: CurrentUser = Depends(get_current_user)):
    check_rate_limit(user.id, "upload", get_settings().rate_limit_uploads)
    db = get_db()
    s = get_settings()
    data = file.file.read(s.max_upload_bytes + 1)
    vf = validate_upload(file.filename or "", file.content_type, data)

    existing = (db.table("documents").select(DOC_COLS).eq("user_id", user.id).eq("sha256", vf.sha256)
                .limit(1).execute().data)
    if existing:
        response.status_code = 200
        return UploadResponse(document=DocumentOut(**existing[0]), duplicate=True)

    doc_id = str(uuid.uuid4())
    ext = vf.safe_name.rsplit(".", 1)[-1].lower()
    path = f"{user.id}/{doc_id}.{ext}"
    try:
        db.storage.from_(s.storage_bucket).upload(path, data, {"content-type": vf.mime_type, "upsert": "false"})
    except Exception:
        raise ApiError(502, "storage_error", "The file could not be stored. Please try again.")
    try:
        row = db.table("documents").insert({
            "id": doc_id, "user_id": user.id, "file_name": vf.safe_name, "storage_path": path,
            "mime_type": vf.mime_type, "size_bytes": vf.size, "sha256": vf.sha256, "page_count": vf.page_count,
        }).execute().data[0]
    except Exception:
        db.storage.from_(s.storage_bucket).remove([path])
        raise
    audit(db, user.id, "document.uploaded", "document", doc_id, {"mime": vf.mime_type, "size": vf.size})
    row = _start_processing(db, bg, row, user.id, language)
    return UploadResponse(document=DocumentOut(**row))


@router.get("", response_model=Page[DocumentOut])
def list_documents(p: Pagination = Depends(), status: str | None = None, doc_type: str | None = None,
                   q: str | None = Query(None, max_length=100), user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    query = db.table("documents").select(DOC_COLS, count="exact").eq("user_id", user.id)
    if status == "pending_review":
        query = query.eq("status", "needs_review")
    elif status == "processing":
        query = query.in_("status", ["uploaded", *IN_PROGRESS])
    elif status:
        query = query.eq("status", status)
    if doc_type:
        query = query.eq("doc_type", doc_type)
    if q:
        safe = q.replace("%", "").replace(",", " ").replace("(", "").replace(")", "")
        query = query.or_(f"file_name.ilike.%{safe}%,source_facility.ilike.%{safe}%")
    res = query.order("created_at", desc=True).range(*p.range).execute()
    return Page(items=[DocumentOut(**r) for r in res.data], total=res.count or 0, limit=p.limit, offset=p.offset)


@router.get("/{doc_id}", response_model=DocumentOut)
def get_document(doc_id: str, user: CurrentUser = Depends(get_current_user)):
    return DocumentOut(**owned_document(get_db(), doc_id, user.id, DOC_COLS))


@router.get("/{doc_id}/file")
def get_document_file(doc_id: str, user: CurrentUser = Depends(get_current_user)):
    """Short-lived signed URL to the original file in the private bucket."""
    db = get_db()
    s = get_settings()
    doc = owned_document(db, doc_id, user.id, "id,storage_path,mime_type,file_name")
    try:
        signed = db.storage.from_(s.storage_bucket).create_signed_url(doc["storage_path"], s.signed_url_ttl_seconds)
    except Exception:
        raise ApiError(502, "storage_error", "Could not create a download link.")
    url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("signed_url")
    audit(db, user.id, "document.viewed", "document", doc_id)
    return {"url": url, "expires_in": s.signed_url_ttl_seconds, "mime_type": doc["mime_type"], "file_name": doc["file_name"]}


@router.get("/{doc_id}/text")
def get_document_text(doc_id: str, user: CurrentUser = Depends(get_current_user)):
    """Text read from the document (native or OCR), used to show where each value came from."""
    doc = owned_document(get_db(), doc_id, user.id, "id,extracted_text,text_method,ocr_confidence,page_count")
    if not doc.get("extracted_text"):
        raise ApiError(404, "no_text", "Text has not been read from this document yet.")
    return {"text": doc["extracted_text"], "method": doc["text_method"],
            "ocr_confidence": doc["ocr_confidence"], "page_count": doc["page_count"]}


@router.post("/{doc_id}/process", response_model=DocumentOut, status_code=202)
def process(doc_id: str, bg: BackgroundTasks, body: ProcessRequest | None = None,
            user: CurrentUser = Depends(get_current_user)):
    check_rate_limit(user.id, "process", get_settings().rate_limit_processing)
    db = get_db()
    doc = owned_document(db, doc_id, user.id)
    row = _start_processing(db, bg, doc, user.id, (body or ProcessRequest()).language)
    audit(db, user.id, "document.process_requested", "document", doc_id, {"attempt": row["attempts"]})
    return DocumentOut(**row)


def _latest_extraction(db, doc_id: str, user_id: str) -> dict:
    res = (db.table("extractions").select("*").eq("document_id", doc_id).eq("user_id", user_id)
           .neq("status", "superseded").order("version", desc=True).limit(1).execute().data)
    if not res:
        res = (db.table("extractions").select("*").eq("document_id", doc_id).eq("user_id", user_id)
               .order("version", desc=True).limit(1).execute().data)
    if not res:
        raise ApiError(404, "no_extraction", "This document has not been analysed yet.")
    return res[0]


def _to_out(ex: dict) -> ExtractionOut:
    data = ExtractionData.model_validate(ex["current_data"])
    return ExtractionOut(
        id=ex["id"], document_id=ex["document_id"], version=ex["version"], model=ex.get("model"),
        status=ex["status"], data=data, ai_output=ExtractionData.model_validate(ex["ai_output"]),
        issues=ex.get("issues") or [], derived=derived_comparisons(data), summary=ex.get("summary"),
        corrected_at=ex.get("corrected_at"), confirmed_at=ex.get("confirmed_at"), created_at=ex["created_at"],
    )


@router.get("/{doc_id}/extraction", response_model=ExtractionOut)
def get_extraction(doc_id: str, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    owned_document(db, doc_id, user.id, "id")
    return _to_out(_latest_extraction(db, doc_id, user.id))


@router.get("/{doc_id}/extractions", response_model=list[ExtractionHistoryItem])
def extraction_history(doc_id: str, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    owned_document(db, doc_id, user.id, "id")
    rows = (db.table("extractions").select("id,version,status,model,created_at,corrected_at,confirmed_at")
            .eq("document_id", doc_id).eq("user_id", user.id).order("version", desc=True).execute().data)
    return [ExtractionHistoryItem(**r) for r in rows]


_META = {"key", "origin", "user_corrected"}


def mark_corrections(edited: ExtractionData, ai: ExtractionData) -> ExtractionData:
    """Flags items that differ from the original AI output; unknown keys are user-added."""
    for section in SECTIONS:
        originals = {i.key: i.model_dump(exclude=_META) for i in getattr(ai, section)}
        for item in getattr(edited, section):
            if item.key and item.key in originals:
                item.origin = "ai"
                item.user_corrected = item.model_dump(exclude=_META) != originals[item.key]
            else:
                item.key = None
                item.origin = "user"
                item.user_corrected = True
    return assign_keys(edited)


@router.patch("/{doc_id}/extraction", response_model=ExtractionOut)
def correct_extraction(doc_id: str, body: ExtractionPatch, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    doc = owned_document(db, doc_id, user.id, "id,status,extracted_text,ocr_confidence")
    ex = _latest_extraction(db, doc_id, user.id)
    if ex["status"] == "superseded":
        raise ApiError(409, "stale_extraction", "This extraction has been replaced by a newer one.")
    ai = ExtractionData.model_validate(ex["ai_output"])
    edited = mark_corrections(body.data, ai)
    conf = float(doc["ocr_confidence"]) if doc.get("ocr_confidence") is not None else None
    issues = validate(edited, doc.get("extracted_text") or "", conf)
    upd = db.table("extractions").update({
        "current_data": edited.model_dump(), "issues": issues, "corrected_at": now_iso(),
        # editing a confirmed extraction re-opens review
        "status": "pending_review",
    }).eq("id", ex["id"]).eq("user_id", user.id).execute().data[0]
    if doc["status"] == "confirmed":
        db.table("documents").update({"status": "needs_review"}).eq("id", doc_id).eq("user_id", user.id).execute()
    changed = sum(1 for s in SECTIONS for i in getattr(edited, s) if i.user_corrected)
    audit(db, user.id, "extraction.corrected", "extraction", ex["id"], {"items_corrected": changed})
    return _to_out(upd)


def _kidney_recheck(db, user_id: str, doc_id: str, data: ExtractionData) -> dict | None:
    """A new kidney result re-evaluates the kidney-related medication rules. Isolated on purpose: a failure here (for
    example the migration 0006 not applied yet) must never block confirming a document."""
    if not kidney.has_kidney_result(data.lab_results):
        return None
    try:
        r = kidney.recheck(db, user_id, trigger_document_id=doc_id)
    except Exception as e:  # noqa: BLE001
        logging.getLogger("healthcopilot").warning("kidney recheck skipped: %s", type(e).__name__)
        return None
    k = r["kidney"]
    return {"status": k["status"], "egfr": k["egfr"], "method": k["method"], "observed_date": k["observed_date"],
            "reason": k["reason"], "medicines_checked": r["medicines_checked"], "findings": len(r["findings"]),
            "changed": r["changed"], "previous_status": r["previous_status"]}


@router.post("/{doc_id}/confirm", response_model=ConfirmResponse)
def confirm(doc_id: str, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    doc = owned_document(db, doc_id, user.id)
    if doc["status"] in IN_PROGRESS:
        raise ApiError(409, "already_processing", "Wait for processing to finish before confirming.")
    ex = _latest_extraction(db, doc_id, user.id)
    issues = ex.get("issues") or []
    if has_blocking(issues):
        raise ApiError(422, "unresolved_issues", "Fix the highlighted errors before confirming.",
                       [i for i in issues if i["severity"] == "error"])
    data = ExtractionData.model_validate(ex["current_data"])
    ai = ExtractionData.model_validate(ex["ai_output"])
    counts = replace_records(db, user.id, doc, ex["id"], data, ai)
    ts = now_iso()
    db.table("extractions").update({"status": "superseded"}).eq("document_id", doc_id).eq("user_id", user.id) \
        .eq("status", "confirmed").neq("id", ex["id"]).execute()
    db.table("extractions").update({"status": "confirmed", "confirmed_at": ts}).eq("id", ex["id"]).execute()
    row = db.table("documents").update({
        "status": "confirmed", "confirmed_at": ts, "doc_type": data.document_type,
        "document_date": data.document_date, "source_facility": data.facility, "source_clinician": data.clinician,
        "status_detail": None,
    }).eq("id", doc_id).eq("user_id", user.id).execute().data[0]
    audit(db, user.id, "extraction.confirmed", "extraction", ex["id"], counts)
    return ConfirmResponse(document=DocumentOut(**row), records=counts, kidney_recheck=_kidney_recheck(db, user.id, doc_id, data))


@router.post("/{doc_id}/summary", response_model=ExtractionOut)
def regenerate_summary(doc_id: str, body: SummaryRequest, user: CurrentUser = Depends(get_current_user)):
    check_rate_limit(user.id, "process", get_settings().rate_limit_processing)
    db = get_db()
    owned_document(db, doc_id, user.id, "id")
    ex = _latest_extraction(db, doc_id, user.id)
    data = ExtractionData.model_validate(ex["current_data"])
    try:
        new = generate_summary(data, body.language, max_wait=20.0)
    except LLMError as e:
        raise ApiError(503 if e.code != "ai_rate_limited" else 429, e.code, e.message)
    except ValidationError:
        raise ApiError(502, "ai_invalid_output", "The AI summary did not pass validation. Please retry.")
    summary = {**(ex.get("summary") or {}), body.language: new}
    upd = db.table("extractions").update({"summary": summary}).eq("id", ex["id"]).eq("user_id", user.id).execute()
    audit(db, user.id, "summary.generated", "extraction", ex["id"], {"language": body.language})
    return _to_out(upd.data[0])


@router.delete("/{doc_id}", status_code=204)
def delete_document(doc_id: str, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    doc = owned_document(db, doc_id, user.id, "id,storage_path")
    try:
        db.storage.from_(get_settings().storage_bucket).remove([doc["storage_path"]])
    except Exception:
        raise ApiError(502, "storage_error", "The file could not be deleted. Please try again.")
    db.table("documents").delete().eq("id", doc_id).eq("user_id", user.id).execute()  # cascades records
    audit(db, user.id, "document.deleted", "document", doc_id)
    return Response(status_code=204)
