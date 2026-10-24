"""Deterministic rules, ambiguity and uncertainty handling (no network, no database)."""
from app.services.med_safety.catalogue import catalogue, resolve, search
from app.services.med_safety.dose import doses_per_day, units_per_dose
from app.services.med_safety.engine import RESOLVED_STATUSES, run_check, ruleset


def M(i, name, cid=None, strength=None, status="resolved", **k):
    return {"id": i, "name": name, "strength": strength, "catalogue_id": cid, "resolution_status": status,
            "dosage": None, "frequency": None, "uncertain_fields": [], **k}


def types(r):
    return [(f["type"], f["severity"]) for f in r["findings"]]


# ----------------------------------------------------------------------------- rule data integrity
def test_every_rule_has_source_review_status_and_date():
    rs = ruleset()
    rules = rs["class_duplicates"] + rs["interactions"] + rs["dose_rules"] + [rs["duplicate_ingredient"]]
    for r in rules:
        assert r["id"] and r["source"]["citation"] and r["review_status"], r["id"]
    for r in rs["class_duplicates"] + rs["interactions"] + rs["dose_rules"]:
        assert r["curated_on"], r["id"]


def test_rules_only_reference_known_ingredients_and_classes():
    cat = catalogue()["ingredients"]
    classes = {c for i in cat.values() for c in i["classes"]}
    for r in ruleset()["interactions"]:
        for side in (r["a"], r["b"]):
            assert set(side.get("ingredients", [])) <= set(cat), r["id"]
            assert set(side.get("classes", [])) <= classes, r["id"]


def test_catalogue_entries_use_known_ingredients():
    cat = catalogue()
    for e in cat["entries"]:
        assert {i["id"] for i in e["ingredients"]} <= set(cat["ingredients"]), e["id"]


# ----------------------------------------------------------------------------- duplicates
def test_duplicate_ingredient_across_brand_and_combination():
    r = run_check([M("1", "Dolo 650", "br_dolo_650"), M("2", "Combiflam", "br_combiflam")])
    dup = [f for f in r["findings"] if f["type"] == "duplicate_ingredient"]
    assert len(dup) == 1 and dup[0]["severity"] == "high"
    assert {m["id"] for m in dup[0]["medicines"]} == {"1", "2"}
    assert dup[0]["evidence"]["rule_id"] == "R-DUP-ING" and dup[0]["evidence"]["ruleset_version"]


def test_no_duplicate_when_ingredients_differ():
    r = run_check([M("1", "Telma 40", "br_telma_40"), M("2", "Pantocid 40", "br_pantocid_40")])
    assert r["findings"] == []


def test_two_different_nsaids_are_a_class_duplicate():
    r = run_check([M("1", "Brufen 400", "br_brufen_400"), M("2", "Voveran 50", "br_voveran_50")])
    assert ("therapeutic_duplicate", "high") in types(r)


# ----------------------------------------------------------------------------- interactions
def test_warfarin_nsaid_interaction():
    r = run_check([M("1", "Warfarin", "gen_warfarin"), M("2", "Voveran 50", "br_voveran_50")])
    f = [x for x in r["findings"] if x["type"] == "interaction"][0]
    assert f["severity"] == "high" and f["evidence"]["rule_id"] == "R-INT-001"
    assert f["evidence"]["source"]["citation"] and f["next_step"] == "consult_clinician"


def test_interaction_is_order_independent():
    a = run_check([M("1", "Warfarin", "gen_warfarin"), M("2", "Voveran 50", "br_voveran_50")])
    b = run_check([M("2", "Voveran 50", "br_voveran_50"), M("1", "Warfarin", "gen_warfarin")])
    assert [(f["type"], f["evidence"]["rule_id"]) for f in a["findings"]] == [(f["type"], f["evidence"]["rule_id"]) for f in b["findings"]]


def test_sildenafil_nitrate_is_critical_and_sorted_first():
    r = run_check([M("1", "Dolo 650", "br_dolo_650"), M("2", "Viagra 50", "br_viagra_50"), M("3", "ISMN", "gen_ismn"),
                   M("4", "Dolo 500", "br_dolo_500")])
    assert r["findings"][0]["severity"] == "critical"


def test_combination_product_triggers_interaction_via_each_ingredient():
    # Combiflam contains ibuprofen; aspirin + ibuprofen rule must fire
    r = run_check([M("1", "Ecosprin 75", "br_ecosprin_75"), M("2", "Combiflam", "br_combiflam")])
    assert any(f.get("evidence", {}) and f["evidence"]["rule_id"] == "R-INT-008" for f in r["findings"])


