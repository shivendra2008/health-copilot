"""Conservative parsing of dose instructions. Returns None whenever the text is not clearly understood —
callers must then report 'insufficient information' rather than assume."""
import re
import unicodedata

_UNITS = r"(?:tab(?:let)?s?|cap(?:sule)?s?)"
_FREQ_WORDS = {
    "od": 1, "qd": 1, "o.d": 1, "once daily": 1, "once a day": 1, "once": 1,
    "bd": 2, "bid": 2, "b.d": 2, "twice daily": 2, "twice a day": 2, "twice": 2,
    "tds": 3, "tid": 3, "t.d.s": 3, "thrice daily": 3, "thrice a day": 3, "three times a day": 3, "three times daily": 3,
    "qid": 4, "qds": 4, "four times a day": 4, "four times daily": 4,
}


def _clean(s: str | None) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s or "")).strip().lower()


def units_per_dose(dosage: str | None) -> int | None:
    """'1 tablet' / '2 tabs' / '1' → count. Fractions, ranges, ml, 'as directed' → None."""
    s = _clean(dosage)
    m = re.fullmatch(rf"(\d+)\s*(?:x\s*)?(?:{_UNITS})?", s)
    if not m:
        return None
    n = int(m.group(1))
    return n if 1 <= n <= 10 else None


def doses_per_day(frequency: str | None) -> int | None:
    s = _clean(frequency)
    if not s or re.search(r"\b(sos|prn|as needed|as required|when required|alternate|weekly|week)\b", s):
        return None
    if s in _FREQ_WORDS:
        return _FREQ_WORDS[s]
    m = re.fullmatch(r"(\d)-(\d)-(\d)(?:-(\d))?", s)  # Indian "1-0-1" schedules (doses per slot)
    if m:
        parts = [int(x) for x in m.groups() if x is not None]
        return sum(parts) if all(p <= 3 for p in parts) and sum(parts) > 0 else None
    m = re.fullmatch(r"(\d{1,2}) times? (?:a|per) day|(\d{1,2}) times? daily", s)
    if m:
        n = int(m.group(1) or m.group(2))
        return n if 1 <= n <= 8 else None
    m = re.fullmatch(r"(?:every|q) ?(\d{1,2}) ?(?:hours?|hrly|hr|h)|(\d{1,2}) ?hourly", s)
    if m:
        h = int(m.group(1) or m.group(2))
        return 24 // h if h in (4, 6, 8, 12, 24) else None
    return None
