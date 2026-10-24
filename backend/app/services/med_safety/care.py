"""Allergy screening over the user's own confirmed medicines (shared by the allergy API, the confirm hook and the home page)."""
from datetime import date

from . import allergy
from .catalogue import catalogue, resolve
from .kidney import _item


def _split(meds: list[dict]) -> tuple[list[tuple[dict, dict, set[str]]], list[dict]]:
    """Identify each medicine: (resolved with ingredients, unresolved). Same rule as the safety engine: never guess."""
    cat, resolved, unresolved = catalogue(), [], []
    for m in meds:
        r = resolve(m["name"], m.get("strength"))
        entry = cat["by_id"].get(r.catalogue_id) if r.status == "resolved" else None
        if entry:
            resolved.append((m, entry, {i["id"] for i in entry["ingredients"]}))
        else:
            unresolved.append(m)
    return resolved, unresolved


def screen_medicines(meds: list[dict], allergies: list[dict]) -> dict:
    """meds: dicts with id, name, strength. -> {alerts, unchecked, unmatched_allergies}"""
    resolved, unresolved = _split(meds)
    scr = allergy.screen(resolved, unresolved, allergies)
    return {
        "alerts": [alert(h) for h in scr["hits"]],
        "unchecked": [{"id": m["id"], "name": m["name"], "strength": m.get("strength")} for m in scr["unchecked"]],
        "unmatched_allergies": [a["substance"] for a in allergies if a["resolved"]["kind"] == "unmatched"],
    }


def alert(h: dict) -> dict:
    a, m = h["allergy"], h["medicine"]
    return {"allergy": {"id": a["id"], "substance": a["substance"], "severity": a["severity"], "reaction": a.get("reaction")},
            "medicine": {"id": m["id"], "name": m["name"], "strength": m.get("strength")},
            "via": h["via"], "ingredients": h["ingredients"],
            "severity": "critical" if a["severity"] == "severe" else "high",
            "status": "needs_confirmation" if h["via"] == "name_text" else "potential_issue"}


def medication_rows(db, user_id: str, document_id: str | None = None) -> list[dict]:
    q = (db.table("medications")
         .select("id,document_id,name,strength,dosage,frequency,duration,authored_date,instructions,"
                 "documents(file_name,doc_type,source_clinician,source_facility,document_date)")
         .eq("user_id", user_id))
    if document_id:
        q = q.eq("document_id", document_id)
    return q.order("authored_date", desc=True).limit(500).execute().data


def medication_alerts(db, user_id: str, allergies: list[dict], today: date | None = None, document_id: str | None = None) -> dict:
    """Allergy alerts for medicines already prescribed (from confirmed documents), newest first, active courses first."""
    today = today or date.today()
    rows = medication_rows(db, user_id, document_id)
    items = {r["id"]: (r, _item(r)) for r in rows}
    out = screen_medicines([{"id": r["id"], "name": r["name"], "strength": r.get("strength")} for r in rows], allergies)
    enriched = []
    for a in out["alerts"]:
        r, it = items[a["medicine"]["id"]]
        end = it["_end"]
        active = (end is None and it["_start"] is not None and (today - it["_start"]).days <= 365) or (end is not None and end >= today)
        enriched.append({**a, "document_id": r["document_id"], "clinician": it["clinician"], "date": it["start"],
                         "file_name": it["file_name"], "active": active})
    enriched.sort(key=lambda a: a["date"] or "", reverse=True)  # newest first, then active and critical ones on top (stable)
    enriched.sort(key=lambda a: (not a["active"], a["severity"] != "critical"))
    return {**out, "alerts": enriched}


def engine_meds(items: list[dict]) -> list[dict]:
    """Active-medicine items (from kidney.active_medicines) in the shape the safety engine takes."""
    return [{"id": i["id"], "name": i["name"], "strength": i["strength"], "dosage": i["dosage"], "frequency": i["frequency"],
             "uncertain_fields": [], "catalogue_id": i["_catalogue_id"],
             "resolution_status": "resolved" if i["_catalogue_id"] else i["resolution"]} for i in items]