def test_medicine_does_not_interact_with_itself():
    r = run_check([M("1", "Augmentin 625", "br_augmentin_625")])
    assert r["findings"] == []


# ----------------------------------------------------------------------------- uncertainty (never guess, never "safe")
def test_unresolved_medicine_is_reported_not_guessed():
    r = run_check([M("1", "Warfarin", "gen_warfarin"), M("2", "Zyxotab", None, status="unresolved")])
    assert r["unresolved"][0]["reason"] == "not_in_catalogue"
    f = [x for x in r["findings"] if x["type"] == "unresolved_medicine"][0]
    assert f["status"] == "needs_confirmation" and f["evidence"] is None
    assert not [x for x in r["findings"] if x["type"] == "interaction"]


def test_ambiguous_and_user_unresolved_are_excluded_from_checks():
    r = run_check([M("1", "Dolo", None, status="ambiguous"), M("2", "Combiflam", "br_combiflam"),
                   M("3", "Crocin", "br_crocin_500", status="user_unresolved")])
    assert {u["reason"] for u in r["unresolved"]} == {"ambiguous", "marked_unresolved"}
    assert not [f for f in r["findings"] if f["type"] == "duplicate_ingredient"]


def test_name_marked_uncertain_is_excluded_even_if_matched():
    r = run_check([M("1", "Dolo 650", "br_dolo_650", uncertain_fields=["name"]), M("2", "Combiflam", "br_combiflam")])
    assert r["unresolved"][0]["reason"] == "marked_uncertain"
    assert not [f for f in r["findings"] if f["type"] == "duplicate_ingredient"]


def test_stale_catalogue_id_is_unresolved():
    r = run_check([M("1", "Old", "removed_entry")])
    assert r["unresolved"][0]["reason"] == "catalogue_changed"


def test_clean_list_returns_no_findings_but_carries_limitations():
    r = run_check([M("1", "Telma 40", "br_telma_40", dosage="1", frequency="OD", strength="40 mg")])
    assert r["findings"] == [] and "limited_ruleset" in r["limitations"] and "not_medical_advice" in r["limitations"]


def test_missing_details_are_listed():
    r = run_check([M("1", "Telma 40", "br_telma_40")])
    assert r["missing_information"][0]["missing"] == ["dosage", "frequency"]  # "Telma 40" already defines the strength
    g = run_check([M("1", "Telmisartan", "gen_telmisartan")])
    assert g["missing_information"][0]["missing"] == ["strength", "dosage", "frequency"]  # a generic name does not


# ----------------------------------------------------------------------------- dose check
def P(i, name, cid, dosage, freq, strength=None, **k):
    return M(i, name, cid, strength, dosage=dosage, frequency=freq, **k)


def test_paracetamol_daily_total_over_limit_flagged_with_numbers():
    # Dolo 650 x 4/day = 2600 ; Combiflam (325 mg) x 3/day = 975 ; Zerodol-P (325) x 3/day = 975 -> 4550
    r = run_check([P("1", "Dolo 650", "br_dolo_650", "1 tablet", "QID"), P("2", "Combiflam", "br_combiflam", "1", "TDS"),
                   P("3", "Zerodol-P", "br_zerodol_p", "1", "TDS")], {"adult": True})
    f = [x for x in r["findings"] if x["type"] == "dose_concern"][0]
    assert f["status"] == "potential_issue" and f["evidence"]["computed_daily_mg"] == 4550 and f["evidence"]["limit_mg"] == 4000


def test_dose_total_under_limit_is_not_flagged():
    r = run_check([P("1", "Dolo 650", "br_dolo_650", "1", "TDS")], {"adult": True})
    assert not [x for x in r["findings"] if x["type"] == "dose_concern"]


def test_dose_check_needs_known_adult_or_child_weight():
    for patient in ({"adult": None}, {}):
        r = run_check([P("1", "Dolo 650", "br_dolo_650", "6", "QID")], patient)
        assert not [x for x in r["findings"] if x["type"] == "dose_concern"]
        assert any("patient_age" in x["missing"] for x in r["missing_information"])
    child = run_check([P("1", "Dolo 650", "br_dolo_650", "6", "QID")], {"adult": False})  # age known, weight not
    assert not [x for x in child["findings"] if x["type"] == "dose_concern"]
    assert any("patient_weight" in x["missing"] for x in child["missing_information"])


