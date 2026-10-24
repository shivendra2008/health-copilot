"""Typed-prescription parsing, abbreviation decoding and misspelled-brand handling."""
import pytest

from app.services.med_safety.analysis import analyze
from app.services.med_safety.catalogue import resolve
from app.services.med_safety.parser import decode_frequency, decode_timing, parse_line, parse_prescription


@pytest.mark.parametrize("line,expected", [
    ("Tab Dolo 650 mg 1 tablet 1-0-1 x 5 days", dict(name="Dolo", strength="650 mg", dosage="1 tablet", frequency="1-0-1", duration="5 days")),
    ("2) Combiflam TDS after food for 3 days", dict(name="Combiflam", frequency="TDS", timing="after food", duration="3 days")),
    ("Cap. Warfarin 5mg OD HS", dict(name="Warfarin", strength="5 mg", frequency="OD")),
    ("Tab Pantocid 40 mg AC empty stomach", dict(name="Pantocid", strength="40 mg", timing="AC")),
    ("Amoxicillin + Clavulanic acid 625mg q8h", dict(name="Amoxicillin + Clavulanic acid", strength="625 mg", frequency="q8h")),
    ("T. Augmentin 625 mg 1 tab BD x 1 week", dict(name="Augmentin", strength="625 mg", dosage="1 tab", frequency="BD", duration="1 week")),
    ("Syp Crocine 5 ml SOS", dict(name="Crocine", dosage="5 ml", frequency="SOS")),
    ("Tab Voveran 50 BD pc", dict(name="Voveran 50", frequency="BD", timing="pc")),
])
def test_parse_line(line, expected):
    got = parse_line(line)
    assert got is not None and all(got[k] == v for k, v in expected.items()), got


def test_unreadable_lines_are_reported_not_guessed():
    r = parse_prescription("Rx\n12345\n---\nTab Dolo 650 BD\n")
    assert [m["name"] for m in r["medicines"]] == ["Dolo 650"] and r["skipped"] == ["12345", "---"]


def test_parse_is_bounded():
    r = parse_prescription("\n".join(f"Tab Drug{chr(97 + i % 26)}{i} OD" for i in range(40)), max_medicines=30)
    assert len(r["medicines"]) == 30 and len(r["skipped"]) == 10


@pytest.mark.parametrize("code,meaning,per_day", [
    ("OD", "once_daily", 1), ("BD", "twice_daily", 2), ("TDS", "three_times_daily", 3), ("QID", "four_times_daily", 4),
    ("HS", "at_bedtime", 1), ("SOS", "as_needed", None), ("STAT", "single_dose_now", None),
    ("1-0-1", "schedule", 2), ("1-1-1", "schedule", 3), ("q6h", "every_n_hours", 4), ("every 8 hours", "every_n_hours", 3),
    ("twice a day", "twice_daily", 2), ("whenever", "unclear", None),
])
def test_decode_frequency(code, meaning, per_day):
    d = decode_frequency(code)
    assert d["meaning"] == meaning and d["per_day"] == per_day


def test_schedule_slots_are_kept_for_explanation():
    assert decode_frequency("1-0-1")["slots"] == [1, 0, 1]
    assert decode_frequency("q6h")["hours"] == 6


@pytest.mark.parametrize("code,meaning", [("AC", "before_food"), ("pc", "after_food"), ("with food", "with_food"), ("empty stomach", "empty_stomach")])
def test_decode_timing(code, meaning):
    assert decode_timing(code)["meaning"] == meaning


def test_no_frequency_means_nothing_is_decoded():
    assert decode_frequency(None) is None and decode_timing("") is None


# ----------------------------------------------------------------------------- misspelled brands
@pytest.mark.parametrize("typo,suggested", [
    ("Combflam", "br_combiflam"), ("Parcetamol", "gen_paracetamol"), ("Augmentn", "br_augmentin_625"), ("Voveren", "br_voveran_50"),
    ("Warfarine", "gen_warfarin"), ("Ibuprofn", "gen_ibuprofen"), ("Glycomit", "br_glycomet_500"),
])
def test_misspelling_is_suggested_never_auto_applied(typo, suggested):
    r = resolve(typo)
    assert r.status == "ambiguous" and r.catalogue_id is None and r.reason == "no_exact_match_suggestions"
    assert suggested in [c["id"] for c in r.candidates]


def test_pcm_is_paracetamol():
    assert resolve("PCM", "500 mg").catalogue_id == "gen_paracetamol"


def test_hidden_duplicate_in_combination_products_is_found_end_to_end():
    typed = parse_prescription("Tab Dolo 650 mg 1 tab TDS\nTab Sumo 1 tab BD\nTab Pantocid 40 AC OD")["medicines"]
    a = analyze(typed, {"age_years": 40})
    dup = [f for f in a["findings"] if f["type"] == "duplicate_ingredient"][0]
    assert "Paracetamol" in dup["title"] and {m["label"] for m in dup["medicines"]} == {"Dolo 650 mg", "Sumo"}
    sumo = [m for m in a["medicines"] if m["name"] == "Sumo"][0]
    assert [i["name"] for i in sumo["catalogue_entry"]["ingredients"]] == ["Nimesulide", "Paracetamol"]
    assert sumo["frequency_info"]["meaning"] == "twice_daily"


def test_user_choice_overrides_a_suggestion_and_unresolved_is_respected():
    base = {"key": "m1", "name": "Combflam", "frequency": "TDS"}
    assert analyze([base], None)["medicines"][0]["resolution"]["status"] == "ambiguous"
    chosen = analyze([{**base, "catalogue_id": "br_combiflam", "resolution_choice": "select"}], None)["medicines"][0]["resolution"]
    assert chosen["status"] == "user_selected" and chosen["catalogue_id"] == "br_combiflam"
    skipped = analyze([{**base, "catalogue_id": "br_combiflam", "resolution_choice": "unresolved"}], None)
    assert skipped["unresolved"][0]["reason"] == "marked_unresolved"
    bogus = analyze([{**base, "catalogue_id": "does_not_exist", "resolution_choice": "select"}], None)["medicines"][0]["resolution"]
    assert bogus["status"] == "ambiguous"  # an unknown id is ignored, not trusted
