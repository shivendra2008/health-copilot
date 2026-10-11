import secrets

from fastapi import APIRouter, Depends

from ..audit import audit
from ..auth import CurrentUser, get_current_user
from ..deps import get_db
from ..schemas.api import ProfileOut, ProfilePatch

router = APIRouter(prefix="/api/v1", tags=["profile"])


def _get_or_create(db, user: CurrentUser) -> dict:
    res = db.table("profiles").select("*").eq("id", user.id).limit(1).execute().data
    if res:
        return res[0]
    return db.table("profiles").insert({"id": user.id}).execute().data[0]


@router.get("/profile", response_model=ProfileOut)
def get_profile(user: CurrentUser = Depends(get_current_user)):
    return ProfileOut(**_get_or_create(get_db(), user), email=user.email)


@router.patch("/profile", response_model=ProfileOut)
def update_profile(body: ProfilePatch, user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    _get_or_create(db, user)
    changes = body.model_dump(exclude_unset=True, mode="json")
    if changes:
        db.table("profiles").update(changes).eq("id", user.id).execute()
        audit(db, user.id, "profile.updated", "profile", user.id, {"fields": sorted(changes)})
    return ProfileOut(**_get_or_create(db, user), email=user.email)


@router.post("/profile/mock-abha", response_model=ProfileOut)
def generate_mock_abha(user: CurrentUser = Depends(get_current_user)):
    """DEMO ONLY. Generates a clearly fake ABHA-format identifier. No ABDM integration."""
    db = get_db()
    _get_or_create(db, user)
    digits = "".join(str(secrets.randbelow(10)) for _ in range(12))
    mock = f"DEMO-91-{digits[:4]}-{digits[4:8]}-{digits[8:]}"
    db.table("profiles").update({"mock_abha_id": mock}).eq("id", user.id).execute()
    audit(db, user.id, "profile.mock_abha_generated", "profile", user.id)
    return ProfileOut(**_get_or_create(db, user), email=user.email)


@router.get("/fhir/bundle")
def fhir_bundle(user: CurrentUser = Depends(get_current_user)):
    """FHIR R4-*shaped* export of confirmed records (illustrative; not a certified implementation)."""
    db = get_db()
    prof = _get_or_create(db, user)
    docs = db.table("documents").select("id,file_name,mime_type,doc_type,document_date,created_at") \
        .eq("user_id", user.id).eq("status", "confirmed").execute().data
    obs = db.table("observations").select("*").eq("user_id", user.id).execute().data
    meds = db.table("medications").select("*").eq("user_id", user.id).execute().data
    conds = db.table("conditions").select("*").eq("user_id", user.id).execute().data

    pid = f"Patient/{user.id}"
    patient = {"resourceType": "Patient", "id": user.id,
               "name": [{"text": prof.get("full_name")}] if prof.get("full_name") else [],
               "gender": prof.get("sex"), "birthDate": prof.get("date_of_birth")}
    if prof.get("mock_abha_id"):
        patient["identifier"] = [{"system": "urn:demo:mock-abha (NOT A REAL ABHA NUMBER)", "value": prof["mock_abha_id"]}]
    entries = [patient]
    entries += [{"resourceType": "DocumentReference", "id": d["id"], "status": "current", "subject": {"reference": pid},
                 "type": {"text": d["doc_type"]}, "date": d["document_date"] or d["created_at"],
                 "content": [{"attachment": {"contentType": d["mime_type"], "title": d["file_name"]}}]} for d in docs]
    interp = {"above_range": "H", "below_range": "L", "within_range": "N"}
    for o in obs:
        r = {"resourceType": "Observation", "id": o["id"], "status": "final",
             "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory"}]}],
             "code": {"text": o["test_name"]}, "subject": {"reference": pid}, "effectiveDateTime": o["effective_date"],
             "derivedFrom": [{"reference": f"DocumentReference/{o['document_id']}"}]}
        if o["value_num"] is not None and not o["value_comparator"]:
            r["valueQuantity"] = {"value": float(o["value_num"]), "unit": o["unit"]}
        else:
            r["valueString"] = o["value_text"]
        if o["ref_low"] is not None or o["ref_high"] is not None or o["reference_range_text"]:
            rr = {"text": o["reference_range_text"]}
            if o["ref_low"] is not None:
                rr["low"] = {"value": float(o["ref_low"]), "unit": o["unit"]}
            if o["ref_high"] is not None:
                rr["high"] = {"value": float(o["ref_high"]), "unit": o["unit"]}
            r["referenceRange"] = [rr]
        if o["interpretation"] in interp:
            r["interpretation"] = [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                                                "code": interp[o["interpretation"]]}]}]
        entries.append(r)
    for m in meds:
        entries.append({"resourceType": "MedicationRequest", "id": m["id"], "status": "unknown", "intent": "order",
                        "medicationCodeableConcept": {"text": " ".join(x for x in (m["name"], m["strength"]) if x)},
                        "subject": {"reference": pid}, "authoredOn": m["authored_date"],
                        "dosageInstruction": [{"text": " · ".join(x for x in (m["dosage"], m["frequency"], m["duration"], m["instructions"]) if x)}]})
    for c in conds:
        entries.append({"resourceType": "Condition", "id": c["id"], "code": {"text": c["description"]},
                        "subject": {"reference": pid}, "recordedDate": c["recorded_date"]})
    audit(db, user.id, "fhir.exported", None, None, {"resources": len(entries)})
    return {"resourceType": "Bundle", "type": "collection",
            "meta": {"tag": [{"display": "Illustrative FHIR-aligned export — not ABDM certified"}]},
            "entry": [{"resource": e} for e in entries]}
