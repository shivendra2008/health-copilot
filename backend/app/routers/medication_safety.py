"""Medication Safety (prototype). Deterministic checks over a USER-CONFIRMED medicine list.

Isolation: this router only reads documents/medications/profile and writes its own two tables, so a failure
here can never affect upload, OCR, review or the assistant. The catalogue and ruleset are demo-curated.
"""
import logging
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from functools import wraps

from fastapi import APIRouter, Depends, Query, Response

from ..audit import audit
from ..auth import CurrentUser, get_current_user
from ..config import get_settings
from ..deps import Pagination, get_db, owned_document
from ..errors import ApiError
from ..ratelimit import check_rate_limit
from ..schemas.med_safety import (CheckRequest, ConfirmedMedicationPatch, EDITABLE_FIELDS, ExplainRequest,
                                  ManualMedicationRequest, ResolveBrandRequest)
from ..services.groq_client import LLMError, chat_json
from ..services.med_safety import catalogue as cat
from ..services.med_safety.engine import run_check, ruleset
from ..services.med_safety.explain import (EXPLAIN_SCHEMA, explain_prompt, numbers_are_grounded, plain_english)

log = logging.getLogger("healthcopilot.medsafety")
router = APIRouter(prefix="/api/v1/medication-safety", tags=["medication-safety"])

MED_COLS = ("id,document_id,name,strength,dosage,frequency,duration,route,instructions,prescription_date,current_status,"
            "status_confirmed_at,uncertain_fields,catalogue_id,resolution_status,resolution_confidence,"
            "resolution_candidates,created_at,updated_at")
SNAPSHOT_KEYS = ("id", "document_id", "name", "strength", "dosage", "frequency", "duration", "route", "instructions",
                 "prescription_date", "current_status", "uncertain_fields", "catalogue_id", "resolution_status",
                 "resolution_confidence")


def guarded(fn):
    """A database without migration 0004 must give a clear 503, not a generic 500."""
    @wraps(fn)
    def inner(*a, **k):
        try:
            return fn(*a, **k)
        except ApiError:
            raise
        except Exception as e:  # noqa: BLE001
            if any(t in str(e) for t in ("PGRST205", "PGRST200", "does not exist", "schema cache")):
                raise ApiError(503, "medication_safety_not_ready",
                               "Medication Safety is not set up yet. The database migration 0004 has not been applied.")
            raise
    return inner


def _uuid(value: str, what: str) -> str:
    try:
        uuid.UUID(value)
    except (ValueError, TypeError):
        raise ApiError(404, "not_found", f"{what} not found.")
    return value


def _owned_med(db, med_id: str, user_id: str) -> dict:
    _uuid(med_id, "Medicine")
    rows = db.table("confirmed_medications").select(MED_COLS).eq("id", med_id).eq("user_id", user_id).limit(1).execute().data
    if not rows:
        raise ApiError(404, "not_found", "Medicine not found.")
    return rows[0]


def _owned_report(db, report_id: str, user_id: str) -> dict:
    _uuid(report_id, "Report")
    rows = db.table("medication_safety_reports").select("*").eq("id", report_id).eq("user_id", user_id).limit(1).execute().data
    if not rows:
        raise ApiError(404, "not_found", "Report not found.")
    return rows[0]


def _resolution_fields(res: cat.Resolution) -> dict:
    return {"resolution_status": res.status, "catalogue_id": res.catalogue_id,
            "resolution_confidence": res.confidence, "resolution_candidates": res.candidates}


def _present(row: dict) -> dict:
    """Attach the matched catalogue entry (name + ingredients) so the UI can show what a medicine resolved to."""
    return {**row, "catalogue_entry": cat.entry_brief(row.get("catalogue_id") or "")}


def _with_labels(report: dict) -> dict:
    return {**report, "ruleset_label": ruleset()["label"], "catalogue_label": cat.catalogue()["label"]}


# ----------------------------------------------------------------------------- catalogue
@router.get("/medicines/search")
def search_medicines(q: str = Query(..., min_length=2, max_length=100), user: CurrentUser = Depends(get_current_user)):
    c = cat.catalogue()
    return {"items": cat.search(q), "catalogue_version": c["version"], "catalogue_label": c["label"]}


@router.post("/resolve-brand")
def resolve_brand(body: ResolveBrandRequest, user: CurrentUser = Depends(get_current_user)):
    """Stateless: shows how a name would resolve and which catalogue candidates exist. Nothing is saved
    until the user confirms a choice with PATCH /confirmed-medications/{id}."""
    return cat.resolve(body.name, body.strength).as_dict()