def test_dose_check_with_missing_frequency_never_guesses():
    r = run_check([P("1", "Dolo 650", "br_dolo_650", "1", None)], {"adult": True})
    assert not [x for x in r["findings"] if x["type"] == "dose_concern" and x["severity"] != "info"]
    assert any(x["missing"] == ["frequency"] for x in r["missing_information"] if x["medicine"])


def test_dose_check_uncertain_field_blocks_calculation():
    r = run_check([P("1", "Dolo 650", "br_dolo_650", "9", "QID", uncertain_fields=["dosage"])], {"adult": True})
    assert not [x for x in r["findings"] if x["severity"] == "high" and x["type"] == "dose_concern"]


def test_partial_total_already_over_limit_is_flagged_as_incomplete():
    r = run_check([P("1", "Dolo 650", "br_dolo_650", "2", "QID"), P("2", "Combiflam", "br_combiflam", None, None)], {"adult": True})
    f = [x for x in r["findings"] if x["type"] == "dose_concern"][0]
    assert f["status"] == "needs_confirmation" and f["evidence"]["complete"] is False


def test_generic_paracetamol_uses_confirmed_mg_strength_only():
    ok = run_check([P("1", "Paracetamol", "gen_paracetamol", "1", "QID", "500 mg")], {"adult": True})
    assert not [x for x in ok["findings"] if x["type"] == "dose_concern"]
    grams = run_check([P("1", "Paracetamol", "gen_paracetamol", "1", "QID", "1 g")], {"adult": True})
    assert any(x["missing"] == ["strength"] for x in grams["missing_information"] if x["medicine"])  # g is never converted


def test_dose_parsers_are_conservative():
    assert units_per_dose("1 tablet") == 1 and units_per_dose("2") == 2
    assert units_per_dose("1/2 tablet") is None and units_per_dose("5 ml") is None and units_per_dose("as directed") is None
    assert doses_per_day("BD") == 2 and doses_per_day("1-0-1") == 2 and doses_per_day("every 6 hours") == 4
    assert doses_per_day("SOS") is None and doses_per_day("every 5 hours") is None and doses_per_day("weekly") is None


# ----------------------------------------------------------------------------- brand resolution
def test_brand_with_multiple_variants_is_ambiguous_until_strength_given():
    r = resolve("Dolo")
    assert r.status == "ambiguous" and {c["id"] for c in r.candidates} == {"br_dolo_650", "br_dolo_500"} and r.catalogue_id is None
    assert resolve("Dolo", "650 mg").catalogue_id == "br_dolo_650"
    assert resolve("Tab Dolo 500mg").catalogue_id == "br_dolo_500"


def test_unknown_strength_for_brand_is_ambiguous_not_guessed():
    r = resolve("Dolo", "1 g")
    assert r.status == "ambiguous" and r.reason == "strength_not_in_catalogue" and r.catalogue_id is None


def test_unknown_brand_is_unresolved_and_typo_only_suggests():
    assert resolve("Zyxotab").status == "unresolved"
    t = resolve("Parcetamol")
    assert t.status == "ambiguous" and t.catalogue_id is None and t.candidates[0]["id"] == "gen_paracetamol"


def test_generic_name_resolves_with_high_confidence():
    r = resolve("Paracetamol", "500 mg")
    assert r.status == "resolved" and r.confidence == "high"


def test_search_is_prefix_first_and_bounded():
    assert search("dol")[0]["id"].startswith("br_dolo")
    assert search("x") == [] and len(search("a", 3)) <= 3


def test_resolved_status_constants():
    assert RESOLVED_STATUSES == {"resolved", "user_selected"}


# ----------------------------------------------------------------------------- patient-specific limits
def dose_findings(r):
    return [f for f in r["findings"] if f["type"] == "dose_concern" and f["severity"] != "info"]


def test_adult_under_50kg_uses_weight_based_paracetamol_limit():
    meds = [P("1", "Dolo 650", "br_dolo_650", "1", "QID"), P("2", "Sumo", "br_sumo", "1", "TDS")]  # 3575 mg/day
    heavy = run_check(meds, {"age_years": 40, "weight_kg": 70})
    light = run_check(meds, {"age_years": 40, "weight_kg": 48})
    assert not dose_findings(heavy)
    f = dose_findings(light)[0]
    assert f["evidence"]["rule_id"] == "R-DOSE-002" and f["evidence"]["limit_mg"] == 2880 and f["evidence"]["computed_daily_mg"] == 3575


