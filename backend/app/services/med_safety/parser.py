"""Deterministic parser for TYPED prescriptions + plain-language decoding of the abbreviations.

No LLM: the same text always gives the same result, and nothing is invented. A line that cannot be understood is
reported back instead of being guessed.
"""
import re
import unicodedata

from .dose import doses_per_day

_FORMS = {"tab", "tabs", "tablet", "tablets", "t", "cap", "caps", "capsule", "capsules", "c", "syp", "syrup", "inj",
          "injection", "drops", "oint", "ointment", "cream", "gel", "susp", "suspension"}
_NOISE = {"for", "x", "daily", "per", "orally", "po", "rx", "take", "the", "a", "and", "of", "then"}

_DURATION = re.compile(r"(?:\bfor\s+|\bx\s*)?(\d{1,3})\s*(days?|weeks?|wks?|months?)\b|\bx\s*(\d{1,3})\s*d\b", re.I)
_SCHEDULE = re.compile(r"(?<![\d/.])(\d)\s*-\s*(\d)\s*-\s*(\d)(?:\s*-\s*(\d))?(?![\d/.])")
_FREQ_WORD = re.compile(
    r"\b(od|qd|bd|bid|tds|tid|qid|qds|hs|sos|prn|stat|nocte|q\s?\d{1,2}\s?h|"
    r"once\s+(?:a\s+)?(?:daily|day)|twice\s+(?:a\s+)?(?:daily|day)|thrice\s+(?:a\s+)?(?:daily|day)|"
    r"three\s+times\s+(?:a\s+)?(?:daily|day)|four\s+times\s+(?:a\s+)?(?:daily|day)|"
    r"at\s+(?:bed\s?time|night)|as\s+needed|when\s+required|if\s+needed|"
    r"every\s+\d{1,2}\s*(?:hours?|hrs?|h))\b", re.I)
_TIMING = re.compile(r"\b(ac|pc|before\s+(?:meals?|food)|after\s+(?:meals?|food)|with\s+(?:meals?|food)|empty\s+stomach)\b", re.I)
_DOSE = re.compile(r"\b(\d+(?:/\d+)?|half|one|two)\s*(tab(?:let)?s?|cap(?:sule)?s?|ml|drops?|puffs?|sachets?)\b", re.I)
_STRENGTH = re.compile(r"(\d+(?:\.\d+)?(?:\s*/\s*\d+(?:\.\d+)?)*)\s*(mg|mcg|µg|μg|g|ml|iu)\b", re.I)
_NUMBERING = re.compile(r"^\s*(?:\d{1,2}\s*[.)\]:-]|[-•*>])\s*")

# frequency code (lower-case) → (meaning key, doses per day or None)
_FREQ_MEANING = {
    "od": "once_daily", "qd": "once_daily", "once daily": "once_daily", "once a day": "once_daily", "once day": "once_daily",
    "bd": "twice_daily", "bid": "twice_daily", "twice daily": "twice_daily", "twice a day": "twice_daily",
    "tds": "three_times_daily", "tid": "three_times_daily", "thrice daily": "three_times_daily", "thrice a day": "three_times_daily",
    "three times daily": "three_times_daily", "three times a day": "three_times_daily",
    "qid": "four_times_daily", "qds": "four_times_daily", "four times daily": "four_times_daily", "four times a day": "four_times_daily",
    "hs": "at_bedtime", "nocte": "at_bedtime", "at bedtime": "at_bedtime", "at bed time": "at_bedtime", "at night": "at_bedtime",
    "sos": "as_needed", "prn": "as_needed", "as needed": "as_needed", "when required": "as_needed", "if needed": "as_needed",
    "stat": "single_dose_now",
}
_TIMING_MEANING = {"ac": "before_food", "before meal": "before_food", "before meals": "before_food", "before food": "before_food",
                   "pc": "after_food", "after meal": "after_food", "after meals": "after_food", "after food": "after_food",
                   "with meal": "with_food", "with meals": "with_food", "with food": "with_food", "empty stomach": "empty_stomach"}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s)).strip()


