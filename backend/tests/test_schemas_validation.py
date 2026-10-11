from datetime import date

import jsonschema
import pytest
from pydantic import ValidationError

from app.routers.documents import mark_corrections
from app.schemas.extraction import (LLM_EXTRACTION_JSON_SCHEMA, LLM_SUMMARY_JSON_SCHEMA, ExtractionData,
                                   LLMExtraction)
from app.services.summary import derived_comparisons
from app.services.validation import assign_keys, has_blocking, validate

DOC = """CITY DIAGNOSTICS LAB    Date: 12/03/2026
Hemoglobin    11.2   g/dL    13.0 - 17.0   L
Fasting Glucose   104   mg/dL   70 - 100   H
Rx: Tab Metformin 500 mg 1-0-1 x 30 days"""

LLM_OK = {
    "document_type": "lab_report", "classification_confidence": "high", "document_date": "2026-03-12",
    "facility": "City Diagnostics Lab", "clinician": None,
    "lab_results": [
        {"test_name": "Hemoglobin", "value": "11.2", "unit": "g/dL", "reference_range": "13.0 - 17.0", "flag": "L",
         "category": None, "source_text": "Hemoglobin 11.2 g/dL 13.0 - 17.0 L", "confidence": "high"},
        {"test_name": "Fasting Glucose", "value": "104", "unit": "mg/dL", "reference_range": "70 - 100", "flag": "H",
         "category": None, "source_text": "Fasting Glucose 104 mg/dL 70 - 100 H", "confidence": "high"},
    ],
    "medications": [{"name": "Metformin", "strength": "500 mg", "dosage": "1-0-1", "frequency": None,
                     "duration": "30 days", "route": None, "instructions": None,
                     "source_text": "Tab Metformin 500 mg 1-0-1 x 30 days", "confidence": "high"}],
    "conditions": [], "procedures": [], "follow_ups": [], "findings": [],
}


def _strictify_ok(schema):
    """Groq strict mode requires every property required and additionalProperties false."""
    if schema.get("type") == "object" or (isinstance(schema.get("type"), list) and "object" in schema["type"]):
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == set(schema["properties"])
        for v in schema["properties"].values():
            _strictify_ok(v)
    if "items" in schema:
        _strictify_ok(schema["items"])


def test_json_schemas_are_strict_compatible():
    _strictify_ok(LLM_EXTRACTION_JSON_SCHEMA)
    _strictify_ok(LLM_SUMMARY_JSON_SCHEMA)
    jsonschema.validate(LLM_OK, LLM_EXTRACTION_JSON_SCHEMA)


def test_llm_extraction_parses_and_nulls_placeholders():
    raw = {**LLM_OK, "facility": "N/A", "clinician": " "}
    m = LLMExtraction.model_validate(raw)
    assert m.facility is None and m.clinician is None


def test_llm_extraction_rejects_bad_type_and_extra():
    with pytest.raises(ValidationError):
        LLMExtraction.model_validate({**LLM_OK, "document_type": "x-ray"})
    with pytest.raises(ValidationError):
        LLMExtraction.model_validate({**LLM_OK, "diagnosis_guess": "anaemia"})


def _data(**over):
    return assign_keys(ExtractionData.model_validate({**LLM_OK, **over}))


def test_validate_clean_document_has_no_blocking_issues():
    issues = validate(_data(), DOC, None, today=date(2026, 10, 1))
    assert not has_blocking(issues)
    assert not [i for i in issues if i["code"] in ("source_not_found", "value_not_in_source", "flag_mismatch")]


def test_validate_flags_fabricated_value():
    d = _data()
    d.lab_results[0].value = "12.9"   # not in the document
    issues = validate(d, DOC, None, today=date(2026, 10, 1))
    assert any(i["code"] == "value_not_in_source" for i in issues)


def test_validate_flags_missing_source():
    d = _data()
    d.lab_results[0].source_text = "Hemoglobin 9.9 g/dL"
    assert any(i["code"] == "source_not_found" for i in validate(d, DOC, today=date(2026, 10, 1)))


def test_validate_future_and_invalid_dates_block():
    assert has_blocking(validate(_data(document_date="2027-01-01"), DOC, today=date(2026, 10, 1)))
    assert has_blocking(validate(_data(document_date="31-02-2026"), DOC, today=date(2026, 10, 1)))
    assert any(i["code"] == "missing_date" for i in validate(_data(document_date=None), DOC, today=date(2026, 10, 1)))


def test_validate_flag_mismatch_and_missing_unit():
    d = _data()
    d.lab_results[0].flag = "H"   # value is below range
    d.lab_results[1].unit = None
    codes = {i["code"] for i in validate(d, DOC, today=date(2026, 10, 1))}
    assert "flag_mismatch" in codes and "missing_unit" in codes


def test_low_ocr_confidence_flagged():
    assert any(i["code"] == "low_ocr_confidence" for i in validate(_data(), DOC, 0.6, today=date(2026, 10, 1)))


def test_derived_comparisons():
    d = {x["test_name"]: x["status"] for x in derived_comparisons(_data())}
    assert d == {"Hemoglobin": "below_range", "Fasting Glucose": "above_range"}


def test_mark_corrections_preserves_ai_original():
    ai = _data()
    edited = ExtractionData.model_validate(ai.model_dump())
    edited.lab_results[0].value = "11.4"
    edited_dump = edited.model_dump()
    edited_dump["lab_results"].append({"test_name": "Vitamin D", "value": "18", "unit": "ng/mL",
                                       "reference_range": "30 - 100", "source_text": ""})
    out = mark_corrections(ExtractionData.model_validate(edited_dump), ai)
    assert out.lab_results[0].user_corrected is True
    assert out.lab_results[1].user_corrected is False
    assert out.lab_results[2].origin == "user" and out.lab_results[2].key
    assert ai.lab_results[0].value == "11.2"   # original untouched
    # user-corrected values skip provenance checks
    issues = validate(out, DOC, today=date(2026, 10, 1))
    assert not [i for i in issues if i["path"] == f"lab_results.{out.lab_results[0].key}" and i["code"] == "value_not_in_source"]


def test_spoofed_keys_become_user_items():
    ai = _data()
    d = ai.model_dump()
    d["lab_results"][0]["key"] = "not-a-real-key"
    out = mark_corrections(ExtractionData.model_validate(d), ai)
    assert out.lab_results[0].origin == "user" and out.lab_results[0].key != "not-a-real-key"
