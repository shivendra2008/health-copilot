"""Severity ranking, brand verification, cross-prescription timeline and kidney re-checks (no network, fake database)."""
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.auth import CurrentUser, get_current_user
from app.main import app
from app.routers import documents as documents_router
from app.routers import medication_safety as ms
from app.schemas.extraction import ExtractionData, LabResultItem
from app.services.med_safety import catalogue as cat
from app.services.med_safety import kidney
from app.services.med_safety.analysis import analyze
from app.services.med_safety.engine import _finding, evidence_level, rank_findings, run_check
from app.services.med_safety.timeline import build_timeline, course_length

from .fakedb import FakeDB

ALICE, BOB = "aaaaaaaa-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-000000000002"


def M(i, name, cid=None, **k):
    return {"id": i, "name": name, "strength": None, "catalogue_id": cid, "resolution_status": "resolved" if cid else "unresolved",
            "dosage": None, "frequency": None, "uncertain_fields": [], **k}


# ============================================================================= 4. severity-ranked alerts
def _f(fid, severity, status="potential_issue", evidence=None, meds=1):
    return _finding(fid, "interaction", severity, status, [M(str(n), "x") for n in range(meds)], fid, "e", evidence)


RULE = {"rule_id": "R", "source": {"type": "t", "citation": "c"}, "review_status": "pending_pharmacist_review"}


def test_evidence_levels():
    assert evidence_level("potential_issue", None) == "none"
    assert evidence_level("potential_issue", RULE) == "rule_based"
    assert evidence_level("potential_issue", {**RULE, "review_status": "pharmacist_reviewed"}) == "reviewed"
    assert evidence_level("needs_confirmation", RULE) == "incomplete"
    assert evidence_level("potential_issue", {**RULE, "complete": False}) == "incomplete"


def test_severity_beats_everything_then_evidence_then_breadth():
    fs = [
        _f("low-rule", "low", evidence=RULE),
        _f("high-incomplete", "high", "needs_confirmation", RULE),
        _f("critical-incomplete", "critical", "needs_confirmation", RULE),
        _f("high-rule-2med", "high", evidence=RULE, meds=2),
        _f("high-rule-1med", "high", evidence=RULE, meds=1),
        _f("high-reviewed", "high", evidence={**RULE, "review_status": "pharmacist_reviewed"}),
        _f("info-none", "info", evidence=None),
    ]
    order = [f["id"] for f in rank_findings(fs)]
    assert order == ["critical-incomplete", "high-reviewed", "high-rule-2med", "high-rule-1med", "high-incomplete", "low-rule", "info-none"]
    assert [f["rank"] for f in fs] == list(range(1, 8))


def test_ranking_is_deterministic_and_present_in_engine_output():
    meds = [M("1", "Dolo 650", "br_dolo_650"), M("2", "Combiflam", "br_combiflam"), M("3", "Warfarin", "gen_warfarin"), M("4", "Voveran 50", "br_voveran_50")]
    a, b = run_check(meds), run_check(list(reversed(meds)))
    assert [f["id"] for f in a["findings"]] == [f["id"] for f in b["findings"]]
    assert [f["rank"] for f in a["findings"]] == list(range(1, len(a["findings"]) + 1))
    assert all(f["evidence_level"] in ("reviewed", "rule_based", "incomplete", "none") for f in a["findings"])
    sev = [f["severity"] for f in a["findings"]]
    order = ["critical", "high", "moderate", "low", "info"]
    assert sev == sorted(sev, key=order.index)


# ============================================================================= 3. brand verification
def test_catalogue_match_is_verified():
    v = analyze([{"key": "a", "name": "Dolo 650"}], None)["medicines"][0]["verification"]
    assert v["state"] == "verified" and v["basis"] == "catalogue_match" and v["composition"][0]["id"] == "paracetamol"


def test_unknown_brand_without_evidence_is_unverified():
    m = analyze([{"key": "a", "name": "Qwertyx", "raw": "Tab Qwertyx 1-0-1"}], None)["medicines"][0]
    assert m["verification"] == {"state": "unverified", "confidence": "none", "basis": "no_evidence", "composition": [], "suggestions": []}


def test_misspelling_suggests_with_confidence_but_is_never_applied():
    a = analyze([{"key": "a", "name": "Combifam"}], None)
    v = a["medicines"][0]["verification"]
    assert v["state"] == "suggested" and v["basis"] == "spelling_similarity" and v["confidence"] in ("medium", "low")
    assert v["suggestions"][0]["similarity"] >= 0.82
    # still unresolved for the safety engine: a suggestion is information, not a match
    assert a["medicines"][0]["resolution"]["status"] == "ambiguous" and a["summary"]["medicines_unresolved"] == 1


