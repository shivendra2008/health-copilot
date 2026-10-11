"""Typed request/response schemas."""
from datetime import date
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from .extraction import ExtractionData

T = TypeVar("T")
Lang = Literal["en", "hi", "mr", "te"]


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class DocumentOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    file_name: str
    mime_type: str
    size_bytes: int
    page_count: int | None = None
    doc_type: str
    document_date: date | None = None
    source_facility: str | None = None
    source_clinician: str | None = None
    status: str
    status_detail: str | None = None
    error_code: str | None = None
    text_method: str | None = None
    ocr_confidence: float | None = None
    attempts: int = 0
    created_at: str
    updated_at: str
    confirmed_at: str | None = None


class UploadResponse(BaseModel):
    document: DocumentOut
    duplicate: bool = False


class ExtractionOut(BaseModel):
    id: str
    document_id: str
    version: int
    model: str | None
    status: str
    data: ExtractionData
    ai_output: ExtractionData
    issues: list[dict[str, Any]]
    derived: list[dict[str, Any]]
    summary: dict[str, Any] | None
    corrected_at: str | None
    confirmed_at: str | None
    created_at: str


class ExtractionHistoryItem(BaseModel):
    id: str
    version: int
    status: str
    model: str | None
    created_at: str
    corrected_at: str | None
    confirmed_at: str | None


class ExtractionPatch(BaseModel):
    data: ExtractionData


class ProcessRequest(BaseModel):
    language: Lang = "en"


class SummaryRequest(BaseModel):
    language: Lang = "en"


class ConfirmResponse(BaseModel):
    document: DocumentOut
    records: dict[str, int]


class ProfileOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    email: str | None = None
    full_name: str | None = None
    date_of_birth: date | None = None
    sex: str | None = None
    blood_group: str | None = None
    preferred_language: Lang = "en"
    mock_abha_id: str | None = None
    age_years: int | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    # None means the database predates onboarding (migration 0002 not applied) → treat as done.
    onboarding_completed: bool | None = None


class ProfilePatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    full_name: str | None = Field(default=None, max_length=120)
    date_of_birth: date | None = None
    sex: Literal["female", "male", "other", "unknown"] | None = None
    blood_group: Literal["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] | None = None
    preferred_language: Lang | None = None
    age_years: int | None = Field(default=None, ge=0, le=130)
    height_cm: float | None = Field(default=None, ge=30, le=260)
    weight_kg: float | None = Field(default=None, ge=1, le=400)
    onboarding_completed: bool | None = None


class SignupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    full_name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=128)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    conversation_id: str | None = None
    language: Lang = "en"


class Citation(BaseModel):
    ref: str
    kind: str
    document_id: str | None
    label: str
    detail: str | None = None
    date: str | None = None


class ChatResponse(BaseModel):
    conversation_id: str
    message_id: str
    answer: str
    citations: list[Citation]
    insufficient_information: bool
