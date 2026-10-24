"""Typed-prescription analysis: resolve each medicine, run the deterministic engine, and return everything the
UI needs to explain the result in plain language. Stateless: nothing is stored here."""
from .catalogue import entry_brief, resolve, verify
from .dose import doses_per_day, units_per_dose
from .engine import run_check
from .parser import decode_frequency, decode_timing


def _resolution(m: dict) -> dict:
    cid, choice = m.get("catalogue_id"), m.get("resolution_choice")
    if choice == "select" and cid and entry_brief(cid):
        return {"status": "user_selected", "catalogue_id": cid, "confidence": "user_confirmed", "reason": "user_selected", "candidates": []}
    if choice == "unresolved":
        return {"status": "user_unresolved", "catalogue_id": None, "confidence": "none", "reason": "user_unresolved", "candidates": []}
    return resolve(m["name"], m.get("strength")).as_dict()


def analyze(medicines: list[dict], patient: dict | None) -> dict:
    engine_meds, views = [], []
    for m in medicines:
        res = _resolution(m)
        engine_meds.append({
            "id": m["key"], "name": m["name"], "strength": m.get("strength"), "dosage": m.get("dosage"),
            "frequency": m.get("frequency"), "uncertain_fields": [], "catalogue_id": res["catalogue_id"],
            "resolution_status": res["status"], "resolution_confidence": res["confidence"],
        })
        entry = entry_brief(res["catalogue_id"]) if res["catalogue_id"] else None
        views.append({
            "key": m["key"], "name": m["name"], "strength": m.get("strength"), "dosage": m.get("dosage"),
            "frequency": m.get("frequency"), "timing": m.get("timing"), "duration": m.get("duration"),
            "frequency_info": decode_frequency(m.get("frequency")), "timing_info": decode_timing(m.get("timing")),
            "units_per_dose": units_per_dose(m.get("dosage")), "doses_per_day": doses_per_day(m.get("frequency")),
            "resolution": res, "catalogue_entry": entry,
            "verification": verify(m["name"], m.get("strength"), m.get("raw"), res),
        })
    result = run_check(engine_meds, patient)
    return {**result, "medicines": views}