def test_child_paracetamol_limit_needs_weight_and_uses_it():
    meds = [P("1", "Calpol 500", "br_calpol_500", "1", "QID")]  # 2000 mg/day
    assert any("patient_weight" in x["missing"] for x in run_check(meds, {"age_years": 6})["missing_information"])
    assert not dose_findings(run_check(meds, {"age_years": 6}))
    f = dose_findings(run_check(meds, {"age_years": 6, "weight_kg": 15}))[0]  # limit 900 mg/day
    assert f["evidence"]["rule_id"] == "R-DOSE-003" and f["evidence"]["limit_mg"] == 900
    assert not dose_findings(run_check(meds, {"age_years": 6, "weight_kg": 40}))


def test_adult_limit_is_never_applied_to_a_child_for_other_drugs():
    r = run_check([P("1", "Brufen 400", "br_brufen_400", "1", "QID")], {"age_years": 8, "weight_kg": 25})
    assert not dose_findings(r)


def test_ibuprofen_and_diclofenac_daily_limits():
    over_ibu = run_check([P("1", "Brufen 400", "br_brufen_400", "2", "QID")], {"age_years": 35})  # 3200
    f = dose_findings(over_ibu)[0]
    assert f["evidence"]["rule_id"] == "R-DOSE-004" and f["severity"] == "moderate" and f["tier"] == "know"
    over_dic = run_check([P("1", "Voveran 50", "br_voveran_50", "1", "QID")], {"age_years": 35})  # 200
    assert dose_findings(over_dic)[0]["evidence"]["rule_id"] == "R-DOSE-005"
    assert not dose_findings(run_check([P("1", "Brufen 400", "br_brufen_400", "1", "TDS")], {"age_years": 35}))


def test_combination_products_add_up_into_one_daily_total():
    r = run_check([P("1", "Combiflam", "br_combiflam", "1", "TDS"), P("2", "Brufen 400", "br_brufen_400", "1", "TDS")], {"age_years": 30})
    ibu = [t for t in r["ingredient_totals"] if t["ingredient"] == "ibuprofen"][0]
    assert ibu["total_mg"] == 2400 and {p["mg_per_day"] for p in ibu["parts"]} == {1200}
    assert not dose_findings(r)  # exactly at the limit is not over it


def test_kidney_function_rules():
    meds = [M("1", "Glycomet 500", "br_glycomet_500"), M("2", "Brufen 400", "br_brufen_400"), M("3", "Aldactone 25", "br_aldactone_25")]
    reduced = run_check(meds, {"age_years": 60, "kidney": "reduced"})
    got = {f["evidence"]["rule_id"] for f in reduced["findings"] if f["type"] == "patient_specific"}
    assert got == {"R-PAT-001", "R-PAT-002", "R-PAT-003"}
    normal = run_check(meds, {"age_years": 60, "kidney": "normal"})
    assert not [f for f in normal["findings"] if f["type"] == "patient_specific"]
    unknown = run_check(meds, {"age_years": 60})
    assert not [f for f in unknown["findings"] if f["type"] == "patient_specific"]
    assert sum("kidney_function" in x["missing"] for x in unknown["missing_information"]) == 3  # asked, not assumed


def test_kidney_rule_ignores_unrelated_medicines():
    r = run_check([M("1", "Telma 40", "br_telma_40")], {"age_years": 60, "kidney": "reduced"})
    assert not [f for f in r["findings"] if f["type"] == "patient_specific"]


def test_alerts_are_tiered_so_serious_ones_stand_out():
    r = run_check([M("1", "Warfarin", "gen_warfarin"), M("2", "Voveran 50", "br_voveran_50"), M("3", "Telma 40", "br_telma_40"),
                   M("4", "Mystery", None, status="unresolved")])
    tiers = {f["title"]: f["tier"] for f in r["findings"]}
    assert tiers["Warfarin with an NSAID"] == "act" and tiers["Telmisartan with an NSAID"] == "know"
    assert r["summary"]["by_tier"] == {"act": 1, "know": 1, "fyi": 0}  # the unresolved notice is not counted as an alert


def test_strength_in_grams_is_flagged_not_converted():
    r = run_check([P("1", "Paracetamol", "gen_paracetamol", "1", "QID", "1 g")], {"age_years": 30})
    assert not r["ingredient_totals"] and any(x["missing"][0] == "strength" for x in r["missing_information"] if x["medicine"])
