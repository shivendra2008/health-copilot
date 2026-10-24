"""Request schemas for allergies, schedule and alternatives."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .api import Lang


class _Req(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _blank(v):
    return None if isinstance(v, str) and not v.strip() else v


class AllergyIn(_Req):
    substance: str = Field(min_length=2, max_length=100)
    severity: Literal["mild", "moderate", "severe", "unknown"] = "unknown"
    reaction: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=300)

    _n = field_validator("reaction", "notes", mode="before")(_blank)


class AllergyPatch(_Req):
    substance: str | None = Field(default=None, min_length=2, max_length=100)
    severity: Literal["mild", "moderate", "severe", "unknown"] | None = None
    reaction: str | None = Field(default=None, max_length=200)
    notes: str | None = Field(default=None, max_length=300)

    _n = field_validator("reaction", "notes", mode="before")(_blank)


class ScreenMedicine(_Req):
    name: str = Field(min_length=1, max_length=200)
    strength: str | None = Field(default=None, max_length=80)

    _n = field_validator("strength", mode="before")(_blank)


class ScreenRequest(_Req):
    medicines: list[ScreenMedicine] = Field(min_length=1, max_length=40)


class AlternativesRequest(_Req):
    name: str = Field(min_length=1, max_length=200)
    strength: str | None = Field(default=None, max_length=80)
    use_ai: bool = True
    language: Lang = "en"

    _n = field_validator("strength", mode="before")(_blank)