def test_composition_written_on_the_prescription_is_medium_with_strengths_low_without():
    full = analyze([{"key": "a", "name": "Zyxo", "raw": "Tab Zyxo (Pantoprazole 40 mg) OD"}], None)["medicines"][0]["verification"]
    assert full["state"] == "suggested" and full["basis"] == "written_in_prescription" and full["confidence"] == "medium"
    assert full["composition"] == [{"id": "pantoprazole", "name": "Pantoprazole", "strength": {"value": 40.0, "unit": "mg"}}]
    bare = analyze([{"key": "a", "name": "Zyxo", "raw": "Tab Zyxo pantoprazole OD"}], None)["medicines"][0]["verification"]
    assert bare["confidence"] == "low"


def test_brand_name_containing_an_ingredient_is_not_counted_as_written_composition():
    assert cat.composition_in_text("Tab Paracetamolx 1-0-1", "Paracetamolx") == []


def test_curated_dataset_is_strongest_evidence_and_needs_a_source(monkeypatch):
    brand = {"aliases": ["Zyxotab"], "ingredients": [{"id": "pantoprazole", "strength": {"value": 40, "unit": "mg"}}],
             "source": {"type": "dataset", "citation": "Example curated list"}, "confidence": "high"}
    nosrc = {"aliases": ["Nosrc"], "ingredients": [{"id": "paracetamol", "strength": None}]}
    index = {cat.normalize_name(a): b for b in (brand,) for a in b["aliases"]}
    monkeypatch.setattr(cat, "brand_dataset", lambda: {"label": "Example", "index": index})
    v = analyze([{"key": "a", "name": "Zyxotab", "raw": "Tab Zyxotab (Pantoprazole 20 mg)"}], None)["medicines"][0]["verification"]
    assert v["basis"] == "local_dataset" and v["confidence"] == "high" and v["suggestions"][0]["source"]["citation"] == "Example curated list"
    assert [s["basis"] for s in v["suggestions"]] == ["local_dataset", "written_in_prescription"]
    assert nosrc["aliases"][0] not in index


def test_user_skipped_medicine_is_unverified():
    v = analyze([{"key": "a", "name": "Combifam", "resolution_choice": "unresolved"}], None)["medicines"][0]["verification"]
    assert v["state"] == "unverified" and v["basis"] == "skipped_by_user"


# ============================================================================= 1. cross-doctor timeline
def D(doc, clinician, day):
    return {"file_name": f"{doc}.pdf", "doc_type": "prescription", "source_clinician": clinician, "source_facility": None, "document_date": day}


def R(i, doc, name, day, duration=None, clinician="Dr A", strength=None, freq="BD"):
    return {"id": str(i), "document_id": doc, "name": name, "strength": strength, "dosage": "1 tab", "frequency": freq,
            "duration": duration, "authored_date": day, "documents": D(doc, clinician, day)}


@pytest.mark.parametrize("text,expected", [
    ("5 days", (5, False)), ("x 2 weeks", (14, False)), ("for 1 month", (30, False)), ("10 d", (10, False)),
    ("ongoing", (None, True)), ("continue", (None, True)), ("as advised", (None, False)), (None, (None, False)), ("0 days", (None, False)),
])
def test_course_length(text, expected):
    assert course_length(text) == expected


def test_same_ingredient_from_two_doctors_overlapping_is_flagged_high():
    t = build_timeline([R(1, "d1", "Dolo 650", "2026-09-01", "5 days", "Dr A"), R(2, "d2", "Combiflam", "2026-09-03", "3 days", "Dr B")])
    [flag] = t["flags"]
    assert (flag["type"], flag["status"], flag["severity"], flag["subject"]) == ("duplicate_ingredient", "overlapping", "high", "Paracetamol")
    assert flag["different_prescribers"] is True and flag["document_ids"] == ["d1", "d2"]
    assert [i["end"] for i in t["items"]] == ["2026-09-05", "2026-09-05"] and all(i["concurrent"] for i in t["items"])
    assert {p["clinician"] for p in t["prescribers"]} == {"Dr A", "Dr B"}


def test_back_to_back_courses_are_sequential_info_not_an_overlap():
    t = build_timeline([R(1, "d1", "Dolo 650", "2026-09-01", "3 days"), R(2, "d2", "Dolo 650", "2026-09-04", "3 days", "Dr B")])
    [flag] = t["flags"]
    assert flag["status"] == "sequential" and flag["severity"] == "info"
    assert not any(i["concurrent"] for i in t["items"])


