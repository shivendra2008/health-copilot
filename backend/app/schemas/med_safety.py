"""Request schemas for Medication Safety."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .api import Lang

EDITABLE_FIELDS = ("name", "strength", "dosage", "frequency", "duration", "route", "instructions")
UncertainField = Literal["name", "strength", "dosage", "frequency", "duration", "route"]


def _blank_to_none(v):
    return None if isinstance(v, str) and not v.strip() else v


class _Req(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ResolveBrandRequest(_Req):
    name: str = Field(min_length=1, max_length=200)
    strength: str | None = Field(default=None, max_length=80)


class ManualMedicationRequest(_Req):
    name: str = Field(min_length=1, max_length=200)
    strength: str | None = Field(default=None, max_length=80)
    dosage: str | None = Field(default=None, max_length=200)
    frequency: str | None = Field(default=None, max_length=120)
    duration: str | None = Field(default=None, max_length=120)
    route: str | None = Field(default=None, max_length=60)
    instructions: str | None = Field(default=None, max_length=300)
    current_status: Literal["current", "past", "unknown"] = "current"

    _n = field_validator("strength", "dosage", "frequency", "duration", "route", "instructions", mode="before")(_blank_to_none)


class Resolution(_Req):
    action: Literal["select", "unresolved", "auto"]
    catalogue_id: str | None = Field(default=None, max_length=80)


class ConfirmedMedicationPatch(_Req):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    strength: str | None = Field(default=None, max_length=80)
    dosage: str | None = Field(default=None, max_length=200)
    frequency: str | None = Field(default=None, max_length=120)
    duration: str | None = Field(default=None, max_length=120)
    route: str | None = Field(default=None, max_length=60)
    instructions: str | None = Field(default=None, max_length=300)
    current_status: Literal["current", "past", "unknown"] | None = None
    uncertain_fields: list[UncertainField] | None = None
    resolution: Resolution | None = None

    _n = field_validator("strength", "dosage", "frequency", "duration", "route", "instructions", mode="before")(_blank_to_none)


class CheckRequest(_Req):
    source_type: Literal["document", "current_list"]
    document_id: str | None = None
    include_current: bool = False


class ExplainRequest(_Req):
    language: Lang = "en"


class ParseRequest(_Req):
    text: str = Field(min_length=1, max_length=6000)


class AnalyzeMedicine(_Req):
    key: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    strength: str | None = Field(default=None, max_length=80)
    dosage: str | None = Field(default=None, max_length=120)
    frequency: str | None = Field(default=None, max_length=120)
    timing: str | None = Field(default=None, max_length=60)
    duration: str | None = Field(default=None, max_length=60)
    catalogue_id: str | None = Field(default=None, max_length=80)
    resolution_choice: Literal["select", "unresolved"] | None = None

    _n = field_validator("strength", "dosage", "frequency", "timing", "duration", mode="before")(_blank_to_none)


class PatientIn(_Req):
    age_years: int | None = Field(default=None, ge=0, le=120)
    weight_kg: float | None = Field(default=None, gt=0, le=400)
    kidney: Literal["normal", "reduced", "unknown"] = "unknown"


class AnalyzeRequest(_Req):
    medicines: list[AnalyzeMedicine] = Field(min_length=1, max_length=30)
    patient: PatientIn = PatientIn()


class SaveReportRequest(AnalyzeRequest):
    document_id: str | None = None
