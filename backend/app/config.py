"""Application settings — everything is configurable through environment variables."""
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parent.parent / ".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    cors_origins: str = "http://localhost:3000"

    # Supabase (service-role key is backend-only)
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_anon_key: str = ""
    storage_bucket: str = "medical-documents"
    signed_url_ttl_seconds: int = 120

    # Groq (OpenAI-compatible API)
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "openai/gpt-oss-20b"
    groq_timeout_seconds: float = 60.0
    groq_max_retries: int = 3
    llm_max_input_chars: int = 24000

    # Uploads / OCR
    max_upload_mb: int = 10
    max_pdf_pages: int = 30
    ocr_enabled: bool = True
    ocr_lang: str = "en"
    ocr_dpi: int = 200
    ocr_cpu_threads: int = 2
    native_text_min_chars_per_page: int = 40

    # Rate limits (requests per window per user)
    rate_limit_window_seconds: int = 60
    rate_limit_uploads: int = 10
    rate_limit_processing: int = 10
    rate_limit_chat: int = 20

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def groq_configured(self) -> bool:
        return bool(self.groq_api_key)

    max_upload_bytes: int = Field(default=0, exclude=True)

    def model_post_init(self, __context) -> None:  # noqa: D401
        self.max_upload_bytes = self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