def test_missing_end_date_is_only_a_possible_overlap():
    t = build_timeline([R(1, "d1", "Dolo 650", "2026-09-01", None), R(2, "d2", "Combiflam", "2026-09-10", "3 days", "Dr B")])
    assert t["flags"][0]["status"] == "possibly_overlapping" and t["flags"][0]["severity"] == "moderate"
    assert t["items"][0]["end"] is None and t["items"][0]["end_known"] is False


def test_same_prescription_is_not_a_cross_prescription_flag():
    assert build_timeline([R(1, "d1", "Dolo 650", "2026-09-01", "5 days"), R(2, "d1", "Combiflam", "2026-09-01", "5 days")])["flags"] == []


def test_unknown_brand_repeated_across_doctors_is_flagged_by_name():
    t = build_timeline([R(1, "d1", "Qwertyx", "2026-09-01", "5 days"), R(2, "d2", "qwertyx", "2026-09-02", "5 days", "Dr B")])
    assert t["flags"][0]["type"] == "same_medicine" and t["flags"][0]["status"] == "overlapping"


def test_unknown_prescriber_stays_unknown():
    rows = [R(1, "d1", "Dolo 650", "2026-09-01", "5 days", None), R(2, "d2", "Combiflam", "2026-09-02", "5 days", "Dr B")]
    assert build_timeline(rows)["flags"][0]["different_prescribers"] is None


def test_interactions_are_checked_per_overlapping_pair_never_with_a_finished_course():
    rows = [
        R(1, "d1", "Combiflam", "2026-09-01", "3 days", "Dr A"),            # ends 3 Sep
        R(2, "d2", "Warfarin", "2026-09-20", "ongoing", "Dr B", "5 mg", "OD"),
        R(3, "d3", "Brufen 400", "2026-09-21", "5 days", "Dr C"),
    ]
    t = build_timeline(rows)
    titles = [(f["title"], sorted(m["label"] for m in f["medicines"]), f["overlap"]) for f in t["findings"]]
    assert titles == [("Warfarin with an NSAID", ["Brufen 400", "Warfarin 5 mg"], "possibly_overlapping")]
    assert t["findings"][0]["document_ids"] == ["d2", "d3"] and t["findings"][0]["rank"] == 1


def test_items_without_a_date_are_listed_last_and_overlap_is_only_possible():
    rows = [R(1, "d1", "Dolo 650", None, "5 days"), R(2, "d2", "Combiflam", "2026-09-03", "3 days", "Dr B")]
    rows[0]["documents"]["document_date"] = None
    t = build_timeline(rows)
    assert [i["start"] for i in t["items"]] == ["2026-09-03", None]
    assert t["flags"][0]["status"] == "possibly_overlapping"


# ----------------------------------------------------------------------------- timeline API
@pytest.fixture
def client(monkeypatch):
    db = FakeDB(medications=[{**R(1, "d1", "Dolo 650", "2026-09-01", "5 days"), "user_id": ALICE},
                             {**R(2, "d2", "Combiflam", "2026-09-02", "5 days", "Dr B"), "user_id": ALICE},
                             {**R(3, "d9", "Warfarin", "2026-09-02", "5 days"), "user_id": BOB}],
                observations=[], profiles=[{"id": ALICE, "age_years": 50, "sex": "male"}], audit_logs=[], kidney_rechecks=[])
    monkeypatch.setattr(ms, "get_db", lambda: db)
    monkeypatch.setattr("app.audit.log.warning", lambda *a, **k: None)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=ALICE, email=None)
    yield TestClient(app), db
    app.dependency_overrides.clear()


def test_timeline_endpoint_returns_only_my_medicines(client):
    c, _ = client
    body = c.get("/api/v1/medication-safety/timeline").json()
    assert sorted(i["name"] for i in body["items"]) == ["Combiflam", "Dolo 650"] and len(body["flags"]) == 1


# ============================================================================= 2. kidney-function rechecks
def obs(i, name, value, unit, day, norm=None, comparator=None, doc="lab1"):
    return {"id": f"o{i}", "document_id": doc, "test_name": name, "normalized_name": norm or name.lower(), "value_num": value,
            "value_comparator": comparator, "unit": unit, "effective_date": day}


def test_ckd_epi_2021_known_values():
    assert kidney.egfr_ckd_epi_2021(1.0, 50, "male") == pytest.approx(91.7, abs=0.5)
    assert kidney.egfr_ckd_epi_2021(1.0, 50, "female") == pytest.approx(68.6, abs=0.5)
    assert kidney.egfr_ckd_epi_2021(1.0, 50, "other") is None and kidney.egfr_ckd_epi_2021(1.0, 10, "male") is None


