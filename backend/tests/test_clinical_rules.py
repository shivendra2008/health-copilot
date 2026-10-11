import pytest

from app.services.clinical_rules import (appears_in, interpret, normalize_test_name, normalize_unit, parse_iso_date,
                                         parse_range, parse_value, units_compatible, value_in_snippet)


@pytest.mark.parametrize("raw,num,cmp", [
    ("11.2", 11.2, None), ("1,234", 1234.0, None), ("<0.5", 0.5, "<"), ("> 90", 90.0, ">"),
    ("≤ 5", 5.0, "<="), ("104 mg/dL", 104.0, None), ("Positive", None, None), ("", None, None), (None, None, None),
    ("11.2.3", None, None),
])
def test_parse_value(raw, num, cmp):
    v = parse_value(raw)
    assert v.number == num and v.comparator == cmp


@pytest.mark.parametrize("raw,low,high", [
    ("13.0 - 17.0", 13.0, 17.0), ("13-17 g/dL", 13.0, 17.0), ("0.5 to 1.2", 0.5, 1.2), ("70 – 100", 70.0, 100.0),
    ("<200", None, 200.0), ("Up to 40", None, 40.0), ("> 40", 40.0, None), ("1,500 - 4,000", 1500.0, 4000.0),
])
def test_parse_range(raw, low, high):
    r = parse_range(raw)
    assert r is not None and r.low == low and r.high == high


@pytest.mark.parametrize("raw", [None, "", "See note", "17 - 13"])
def test_parse_range_rejects(raw):
    assert parse_range(raw) is None


def test_interpret():
    rng = parse_range("13.0 - 17.0")
    assert interpret(parse_value("11.2"), rng) == "below_range"
    assert interpret(parse_value("13.0"), rng) == "within_range"
    assert interpret(parse_value("17.1"), rng) == "above_range"
    assert interpret(parse_value("Positive"), rng) == "unverified"
    assert interpret(parse_value("11"), None) == "unverified"
    # comparator values are never auto-interpreted
    assert interpret(parse_value("<0.5"), parse_range("0 - 1")) == "unverified"
    # exclusive bound
    assert interpret(parse_value("200"), parse_range("<200")) == "above_range"
    assert interpret(parse_value("40"), parse_range("> 40")) == "below_range"


def test_units():
    assert normalize_unit("mg/dl") == "mg/dL"
    assert normalize_unit("gm/dL") == "g/dL"
    assert normalize_unit(" mmol/L ") == "mmol/L"
    assert normalize_unit(None) is None
    assert units_compatible("mg/dl", "mg/dL")
    assert not units_compatible("mg/dL", "mmol/L")   # never convert glucose units
    assert not units_compatible(None, None)


def test_test_names():
    assert normalize_test_name("Hb") == "hemoglobin"
    assert normalize_test_name("Haemoglobin") == "hemoglobin"
    assert normalize_test_name("Serum Creatinine") == "creatinine"
    assert normalize_test_name("FBS") == "fasting glucose"
    assert normalize_test_name("Glucose (Plasma)") == "glucose"


def test_provenance():
    doc = "Hemoglobin    11.2   g/dL    13.0 - 17.0   L\nPlatelets 2.5 lakhs/cumm"
    assert appears_in("Hemoglobin 11.2 g/dL 13.0 - 17.0 L", doc)
    assert not appears_in("Hemoglobin 12.2 g/dL", doc)
    assert not appears_in("", doc)
    assert value_in_snippet("11.2", "Hemoglobin 11.2 g/dL")
    assert not value_in_snippet("12.2", "Hemoglobin 11.2 g/dL")
    assert value_in_snippet("Positive", "HBsAg: POSITIVE")


def test_dates():
    assert parse_iso_date("2026-03-12").isoformat() == "2026-03-12"
    assert parse_iso_date("12/03/2026") is None
    assert parse_iso_date("1800-01-01") is None
