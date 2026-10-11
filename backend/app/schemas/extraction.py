"""Extraction data model.

`LLMExtraction` is what the model must return (strict JSON schema, every field
required, unknowns as null). `ExtractionData` is the stored/editable shape: the
same fields plus a stable `key` and provenance flags per item.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

DocType = Literal["prescription", "lab_report", "diagnostic_report", "discharge_summary", "other"]
Confidence = Literal["high", "medium", "low"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _blank_to_none(v):
    if isinstance(v, str) and v.strip().lower() in ("", "null", "none", "n/a", "na", "-", "not mentioned", "not available"):
        return None
    return v


class LabResult(_Strict):
    test_name: str = Field(min_length=1, max_length=200)
    value: str = Field(min_length=1, max_length=100)
    unit: str | None = Field(default=None, max_length=50)
    reference_range: str | None = Field(default=None, max_length=120)
    flag: str | None = Field(default=None, max_length=30)
    category: str | None = Field(default=None, max_length=80)
    source_text: str = Field(default="", max_length=500)
    confidence: Confidence = "medium"

    _n = field_validator("unit", "reference_range", "flag", "category", mode="before")(_blank_to_none)


class Medication(_Strict):
    name: str = Field(min_length=1, max_length=200)
    strength: str | None = Field(default=None, max_length=80)
    dosage: str | None = Field(default=None, max_length=200)
    frequency: str | None = Field(default=None, max_length=120)
    duration: str | None = Field(default=None, max_length=120)
    route: str | None = Field(default=None, max_length=60)
    instructions: str | None = Field(default=None, max_length=300)
    source_text: str = Field(default="", max_length=500)
    confidence: Confidence = "medium"

    _n = field_validator("strength", "dosage", "frequency", "duration", "route", "instructions", mode="before")(_blank_to_none)


class ConditionItem(_Strict):
    description: str = Field(min_length=1, max_length=300)
    status: str | None = Field(default=None, max_length=60)
    source_text: str = Field(default="", max_length=500)
    confidence: Confidence = "medium"

    _n = field_validator("status", mode="before")(_blank_to_none)


class Procedure(_Strict):
    name: str = Field(min_length=1, max_length=300)
    date: str | None = None
    source_text: str = Field(default="", max_length=500)
    confidence: Confidence = "medium"

    _n = field_validator("date", mode="before")(_blank_to_none)


class FollowUp(_Strict):
    instruction: str = Field(min_length=1, max_length=400)
    date: str | None = None
    source_text: str = Field(default="", max_length=500)

    _n = field_validator("date", mode="before")(_blank_to_none)


class Finding(_Strict):
    text: str = Field(min_length=1, max_length=500)
    source_text: str = Field(default="", max_length=500)
    confidence: Confidence = "medium"


class LLMExtraction(_Strict):
    document_type: DocType
    classification_confidence: Confidence
    document_date: str | None
    facility: str | None
    clinician: str | None
    lab_results: list[LabResult]
    medications: list[Medication]
    conditions: list[ConditionItem]
    procedures: list[Procedure]
    follow_ups: list[FollowUp]
    findings: list[Finding]

    _n = field_validator("document_date", "facility", "clinician", mode="before")(_blank_to_none)


# --------------------------------------------------------------------------- stored / editable
class _Item(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    key: str | None = None
    origin: Literal["ai", "user"] = "ai"
    user_corrected: bool = False


class LabResultItem(LabResult, _Item):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class MedicationItem(Medication, _Item):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class ConditionRecord(ConditionItem, _Item):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class ProcedureItem(Procedure, _Item):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class FollowUpItem(FollowUp, _Item):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class FindingItem(Finding, _Item):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class ExtractionData(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    document_type: DocType = "other"
    classification_confidence: Confidence = "medium"
    document_date: str | None = None
    facility: str | None = None
    clinician: str | None = None
    lab_results: list[LabResultItem] = Field(default_factory=list, max_length=300)
    medications: list[MedicationItem] = Field(default_factory=list, max_length=100)
    conditions: list[ConditionRecord] = Field(default_factory=list, max_length=100)
    procedures: list[ProcedureItem] = Field(default_factory=list, max_length=100)
    follow_ups: list[FollowUpItem] = Field(default_factory=list, max_length=100)
    findings: list[FindingItem] = Field(default_factory=list, max_length=100)

    _n = field_validator("document_date", "facility", "clinician", mode="before")(_blank_to_none)


SECTIONS = ("lab_results", "medications", "conditions", "procedures", "follow_ups", "findings")


# --------------------------------------------------------------------------- JSON schema for Groq
def _nullable(t: str) -> dict:
    return {"type": [t, "null"]}


_CONF = {"type": "string", "enum": ["high", "medium", "low"]}
_SRC = {"type": "string", "description": "Exact text copied verbatim from the document that supports this item."}


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


LLM_EXTRACTION_JSON_SCHEMA = _obj({
    "document_type": {"type": "string", "enum": ["prescription", "lab_report", "diagnostic_report", "discharge_summary", "other"]},
    "classification_confidence": _CONF,
    "document_date": {**_nullable("string"), "description": "Report/prescription date as YYYY-MM-DD, or null if not clearly stated."},
    "facility": _nullable("string"),
    "clinician": _nullable("string"),
    "lab_results": {"type": "array", "items": _obj({
        "test_name": {"type": "string"},
        "value": {"type": "string", "description": "Result exactly as printed, e.g. '11.2', '<0.5', 'Positive'."},
        "unit": _nullable("string"),
        "reference_range": {**_nullable("string"), "description": "Reference range exactly as printed on this report."},
        "flag": {**_nullable("string"), "description": "Flag printed on the report (H, L, High, Low, *), else null."},
        "category": {**_nullable("string"), "description": "Panel/section heading, e.g. 'Complete Blood Count', 'Lipid Profile'."},
        "source_text": _SRC,
        "confidence": _CONF,
    })},
    "medications": {"type": "array", "items": _obj({
        "name": {"type": "string"}, "strength": _nullable("string"), "dosage": _nullable("string"),
        "frequency": _nullable("string"), "duration": _nullable("string"), "route": _nullable("string"),
        "instructions": _nullable("string"), "source_text": _SRC, "confidence": _CONF,
    })},
    "conditions": {"type": "array", "items": _obj({
        "description": {"type": "string", "description": "Diagnosis exactly as explicitly stated in the document."},
        "status": _nullable("string"), "source_text": _SRC, "confidence": _CONF,
    })},
    "procedures": {"type": "array", "items": _obj({
        "name": {"type": "string"}, "date": _nullable("string"), "source_text": _SRC, "confidence": _CONF,
    })},
    "follow_ups": {"type": "array", "items": _obj({
        "instruction": {"type": "string"}, "date": _nullable("string"), "source_text": _SRC,
    })},
    "findings": {"type": "array", "items": _obj({
        "text": {"type": "string", "description": "Clinical observation or impression explicitly written in the document."},
        "source_text": _SRC, "confidence": _CONF,
    })},
})


# --------------------------------------------------------------------------- summary schema
class SummaryFinding(_Strict):
    statement: str
    related_item: str | None


class TermExplanation(_Strict):
    term: str
    explanation: str


class LLMSummary(_Strict):
    overview: str
    key_findings: list[SummaryFinding]
    term_explanations: list[TermExplanation]
    questions_for_clinician: list[str]


LLM_SUMMARY_JSON_SCHEMA = _obj({
    "overview": {"type": "string", "description": "2-4 sentences describing what the document contains."},
    "key_findings": {"type": "array", "items": _obj({
        "statement": {"type": "string"},
        "related_item": {**_nullable("string"), "description": "Exact test/medication/condition name this statement refers to."},
    })},
    "term_explanations": {"type": "array", "items": _obj({"term": {"type": "string"}, "explanation": {"type": "string"}})},
    "questions_for_clinician": {"type": "array", "items": {"type": "string"}},
})
