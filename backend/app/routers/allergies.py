"""Allergy master list. The person records what they are allergic to; every medicine check, the review screen, the
home page and the medicine reminders then flag a prescribed medicine that matches. Matching is deterministic
(see services/med_safety/allergy.py). Nothing here is sent to the AI."""
import logging

from fastapi import APIRouter, Depends, Response

from ..audit import audit
from ..auth import CurrentUser, get_current_user
from ..deps import get_db
from ..errors import ApiError
from ..schemas.care import AllergyIn, AllergyPatch, ScreenRequest
from ..services.med_safety import allergy, care
from .medication_safety import _uuid, guarded

log = logging.getLogger("healthcopilot.allergy")
router = APIRouter(prefix="/api/v1/allergies", tags=["allergies"])
MAX_ALLERGIES = 100


def _present(prepared: dict, row: dict) -> dict:
    return {"id": row["id"], "substance": row["substance"], "severity": row.get("severity") or "unknown", "reaction": row.get("reaction"),
            "notes": row.get("notes"), "created_at": row.get("created_at"), **{"check": allergy.describe(prepared)}}


def _rows(db, user_id: str) -> list[dict]:
    return db.table("allergies").select(allergy.COLS).eq("user_id", user_id).order("created_at").limit(200).execute().data


def _owned(db, allergy_id: str, user_id: str) -> dict:
    _uuid(allergy_id, "Allergy")
    rows = db.table("allergies").select(allergy.COLS).eq("id", allergy_id).eq("user_id", user_id).limit(1).execute().data
    if not rows:
        raise ApiError(404, "not_found", "Allergy not found.")
    return rows[0]


@router.get("")
@guarded
def list_allergies(user: CurrentUser = Depends(get_current_user)):
    rows = _rows(get_db(), user.id)
    return {"items": [_present(p, r) for p, r in zip(allergy.prepare(rows), rows)], "total": len(rows)}


@router.post("", status_code=201)
@guarded
def add_allergy(body: AllergyIn, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    rows = _rows(db, user.id)
    if len(rows) >= MAX_ALLERGIES:
        raise ApiError(409, "allergy_limit", "The allergy list is full.")
    if any(r["substance"].strip().lower() == body.substance.lower() for r in rows):
        raise ApiError(409, "allergy_exists", "This allergy is already on your list.")
    row = db.table("allergies").insert({"user_id": user.id, **body.model_dump()}).execute().data[0]
    audit(db, user.id, "allergy.added", "allergy", row["id"], {"severity": body.severity})
    return _present(allergy.prepare([row])[0], row)


@router.patch("/{allergy_id}")
@guarded
def edit_allergy(allergy_id: str, body: AllergyPatch, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    row = _owned(db, allergy_id, user.id)
    upd = body.model_dump(exclude_unset=True)
    if upd.get("substance") is None:
        upd.pop("substance", None)
    if upd.get("severity") is None:
        upd.pop("severity", None)
    if "substance" in upd and any(r["id"] != allergy_id and r["substance"].strip().lower() == upd["substance"].lower() for r in _rows(db, user.id)):
        raise ApiError(409, "allergy_exists", "This allergy is already on your list.")
    if upd:
        row = db.table("allergies").update(upd).eq("id", allergy_id).eq("user_id", user.id).execute().data[0]
        audit(db, user.id, "allergy.updated", "allergy", allergy_id, {"fields": sorted(upd)})
    return _present(allergy.prepare([row])[0], row)


@router.delete("/{allergy_id}", status_code=204)
@guarded
def delete_allergy(allergy_id: str, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    _owned(db, allergy_id, user.id)
    db.table("allergies").delete().eq("id", allergy_id).eq("user_id", user.id).execute()
    audit(db, user.id, "allergy.deleted", "allergy", allergy_id)
    return Response(status_code=204)


@router.post("/screen")
@guarded
def screen(body: ScreenRequest, user: CurrentUser = Depends(get_current_user)):
    """Check medicines (e.g. the ones on the review screen, before confirming) against the allergy list. Stores nothing."""
    allergies = allergy.load(get_db(), user.id)
    meds = [{"id": f"s{i}", "name": m.name, "strength": m.strength} for i, m in enumerate(body.medicines, 1)]
    return {"allergies": len(allergies), **care.screen_medicines(meds, allergies)}


@router.get("/alerts")
@guarded
def alerts(user: CurrentUser = Depends(get_current_user)):
    """Medicines already prescribed in the user's confirmed documents that match a recorded allergy."""
    db = get_db()
    allergies = allergy.load(db, user.id)
    if not allergies:
        return {"allergies": 0, "alerts": [], "unchecked": [], "unmatched_allergies": []}
    return {"allergies": len(allergies), **care.medication_alerts(db, user.id, allergies)}
