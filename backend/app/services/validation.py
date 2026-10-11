"""Deterministic validation of extracted data → review issues.

Each issue: {"path": "<section>.<key>" | "document", "field", "severity", "code", "message"}
severity: "error" blocks confirmation; "warning" needs attention; "info" is advisory.
"""
import uuid
from datetime import date

from ..schemas.extraction import SECTIONS, ExtractionData
from .clinical_rules import (appears_in, interpret, parse_iso_date, parse_range, parse_value,
                             normalize_test_name, value_in_snippet)


def assign_keys(data: ExtractionData) -> ExtractionData:
    for section in SECTIONS:
        for item in getattr(data, section):
            if not item.key:
                item.key = uuid.uuid4().hex[:12]
    return data


def _issue(path, field, severity, code, message):
    return {"path": path, "field": field, "severity": severity, "code": code, "message": message}


def _check_date(path: str, field: str, raw: str | None, issues: list, today: date) -> None:
    if raw is None:
        return
    d = parse_iso_date(raw)
    if d is None:
        issues.append(_issue(path, field, "error", "invalid_date", f"'{raw}' is not a valid date (use YYYY-MM-DD)."))
    elif d > today:
        issues.append(_issue(path, field, "error", "future_date", "This date is in the future."))


def validate(data: ExtractionData, source_text: str, ocr_confidence: float | None = None,
             today: date | None = None) -> list[dict]:
    today = today or date.today()
    issues: list[dict] = []

    # ---- document level
    if not data.document_date:
        issues.append(_issue("document", "document_date", "warning", "missing_date",
                             "No document date was found. Add it so the record appears correctly on your timeline."))
    _check_date("document", "document_date", data.document_date, issues, today)
    if data.classification_confidence == "low":
        issues.append(_issue("document", "document_type", "warning", "uncertain_type",
                             "The document type is uncertain. Please confirm it."))
    if ocr_confidence is not None and ocr_confidence < 0.80:
        issues.append(_issue("document", None, "warning", "low_ocr_confidence",
                             f"Text recognition confidence is low ({round(ocr_confidence * 100)}%). Check every value against the original."))
    if not any(getattr(data, s) for s in SECTIONS):
        issues.append(_issue("document", None, "warning", "nothing_extracted",
                             "No structured medical data was found. You can add items manually."))

    # ---- lab results
    seen: dict[str, str] = {}
    for it in data.lab_results:
        p = f"lab_results.{it.key}"
        pv = parse_value(it.value)
        rng = parse_range(it.reference_range)
        if not it.user_corrected and it.origin == "ai":
            if not appears_in(it.source_text, source_text):
                issues.append(_issue(p, None, "warning", "source_not_found",
                                     "The supporting text could not be located in the document. Verify this result."))
            elif not value_in_snippet(it.value, it.source_text):
                issues.append(_issue(p, "value", "warning", "value_not_in_source",
                                     "The value does not appear in the supporting text. Verify it."))
            if it.confidence == "low":
                issues.append(_issue(p, None, "warning", "low_confidence", "Extraction confidence is low."))
        if pv.number is not None and not it.unit:
            issues.append(_issue(p, "unit", "warning", "missing_unit", "Numeric result without a unit."))
        if it.reference_range and rng is None:
            issues.append(_issue(p, "reference_range", "info", "range_unparsed",
                                 "Reference range could not be interpreted automatically; range status is unverified."))
        if pv.number is not None and it.value.strip().startswith("-") and pv.number < 0:
            issues.append(_issue(p, "value", "warning", "negative_value", "Negative value — check for an OCR error."))
        if rng is not None and pv.number is not None and it.flag:
            computed = interpret(pv, rng)
            f = it.flag.strip().lower()
            documented_high = f in ("h", "high", "hi", "↑", "a high")
            documented_low = f in ("l", "low", "lo", "↓", "a low")
            if (documented_high and computed != "above_range") or (documented_low and computed != "below_range"):
                issues.append(_issue(p, "flag", "warning", "flag_mismatch",
                                     f"The report flag '{it.flag}' does not match the value compared with the printed range."))
        name = normalize_test_name(it.test_name)
        if name in seen and seen[name] != it.value:
            issues.append(_issue(p, "test_name", "info", "duplicate_test",
                                 "This test appears more than once with different values."))
        seen.setdefault(name, it.value)

    # ---- other sections: provenance + confidence
    label_field = {"medications": "name", "conditions": "description", "procedures": "name",
                   "follow_ups": "instruction", "findings": "text"}
    for section, fld in label_field.items():
        for it in getattr(data, section):
            p = f"{section}.{it.key}"
            if not it.user_corrected and it.origin == "ai":
                if not appears_in(it.source_text, source_text):
                    issues.append(_issue(p, None, "warning", "source_not_found",
                                         "The supporting text could not be located in the document. Verify this item."))
                if getattr(it, "confidence", "medium") == "low":
                    issues.append(_issue(p, None, "warning", "low_confidence", "Extraction confidence is low."))
            if section in ("procedures", "follow_ups"):
                _check_date(p, "date", it.date, issues, today if section == "procedures" else date.max)

    for it in data.medications:
        if not (it.dosage or it.frequency or it.strength):
            issues.append(_issue(f"medications.{it.key}", "dosage", "info", "dosage_not_documented",
                                 "No strength, dosage or frequency was documented. Nothing has been assumed."))
    return issues


def has_blocking(issues: list[dict]) -> bool:
    return any(i["severity"] == "error" for i in issues)
