"""Text extraction: native PDF text via PyMuPDF, OCR fallback per page."""
from dataclasses import dataclass, field

import pymupdf as fitz

from ..config import get_settings
from .ocr import OcrUnavailable, run_ocr


@dataclass
class ExtractedText:
    text: str
    method: str  # native | ocr | mixed
    ocr_confidence: float | None
    page_count: int
    warnings: list[str] = field(default_factory=list)


def extract_text(data: bytes, mime_type: str) -> ExtractedText:
    s = get_settings()
    if mime_type in ("image/jpeg", "image/png"):
        r = run_ocr(data)
        warnings = []
        if r.confidence is not None and r.confidence < 0.80:
            warnings.append("low_ocr_confidence")
        return ExtractedText(r.text, "ocr", r.confidence, 1, warnings)

    pages_text: list[str] = []
    used_native = used_ocr = False
    confidences: list[float] = []
    warnings: list[str] = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        for i, page in enumerate(doc):
            native = page.get_text("text", sort=True).strip()
            if len(native) >= s.native_text_min_chars_per_page:
                pages_text.append(native)
                used_native = True
                continue
            # Scanned page → render and OCR
            try:
                pix = page.get_pixmap(dpi=s.ocr_dpi)
                r = run_ocr(pix.tobytes("png"))
                used_ocr = True
                if r.confidence is not None:
                    confidences.append(r.confidence)
                pages_text.append(r.text or native)
            except OcrUnavailable:
                if native:
                    pages_text.append(native)
                    used_native = True
                warnings.append(f"ocr_unavailable_page_{i + 1}")
        page_count = doc.page_count

    if not used_ocr and not used_native and any(w.startswith("ocr_unavailable") for w in warnings):
        raise OcrUnavailable("This PDF is scanned and OCR is unavailable on the server.")

    text = "\n\n".join(f"--- Page {i + 1} ---\n{t}" for i, t in enumerate(pages_text)) if page_count > 1 else (pages_text[0] if pages_text else "")
    method = "mixed" if (used_native and used_ocr) else ("ocr" if used_ocr else "native")
    conf = round(sum(confidences) / len(confidences), 4) if confidences else None
    if conf is not None and conf < 0.80:
        warnings.append("low_ocr_confidence")
    return ExtractedText(text, method, conf, page_count, warnings)