# ----------------------------------------------------------------------------- confirmed medicines
@router.get("/confirmed-medications")
@guarded
def list_confirmed(document_id: str | None = None, current_only: bool = False,
                   user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    q = db.table("confirmed_medications").select(MED_COLS).eq("user_id", user.id)
    if document_id:
        q = q.eq("document_id", _uuid(document_id, "Document"))
    if current_only:
        q = q.eq("current_status", "current")
    return {"items": [_present(r) for r in q.order("created_at").limit(500).execute().data]}


@router.post("/confirmed-medications/from-document/{document_id}")
@guarded
def seed_from_document(document_id: str, user: CurrentUser = Depends(get_current_user)):
    """Copy a CONFIRMED document's medicines into the user's editable confirmed list (idempotent).
    Current-use status starts as 'unknown' — it is never assumed."""
    db = get_db()
    doc = owned_document(db, document_id, user.id, "id,document_date,created_at,status")
    if doc["status"] != "confirmed":
        raise ApiError(409, "document_not_confirmed", "Confirm the extracted details of this document first.")
    src = db.table("medications").select("*").eq("document_id", document_id).eq("user_id", user.id).execute().data
    have = {r["source_item_key"] for r in db.table("confirmed_medications").select("source_item_key")
            .eq("user_id", user.id).eq("document_id", document_id).execute().data}
    rx_date = doc["document_date"] or doc["created_at"][:10]
    new = []
    for m in src:
        if m["item_key"] in have:
            continue
        new.append({"user_id": user.id, "document_id": document_id, "source_item_key": m["item_key"],
                    "prescription_date": rx_date, "current_status": "unknown",
                    **{k: m.get(k) for k in EDITABLE_FIELDS},
                    **_resolution_fields(cat.resolve(m["name"], m.get("strength")))})
    if new:
        db.table("confirmed_medications").insert(new).execute()
    audit(db, user.id, "medsafety.list_seeded", "document", document_id, {"added": len(new)})
    rows = db.table("confirmed_medications").select(MED_COLS).eq("user_id", user.id).eq("document_id", document_id).order("created_at").execute().data
    return {"items": [_present(r) for r in rows], "added": len(new)}


@router.post("/confirmed-medications", status_code=201)
@guarded
def add_manual(body: ManualMedicationRequest, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    data = body.model_dump()
    row = {"user_id": user.id, **data, **_resolution_fields(cat.resolve(body.name, body.strength)),
           "status_confirmed_at": datetime.now(timezone.utc).isoformat() if body.current_status != "unknown" else None}
    return _present(db.table("confirmed_medications").insert(row).execute().data[0])


@router.patch("/confirmed-medications/{med_id}")
@guarded
def patch_confirmed(med_id: str, body: ConfirmedMedicationPatch, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    row = _owned_med(db, med_id, user.id)
    data = body.model_dump(exclude_unset=True)
    resolution = data.pop("resolution", None)
    upd = {k: data[k] for k in EDITABLE_FIELDS if k in data}
    if "name" in upd and not upd["name"]:
        raise ApiError(422, "validation_error", "Medicine name cannot be empty.")
    if data.get("current_status") is not None:
        upd["current_status"] = data["current_status"]
        upd["status_confirmed_at"] = (datetime.now(timezone.utc).isoformat()
                                      if data["current_status"] != "unknown" else None)
    if data.get("uncertain_fields") is not None:
        upd["uncertain_fields"] = sorted(set(data["uncertain_fields"]))

    if resolution and resolution["action"] == "select":
        if not cat.entry_brief(resolution.get("catalogue_id") or ""):
            raise ApiError(422, "unknown_catalogue_entry", "That medicine is not in the catalogue.")
        upd.update(resolution_status="user_selected", catalogue_id=resolution["catalogue_id"],
                   resolution_confidence="user_confirmed", resolution_candidates=[])
    elif resolution and resolution["action"] == "unresolved":
        upd.update(resolution_status="user_unresolved", catalogue_id=None, resolution_confidence="none",
                   resolution_candidates=[])
    elif (resolution and resolution["action"] == "auto") or "name" in upd or "strength" in upd:
        # A changed name/strength invalidates the earlier match, so it is re-resolved (never carried over).
        upd.update(_resolution_fields(cat.resolve(upd.get("name", row["name"]), upd.get("strength", row["strength"]))))
    if not upd:
        return _present(row)
    updated = db.table("confirmed_medications").update(upd).eq("id", med_id).eq("user_id", user.id).execute().data
    audit(db, user.id, "medsafety.medicine_updated", "confirmed_medication", med_id, {"fields": sorted(upd)})
    return _present(updated[0])


@router.delete("/confirmed-medications/{med_id}", status_code=204)
@guarded
def delete_confirmed(med_id: str, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    _owned_med(db, med_id, user.id)
    db.table("confirmed_medications").delete().eq("id", med_id).eq("user_id", user.id).execute()
    return Response(status_code=204)


# ----------------------------------------------------------------------------- checks & reports
def _adult(db, user_id: str) -> bool | None:
    p = (db.table("profiles").select("age_years,date_of_birth").eq("id", user_id).limit(1).execute().data or [{}])[0]
    age = p.get("age_years")
    if age is None and p.get("date_of_birth"):
        try:
            dob = date.fromisoformat(p["date_of_birth"][:10])
            today = date.today()
            age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        except ValueError:
            age = None
    return None if age is None else age >= 18


@router.post("/check", status_code=201)
@guarded
def check(body: CheckRequest, user: CurrentUser = Depends(get_current_user)):
    check_rate_limit(user.id, "medsafety", get_settings().rate_limit_processing)
    db = get_db()
    q = db.table("confirmed_medications").select(MED_COLS).eq("user_id", user.id)
    doc_id = None
    if body.source_type == "document":
        if not body.document_id:
            raise ApiError(422, "validation_error", "document_id is required to check a prescription.")
        doc_id = owned_document(db, body.document_id, user.id, "id")["id"]
        meds = q.eq("document_id", doc_id).order("created_at").limit(200).execute().data
        if body.include_current:
            extra = (db.table("confirmed_medications").select(MED_COLS).eq("user_id", user.id)
                     .eq("current_status", "current").neq("document_id", doc_id).limit(200).execute().data)
            meds += extra + [r for r in db.table("confirmed_medications").select(MED_COLS).eq("user_id", user.id)
                             .eq("current_status", "current").is_("document_id", "null").limit(200).execute().data]
    else:
        meds = q.eq("current_status", "current").order("created_at").limit(200).execute().data
    meds = list({m["id"]: m for m in meds}.values())
    if not meds:
        raise ApiError(409, "no_confirmed_medications",
                       "There are no confirmed medicines to check yet. Review and confirm your medicines first.")

    patient = {"adult": _adult(db, user.id)}
    try:
        result = run_check(meds, patient)
    except Exception as exc:  # noqa: BLE001 — engine bugs must not leak details or affect anything else
        log.error("safety check failed: %s", type(exc).__name__)
        raise ApiError(503, "check_failed", "The safety check could not be completed. Your documents are not affected. Please retry.")

    row = {
        "user_id": user.id, "source_type": body.source_type, "document_id": doc_id,
        "include_current": body.include_current if body.source_type == "document" else False,
        "ruleset_version": result["ruleset_version"], "catalogue_version": result["catalogue_version"],
        "medication_snapshot": [{k: m.get(k) for k in SNAPSHOT_KEYS} for m in meds],
        "patient_context": patient, "findings": result["findings"], "unresolved": result["unresolved"],
        "missing_information": result["missing_information"], "limitations": result["limitations"],
        "summary": result["summary"],
    }
    saved = db.table("medication_safety_reports").insert(row).execute().data[0]
    audit(db, user.id, "medsafety.checked", "report", saved["id"],
          {"source": body.source_type, "medicines": len(meds), "findings": result["summary"]["total_findings"]})
    return _with_labels(saved)


@router.get("/reports")
@guarded
def list_reports(p: Pagination = Depends(), document_id: str | None = None, user: CurrentUser = Depends(get_current_user)):
    q = (get_db().table("medication_safety_reports")
         .select("id,source_type,document_id,include_current,ruleset_version,summary,created_at", count="exact")
         .eq("user_id", user.id))
    if document_id:
        q = q.eq("document_id", _uuid(document_id, "Document"))
    res = q.order("created_at", desc=True).range(*p.range).execute()
    return {"items": res.data, "total": res.count or 0, "limit": p.limit, "offset": p.offset}


@router.get("/reports/{report_id}")
@guarded
def get_report(report_id: str, user: CurrentUser = Depends(get_current_user)):
    return _with_labels(_owned_report(get_db(), report_id, user.id))


@router.delete("/reports/{report_id}", status_code=204)
@guarded
def delete_report(report_id: str, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    _owned_report(db, report_id, user.id)
    db.table("medication_safety_reports").delete().eq("id", report_id).eq("user_id", user.id).execute()
    return Response(status_code=204)


@router.post("/reports/{report_id}/explain")
@guarded
def explain_report(report_id: str, body: ExplainRequest, user: CurrentUser = Depends(get_current_user)):
    """Ask the assistant to explain the SAVED report. It only rewords verified findings; any answer containing
    a number that is not in the report is discarded in favour of the deterministic English text."""
    check_rate_limit(user.id, "chat", get_settings().rate_limit_chat)
    db = get_db()
    report = _owned_report(db, report_id, user.id)
    cached = (report.get("explanations") or {}).get(body.language)
    if cached:
        return {"report_id": report_id, "language": body.language, "content": cached["content"],
                "generated_by": cached["generated_by"]}
    system, prompt = explain_prompt(report, body.language)
    try:
        raw, _ = chat_json(system, prompt, "report_explanation", EXPLAIN_SCHEMA, temperature=0.2, max_tokens=1500, max_wait=20.0)
    except LLMError as e:
        raise ApiError(429 if e.code == "ai_rate_limited" else 503, e.code, e.message)
    text = (raw.get("explanation") or "").strip()
    if text and numbers_are_grounded(text, report):
        out = {"content": text, "generated_by": "assistant"}
    else:
        out = {"content": plain_english(report), "generated_by": "deterministic"}
    if out["generated_by"] == "assistant":  # only cache verified output
        db.table("medication_safety_reports").update({"explanations": {**(report.get("explanations") or {}), body.language: out}}) \
            .eq("id", report_id).eq("user_id", user.id).execute()
    audit(db, user.id, "medsafety.explained", "report", report_id, {"language": body.language, "by": out["generated_by"]})
    return {"report_id": report_id, "language": body.language, **out}