TODAY = date(2026, 10, 24)
MALE50 = {"age_years": 50, "sex": "male"}


def test_reported_egfr_is_used_as_written():
    k = kidney.kidney_status([obs(1, "eGFR", 45, "mL/min/1.73m2", "2026-10-01")], None, TODAY)
    assert (k["status"], k["egfr"], k["method"], k["threshold"]) == ("reduced", 45.0, "reported_egfr", 60)
    assert kidney.kidney_status([obs(1, "eGFR", 72, None, "2026-10-01")], None, TODAY)["status"] == "normal"


def test_creatinine_is_converted_only_with_age_and_sex_and_mg_dl():
    c = [obs(1, "Serum Creatinine", 2.4, "mg/dL", "2026-10-01", norm="creatinine")]
    k = kidney.kidney_status(c, MALE50, TODAY)
    assert k["status"] == "reduced" and k["method"] == "calculated_ckd_epi_2021" and 25 < k["egfr"] < 40
    assert kidney.kidney_status(c, {"age_years": 50}, TODAY)["reason"] == "needs_age_and_sex"
    assert kidney.kidney_status(c, {"age_years": 50, "sex": "other"}, TODAY)["status"] == "unknown"
    um = [obs(1, "Serum Creatinine", 180, "umol/L", "2026-10-01", norm="creatinine")]
    assert kidney.kidney_status(um, MALE50, TODAY)["reason"] == "creatinine_unit_unsupported"


def test_unusable_values_are_ignored_not_guessed():
    for o in (obs(1, "eGFR", 45, "mL/min", "2026-10-01", comparator=">"), obs(2, "Urine Creatinine", 1.0, "mg/dL", "2026-10-01", norm="urine creatinine"),
              obs(3, "Creatinine Clearance", 1.0, "mg/dL", "2026-10-01", norm="creatinine")):
        assert kidney.kidney_status([o], MALE50, TODAY)["status"] == "unknown"
    assert kidney.kidney_status([], MALE50, TODAY)["reason"] == "no_kidney_result"


def test_newest_result_wins_and_reported_beats_calculated_on_the_same_day():
    older = obs(1, "eGFR", 30, "mL/min", "2026-01-01")
    newer = obs(2, "eGFR", 80, "mL/min", "2026-10-01")
    assert kidney.kidney_status([older, newer], None, TODAY)["status"] == "normal"
    same = [obs(3, "Creatinine", 3.0, "mg/dL", "2026-10-01", norm="creatinine"), obs(4, "eGFR", 80, "mL/min", "2026-10-01")]
    assert kidney.kidney_status(same, MALE50, TODAY)["method"] == "reported_egfr"


def test_old_results_are_marked_stale():
    assert kidney.kidney_status([obs(1, "eGFR", 45, "mL/min", "2025-01-01")], None, TODAY)["stale"] is True


def db_with(meds, observations, profile=None):
    return FakeDB(medications=meds, observations=observations, profiles=[{"id": ALICE, **(profile or MALE50)}], kidney_rechecks=[])


def metformin(i="m1", day="2026-10-01", duration="ongoing"):
    return {**R(1, "rx1", "Metformin", day, duration, strength="500 mg", freq="BD"), "id": i, "user_id": ALICE}


def test_recheck_flags_kidney_rules_for_active_medicines_and_records_it():
    db = db_with([metformin(), {**R(2, "rx2", "Dolo 650", "2026-01-01", "5 days"), "user_id": ALICE}],
                 [{**obs(1, "eGFR", 40, "mL/min", "2026-10-20"), "user_id": ALICE}])
    r = kidney.recheck(db, ALICE, trigger_document_id="lab1", today=TODAY)
    assert r["kidney"]["status"] == "reduced" and r["medicines_checked"] == 1  # the finished Dolo course is not re-checked
    assert [f["evidence"]["rule_id"] for f in r["findings"]] == ["R-PAT-001"]
    assert r["findings"][0]["evidence"]["kidney"]["egfr"] == 40.0
    [row] = db.tables["kidney_rechecks"]
    assert row["trigger_document_id"] == "lab1" and row["kidney_status"] == "reduced" and row["previous_status"] is None


