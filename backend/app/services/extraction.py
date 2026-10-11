"""Structured extraction for documents of any length.

Long reports (many pages / dozens of tests) would overflow a single model response, so the text is
split on page boundaries into chunks, each chunk is extracted with the same strict schema, and the
results are merged. A chunk whose answer is still too long is split in half and retried.
"""
import logging
import re
from collections.abc import Callable

from ..config import get_settings
from ..schemas.extraction import LLM_EXTRACTION_JSON_SCHEMA, LLMExtraction
from .clinical_rules import normalize_test_name
from .groq_client import LLMError, chat_json
from .prompts import EXTRACTION_SYSTEM, extraction_user

log = logging.getLogger("healthcopilot.extraction")

PAGE_MARK = re.compile(r"^--- Page (\d+) ---$", re.M)
CONF_RANK = {"high": 2, "medium": 1, "low": 0}


def split_pages(text: str) -> list[str]:
    """Split on the '--- Page N ---' markers written by text extraction (single page → one piece)."""
    marks = list(PAGE_MARK.finditer(text))
    if not marks:
        return [text]
    pieces = []
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        pieces.append(text[m.start():end].strip())
    return [p for p in pieces if p]


def _split_long(piece: str, max_chars: int) -> list[str]:
    """Break one oversized page into line-aligned parts."""
    if len(piece) <= max_chars:
        return [piece]
    out, cur = [], ""
    for line in piece.splitlines(keepends=True):
        if cur and len(cur) + len(line) > max_chars:
            out.append(cur)
            cur = ""
        cur += line
    if cur.strip():
        out.append(cur)
    return out


def make_chunks(text: str, max_chars: int) -> list[str]:
    """Group consecutive pages into chunks of at most ~max_chars characters."""
    chunks, cur = [], ""
    for page in (part for piece in split_pages(text) for part in _split_long(piece, max_chars)):
        if cur and len(cur) + len(page) + 2 > max_chars:
            chunks.append(cur)
            cur = ""
        cur = f"{cur}\n\n{page}" if cur else page
    if cur.strip():
        chunks.append(cur)
    return chunks or [text]


def _key(section: str, it) -> str:
    low = lambda v: (v or "").strip().lower()  # noqa: E731
    if section == "lab_results":
        return "|".join((normalize_test_name(it.test_name), low(it.value), low(it.unit), low(it.reference_range)))
    if section == "medications":
        return "|".join((low(it.name), low(it.strength), low(it.dosage), low(it.frequency)))
    if section == "conditions":
        return low(it.description)
    if section == "procedures":
        return f"{low(it.name)}|{low(it.date)}"
    if section == "follow_ups":
        return f"{low(it.instruction)}|{low(it.date)}"
    return low(it.text)


def merge(results: list[LLMExtraction]) -> LLMExtraction:
    """Combine chunk results: document fields from the best/first chunk, lists concatenated and de-duplicated."""
    first = results[0]
    typed = [r for r in results if r.document_type != "other"] or results
    best = max(typed, key=lambda r: CONF_RANK[r.classification_confidence])
    merged = {
        "document_type": best.document_type,
        "classification_confidence": best.classification_confidence,
        "document_date": next((r.document_date for r in results if r.document_date), None),
        "facility": next((r.facility for r in results if r.facility), None),
        "clinician": next((r.clinician for r in results if r.clinician), None),
    }
    for section in ("lab_results", "medications", "conditions", "procedures", "follow_ups", "findings"):
        seen, items = set(), []
        for r in results:
            for it in getattr(r, section):
                k = _key(section, it)
                if k not in seen:
                    seen.add(k)
                    items.append(it)
        merged[section] = items
    del first
    return LLMExtraction.model_validate({k: ([i.model_dump() for i in v] if isinstance(v, list) else v) for k, v in merged.items()})


def _extract_one(text: str, filename: str, part: tuple[int, int] | None, depth: int = 0) -> tuple[LLMExtraction, str]:
    try:
        raw, model = chat_json(EXTRACTION_SYSTEM, extraction_user(text, filename, part), "medical_document_extraction",
                               LLM_EXTRACTION_JSON_SCHEMA, max_tokens=6000, max_wait=90)
        return LLMExtraction.model_validate(raw), model
    except LLMError as e:
        # The answer for this chunk was too long: split it in half and extract each half.
        if e.code == "ai_output_too_long" and depth < 2 and len(text) > 800:
            halves = make_chunks(text, max(400, len(text) // 2 + 200))
            if len(halves) == 1:  # single block: cut at a line boundary near the middle
                mid = text.rfind("\n", 0, len(text) // 2) or len(text) // 2
                halves = [text[:mid], text[mid:]]
            log.info("chunk too long for one answer; splitting into %d parts", len(halves))
            parts = [_extract_one(h, filename, part, depth + 1) for h in halves]
            return merge([p[0] for p in parts]), parts[0][1]
        raise


def extract_structured(text: str, filename: str, on_progress: Callable[[int, int], None] | None = None) -> tuple[LLMExtraction, str, int]:
    """Returns (merged extraction, model name, number of chunks)."""
    s = get_settings()
    chunks = make_chunks(text[: s.llm_max_input_chars], s.llm_chunk_chars)
    results, model = [], ""
    for i, chunk in enumerate(chunks, 1):
        if on_progress:
            on_progress(i, len(chunks))
        r, model = _extract_one(chunk, filename, (i, len(chunks)) if len(chunks) > 1 else None)
        results.append(r)
    return (results[0] if len(results) == 1 else merge(results)), model, len(chunks)
