"""AI summary generation, grounded in the validated structured data only."""
from datetime import datetime, timezone

from ..schemas.extraction import ExtractionData, LLMSummary, LLM_SUMMARY_JSON_SCHEMA
from .clinical_rules import interpret, parse_range, parse_value
from .groq_client import chat_json
from .prompts import LANG_NAMES, SUMMARY_SYSTEM, summary_user


def derived_comparisons(data: ExtractionData) -> list[dict]:
    """Deterministic: each numeric lab value vs. the reference range printed on the report."""
    out = []
    for it in data.lab_results:
        pv, rng = parse_value(it.value), parse_range(it.reference_range)
        out.append({
            "key": it.key, "test_name": it.test_name, "value": it.value, "unit": it.unit,
            "reference_range": it.reference_range, "status": interpret(pv, rng),
            "value_num": pv.number if pv.comparator is None else None,
            "ref_low": rng.low if rng else None, "ref_high": rng.high if rng else None,
        })
    return out


def _compact(data: ExtractionData) -> dict:
    d = data.model_dump(exclude={"classification_confidence"})
    for section in ("lab_results", "medications", "conditions", "procedures", "follow_ups", "findings"):
        for item in d[section]:
            for k in ("key", "origin", "user_corrected", "source_text", "confidence"):
                item.pop(k, None)
    return d


def generate_summary(data: ExtractionData, language: str = "en", max_wait: float = 60.0) -> dict:
    derived = derived_comparisons(data)
    raw, model = chat_json(
        SUMMARY_SYSTEM.format(language=LANG_NAMES.get(language, "English")),
        summary_user(_compact(data), [{k: v for k, v in d.items() if k not in ("key", "value_num", "ref_low", "ref_high")} for d in derived]),
        "health_summary", LLM_SUMMARY_JSON_SCHEMA, temperature=0.2, max_tokens=2500, max_wait=max_wait,
    )
    summary = LLMSummary.model_validate(raw)
    return {
        **summary.model_dump(),
        "language": language,
        "model": model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