def decode_frequency(code: str | None) -> dict | None:
    """Plain-language meaning of a frequency abbreviation. `meaning` is a key the UI translates."""
    if not code:
        return None
    c = _norm(code).lower()
    m = _SCHEDULE.fullmatch(c)
    if m:
        slots = [int(x) for x in m.groups() if x is not None]
        per_day = doses_per_day(c)
        return {"code": code.upper(), "meaning": "schedule", "slots": slots, "per_day": per_day}
    qh = re.fullmatch(r"q\s?(\d{1,2})\s?h", c) or re.fullmatch(r"every\s+(\d{1,2})\s*(?:hours?|hrs?|h)", c)
    if qh:
        return {"code": code.upper(), "meaning": "every_n_hours", "hours": int(qh.group(1)),
                "per_day": doses_per_day(f"every {qh.group(1)} hours")}
    key = re.sub(r"\s+", " ", c)
    meaning = _FREQ_MEANING.get(key)
    if meaning:
        return {"code": code.upper() if len(c) <= 4 else code, "meaning": meaning, "per_day": doses_per_day(c)}
    return {"code": code, "meaning": "unclear", "per_day": None}


def decode_timing(code: str | None) -> dict | None:
    if not code:
        return None
    key = re.sub(r"\s+", " ", _norm(code).lower())
    return {"code": code.upper() if len(key) <= 2 else code, "meaning": _TIMING_MEANING.get(key, "unclear")}


def parse_line(raw: str) -> dict | None:
    """One prescription line → fields, or None when there is no medicine name."""
    s = _norm(_NUMBERING.sub("", raw))
    if not re.search(r"[A-Za-z]", s):
        return None
    out: dict[str, str | None] = {"strength": None, "dosage": None, "frequency": None, "timing": None, "duration": None}

    def take(pattern: re.Pattern, field: str, fmt=lambda m: m.group(0)):
        nonlocal s
        m = pattern.search(s)
        if m:
            out[field] = _norm(fmt(m))
            s = _norm(s[:m.start()] + " " + s[m.end():])

    take(_DURATION, "duration", lambda m: f"{m.group(1) or m.group(3)} {(m.group(2) or 'days').lower()}")
    take(_SCHEDULE, "frequency")
    if out["frequency"] is None:
        take(_FREQ_WORD, "frequency")
    take(_TIMING, "timing")
    # A second frequency/timing word ("OD HS", "AC, empty stomach") is not part of the medicine name.
    s = _norm(_TIMING.sub(" ", _FREQ_WORD.sub(" ", s)))
    take(_DOSE, "dosage", lambda m: f"{m.group(1)} {m.group(2).lower()}")
    take(_STRENGTH, "strength", lambda m: f"{re.sub(r'\s+', '', m.group(1))} {m.group(2).lower().replace('µg', 'mcg').replace('μg', 'mcg')}")

    words = [w for w in re.split(r"\s+", s.replace(",", " ").replace(";", " ")) if w]
    while words and words[0].lower().rstrip(".") in _FORMS:  # "Tab", "Cap.", "Syp"
        words.pop(0)
    words = [w for w in words if w.lower().strip(".:") not in _NOISE]
    name = _norm(" ".join(words)).strip(" -.:,")
    if not name or not re.search(r"[A-Za-z]{2}", name):
        return None
    return {"name": name, **out}


def parse_prescription(text: str, max_medicines: int = 30) -> dict:
    """Typed prescription → {"medicines": [...], "skipped": [raw lines that could not be read]}."""
    meds, skipped = [], []
    for raw in re.split(r"[\r\n]+", text or ""):
        line = raw.strip()
        if not line or line.lower().rstrip(":. ") in {"rx", "℞", "prescription"}:
            continue
        p = parse_line(line)
        if p is None:
            skipped.append(line[:120])
            continue
        if len(meds) >= max_medicines:
            skipped.append(line[:120])
            continue
        meds.append({"key": f"m{len(meds) + 1}", "raw": line[:200], **p,
                     "frequency_info": decode_frequency(p["frequency"]), "timing_info": decode_timing(p["timing"])})
    return {"medicines": meds, "skipped": skipped}
