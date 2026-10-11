"""Persisting confirmed extractions into FHIR-aligned record tables (idempotent)."""
from ..schemas.extraction import ExtractionData
from .clinical_rules import (interpret, normalize_test_name, normalize_unit, parse_iso_date, parse_range,
                             parse_value)

DOC_TYPE_LABEL = {
    "prescription": "Prescription", "lab_report": "Laboratory report", "diagnostic_report": "Diagnostic report",
    "discharge_summary": "Discharge summary", "other": "Medical document",
}


def _orig(ai_items: dict, item) -> dict | None:
    if item.user_corrected or item.origin == "user":
        return ai_items.get(item.key)
    return None


def replace_records(db, user_id: str, doc: dict, extraction_id: str, data: ExtractionData,
                    ai_output: ExtractionData) -> dict:
    """Delete then re-insert this document's records → confirming twice never duplicates."""
    doc_id = doc["id"]
    for t in ("observations", "medications", "conditions", "timeline_events"):
        db.table(t).delete().eq("document_id", doc_id).eq("user_id", user_id).execute()

    eff_date = data.document_date or doc["created_at"][:10]
    ai_by_key = {s: {i.key: i.model_dump() for i in getattr(ai_output, s)}
                 for s in ("lab_results", "medications", "conditions")}

    obs = []
    for it in data.lab_results:
        pv, rng = parse_value(it.value), parse_range(it.reference_range)
        obs.append({
            "user_id": user_id, "document_id": doc_id, "extraction_id": extraction_id, "item_key": it.key,
            "test_name": it.test_name, "normalized_name": normalize_test_name(it.test_name),
            "category": it.category, "value_text": it.value, "value_num": pv.number,
            "value_comparator": pv.comparator, "unit": it.unit, "unit_normalized": normalize_unit(it.unit),
            "reference_range_text": it.reference_range,
            "ref_low": rng.low if rng else None, "ref_high": rng.high if rng else None,
            "documented_flag": it.flag, "interpretation": interpret(pv, rng), "effective_date": eff_date,
            "source_text": it.source_text or None, "original": _orig(ai_by_key["lab_results"], it),
            "is_user_corrected": it.user_corrected or it.origin == "user",
        })
    meds = [{
        "user_id": user_id, "document_id": doc_id, "extraction_id": extraction_id, "item_key": it.key,
        "name": it.name, "strength": it.strength, "dosage": it.dosage, "frequency": it.frequency,
        "duration": it.duration, "route": it.route, "instructions": it.instructions, "authored_date": eff_date,
        "source_text": it.source_text or None, "original": _orig(ai_by_key["medications"], it),
        "is_user_corrected": it.user_corrected or it.origin == "user",
    } for it in data.medications]
    conds = [{
        "user_id": user_id, "document_id": doc_id, "extraction_id": extraction_id, "item_key": it.key,
        "description": it.description, "clinical_status": it.status, "recorded_date": eff_date,
        "source_text": it.source_text or None, "original": _orig(ai_by_key["conditions"], it),
        "is_user_corrected": it.user_corrected or it.origin == "user",
    } for it in data.conditions]

    out_of_range = sum(1 for o in obs if o["interpretation"] in ("above_range", "below_range"))
    events = [{
        "user_id": user_id, "document_id": doc_id, "event_date": eff_date, "event_type": "document",
        "category": data.document_type, "title": DOC_TYPE_LABEL[data.document_type]
        + (f" — {data.facility}" if data.facility else ""),
        "description": _doc_event_desc(len(obs), out_of_range, len(meds), len(conds)),
        "meta": {"kind": "document", "doc_type": data.document_type, "facility": data.facility,
                 "lab_results": len(obs), "out_of_range": out_of_range, "medications": len(meds),
                 "conditions": len(conds)},
    }]
    if obs:
        cats = sorted({o["category"] for o in obs if o["category"]})
        events.append({"user_id": user_id, "document_id": doc_id, "event_date": eff_date,
                       "event_type": "lab_result", "category": ", ".join(cats)[:200] or None,
                       "title": f"{len(obs)} lab result{'s' if len(obs) != 1 else ''} recorded",
                       "description": ", ".join(o["test_name"] for o in obs[:8]) + ("…" if len(obs) > 8 else ""),
                       "meta": {"kind": "lab_result", "count": len(obs)}})
    for m in meds:
        events.append({"user_id": user_id, "document_id": doc_id, "event_date": eff_date,
                       "event_type": "medication", "category": "medication", "title": f"Prescribed: {m['name']}",
                       "description": " · ".join(x for x in (m["strength"], m["dosage"], m["frequency"], m["duration"]) if x) or None,
                       "meta": {"kind": "medication", "name": m["name"]}})
    for c in conds:
        events.append({"user_id": user_id, "document_id": doc_id, "event_date": eff_date,
                       "event_type": "diagnosis", "category": "condition", "title": c["description"],
                       "description": "As documented in the source record", "meta": {"kind": "diagnosis"}})
    for p in data.procedures:
        d = parse_iso_date(p.date)
        events.append({"user_id": user_id, "document_id": doc_id, "event_date": (d.isoformat() if d else eff_date),
                       "event_type": "procedure", "category": "procedure", "title": p.name, "description": None})
    for f in data.follow_ups:
        d = parse_iso_date(f.date)
        events.append({"user_id": user_id, "document_id": doc_id, "event_date": (d.isoformat() if d else eff_date),
                       "event_type": "follow_up", "category": "follow_up", "title": "Follow-up",
                       "description": f.instruction, "meta": {"kind": "follow_up"}})

    if obs:
        db.table("observations").insert(obs).execute()
    if meds:
        db.table("medications").insert(meds).execute()
    if conds:
        db.table("conditions").insert(conds).execute()
    try:
        db.table("timeline_events").insert(events).execute()
    except Exception as e:  # noqa: BLE001 — database without migration 0002: store without meta
        if "meta" not in str(e):
            raise
        db.table("timeline_events").insert([{k: v for k, v in ev.items() if k != "meta"} for ev in events]).execute()
    return {"observations": len(obs), "medications": len(meds), "conditions": len(conds), "timeline_events": len(events)}


def _doc_event_desc(n_obs, n_oor, n_meds, n_conds) -> str | None:
    parts = []
    if n_obs:
        parts.append(f"{n_obs} lab result{'s' if n_obs != 1 else ''}"
                     + (f" ({n_oor} outside the printed reference range)" if n_oor else ""))
    if n_meds:
        parts.append(f"{n_meds} medication{'s' if n_meds != 1 else ''}")
    if n_conds:
        parts.append(f"{n_conds} documented diagnosis{'es' if n_conds != 1 else ''}")
    return ", ".join(parts) or None
