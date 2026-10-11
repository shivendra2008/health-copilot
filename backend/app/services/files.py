"""Upload validation: extension, declared MIME, magic bytes, size, PDF sanity."""
import hashlib
import re
from dataclasses import dataclass

import pymupdf as fitz

from ..config import get_settings
from ..errors import ApiError

ALLOWED = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}


@dataclass
class ValidatedFile:
    safe_name: str
    mime_type: str
    size: int
    sha256: str
    page_count: int


def sniff_mime(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    return None


def safe_filename(name: str) -> str:
    base = name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    base = re.sub(r"[^A-Za-z0-9._ -]", "_", base).strip(" .") or "document"
    return base[:120]


def validate_upload(filename: str, declared_mime: str | None, data: bytes) -> ValidatedFile:
    s = get_settings()
    if not data:
        raise ApiError(400, "empty_file", "The uploaded file is empty.")
    if len(data) > s.max_upload_bytes:
        raise ApiError(413, "file_too_large", f"Files must be {s.max_upload_mb} MB or smaller.")
    name = safe_filename(filename or "document")
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if ext not in ALLOWED:
        raise ApiError(415, "unsupported_type", "Only PDF, JPG, JPEG and PNG files are supported.")
    sniffed = sniff_mime(data)
    if sniffed is None or sniffed != ALLOWED[ext]:
        raise ApiError(415, "content_mismatch", "The file contents do not match its extension or are not a supported format.")
    if declared_mime and declared_mime not in (sniffed, "application/octet-stream"):
        raise ApiError(415, "content_mismatch", "The declared file type does not match the file contents.")

    pages = 1
    try:
        with fitz.open(stream=data, filetype="pdf" if sniffed == "application/pdf" else ext.lstrip(".")) as doc:
            if doc.needs_pass:
                raise ApiError(422, "encrypted_pdf", "Password-protected PDFs are not supported.")
            pages = doc.page_count
    except ApiError:
        raise
    except Exception:
        raise ApiError(422, "malformed_file", "The file appears to be corrupted and could not be opened.")
    if pages < 1:
        raise ApiError(422, "malformed_file", "The document has no pages.")
    if pages > s.max_pdf_pages:
        raise ApiError(422, "too_many_pages", f"Documents can have at most {s.max_pdf_pages} pages.")

    return ValidatedFile(name, sniffed, len(data), hashlib.sha256(data).hexdigest(), pages)