def test_a_new_better_result_clears_the_finding_and_reports_the_change():
    db = db_with([metformin()], [{**obs(1, "eGFR", 40, "mL/min", "2026-10-20"), "user_id": ALICE}])
    kidney.recheck(db, ALICE, today=TODAY)
    db.tables["observations"].append({**obs(2, "eGFR", 85, "mL/min", "2026-10-23", doc="lab2"), "user_id": ALICE})
    r = kidney.recheck(db, ALICE, trigger_document_id="lab2", today=TODAY)
    assert r["findings"] == [] and r["changed"] is True and r["previous_status"] == "reduced"


def test_unknown_kidney_function_raises_no_kidney_findings():
    r = kidney.recheck(db_with([metformin()], []), ALICE, today=TODAY, persist=False)
    assert r["kidney"]["status"] == "unknown" and r["findings"] == []


def test_courses_without_a_start_date_are_skipped_and_counted():
    undated = {**metformin(), "authored_date": None}
    undated["documents"] = {**undated["documents"], "document_date": None}
    r = kidney.recheck(db_with([undated], []), ALICE, today=TODAY, persist=False)
    assert r["medicines_checked"] == 0 and r["medicines_skipped_no_date"] == 1


def test_has_kidney_result_only_for_serum_kidney_tests():
    def labs(*names):
        return [LabResultItem(test_name=n, value="1", key=str(i)) for i, n in enumerate(names)]
    assert kidney.has_kidney_result(labs("Hemoglobin", "Serum Creatinine"))
    assert kidney.has_kidney_result(labs("eGFR"))
    assert not kidney.has_kidney_result(labs("Hemoglobin", "Urine Creatinine", "HbA1c"))


# ----------------------------------------------------------------------------- hooks and API
def test_confirm_hook_summarises_and_never_raises(monkeypatch):
    db = db_with([metformin()], [{**obs(1, "eGFR", 40, "mL/min", "2026-10-20"), "user_id": ALICE}])
    data = ExtractionData(lab_results=[LabResultItem(test_name="eGFR", value="40", key="k1")])
    out = documents_router._kidney_recheck(db, ALICE, "lab1", data)
    assert out["status"] == "reduced" and out["findings"] == 1 and out["medicines_checked"] == 1
    assert documents_router._kidney_recheck(db, ALICE, "lab1", ExtractionData()) is None  # no kidney test → nothing to do
    monkeypatch.setattr(kidney, "recheck", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("table missing")))
    assert documents_router._kidney_recheck(db, ALICE, "lab1", data) is None  # a failure never blocks confirming


def test_analyze_uses_lab_kidney_function_when_unknown_but_never_overrides_the_user(client):
    c, db = client
    db.tables["observations"].append({**obs(1, "eGFR", 35, "mL/min", "2026-10-20"), "user_id": ALICE})
    body = {"medicines": [{"key": "a", "name": "Metformin", "strength": "500 mg"}], "patient": {"kidney": "unknown"}}
    a = c.post("/api/v1/medication-safety/analyze", json=body).json()
    assert a["patient"]["kidney"] == "reduced" and a["patient"]["kidney_source"]["egfr"] == 35.0
    assert any(f["evidence"]["rule_id"] == "R-PAT-001" for f in a["findings"])
    typed = c.post("/api/v1/medication-safety/analyze", json={**body, "patient": {"kidney": "normal"}}).json()
    assert typed["patient"]["kidney"] == "normal" and "kidney_source" not in typed["patient"]
    assert not any(f["type"] == "patient_specific" for f in typed["findings"])


def test_kidney_endpoints(client):
    c, db = client
    db.tables["observations"].append({**obs(1, "eGFR", 35, "mL/min", "2026-10-20"), "user_id": ALICE})
    db.tables["medications"].append(metformin("m9", date.today().isoformat()))
    assert c.get("/api/v1/medication-safety/kidney").json()["kidney"]["status"] == "reduced"
    r = c.post("/api/v1/medication-safety/kidney/recheck").json()
    assert r["medicines_checked"] == 1 and r["findings"][0]["evidence"]["rule_id"] == "R-PAT-001"
    h = c.get("/api/v1/medication-safety/kidney/rechecks").json()
    assert h["total"] == 1 and h["items"][0]["kidney_status"] == "reduced"


def test_kidney_data_is_private(client):
    c, db = client
    db.tables["observations"].append({**obs(1, "eGFR", 35, "mL/min", "2026-10-20"), "user_id": BOB})
    assert c.get("/api/v1/medication-safety/kidney").json()["kidney"]["status"] == "unknown"


def test_ruleset_kidney_config_has_source_and_review_status():
    cfg = kidney.ruleset()["kidney_function"]
    assert cfg["source"]["citation"] and cfg["review_status"] == "pending_pharmacist_review" and cfg["reduced_below_egfr"] == 60
