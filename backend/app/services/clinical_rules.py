"""Deterministic, model-independent rules for medical values.

Nothing here infers diagnoses. It only parses what is written and compares a
numeric value against the reference range *printed on the same report*.
"""
import re
import unicodedata
from dataclasses import dataclass
from datetime import date

_NUM = r"[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-+]?\d*\.?\d+"


@dataclass(frozen=True)
class ParsedValue:
    number: float | None
    comparator: str | None  # <, >, <=, >=


@dataclass(frozen=True)
class ParsedRange:
    low: float | None
    high: float | None
    low_inclusive: bool = True
    high_inclusive: bool = True


def _to_float(s: str) -> float:
    return float(s.replace(",", ""))


def parse_value(raw: str | None) -> ParsedValue:
    """'11.2' → 11.2; '<0.5' → (0.5,'<'); '1,234' → 1234; 'Positive' → None."""
    if raw is None:
        return ParsedValue(None, None)
    s = unicodedata.normalize("NFKC", str(raw)).strip()
    s = s.replace("≤", "<=").replace("≥", ">=")
    m = re.fullmatch(rf"(<=|>=|<|>)?\s*({_NUM})(?:\s*[A-Za-z%µμ/*][A-Za-z%/µμ^0-9.*\s]*)?", s)
    if not m:
        return ParsedValue(None, None)
    try:
        return ParsedValue(_to_float(m.group(2)), m.group(1))
    except ValueError:
        return ParsedValue(None, None)


def parse_range(raw: str | None) -> ParsedRange | None:
    """Parses '13.0 - 17.0', '13-17 g/dL', '<200', 'Up to 40', '> 40', '0.5 to 1.2'."""
    if not raw:
        return None
    s = unicodedata.normalize("NFKC", str(raw)).strip().lower()
    s = s.replace("≤", "<=").replace("≥", ">=").replace("–", "-").replace("—", "-")
    m = re.search(rf"({_NUM})\s*(?:-|to)\s*({_NUM})", s)
    if m:
        lo, hi = _to_float(m.group(1)), _to_float(m.group(2))
        if lo > hi:
            return None
        return ParsedRange(lo, hi)
    m = re.search(rf"(<=|<|up to|upto|less than|below)\s*({_NUM})", s)
    if m:
        return ParsedRange(None, _to_float(m.group(2)), high_inclusive=m.group(1) not in ("<", "less than", "below"))
    m = re.search(rf"(>=|>|more than|greater than|above)\s*({_NUM})", s)
    if m:
        return ParsedRange(_to_float(m.group(2)), None, low_inclusive=m.group(1) == ">=")
    return None


def interpret(value: ParsedValue, rng: ParsedRange | None) -> str:
    """within_range | above_range | below_range | unverified (never a clinical judgement)."""
    if value.number is None or rng is None or value.comparator is not None:
        return "unverified"
    v = value.number
    if rng.low is not None and (v < rng.low or (v == rng.low and not rng.low_inclusive)):
        return "below_range"
    if rng.high is not None and (v > rng.high or (v == rng.high and not rng.high_inclusive)):
        return "above_range"
    return "within_range"


# ----------------------------------------------------------------------------- units
_UNIT_ALIASES = {
    "mg/dl": "mg/dL", "g/dl": "g/dL", "gm/dl": "g/dL", "gms/dl": "g/dL", "gm%": "g/dL", "g%": "g/dL",
    "mmol/l": "mmol/L", "umol/l": "µmol/L", "µmol/l": "µmol/L", "μmol/l": "µmol/L",
    "iu/l": "IU/L", "u/l": "U/L", "miu/l": "mIU/L", "uiu/ml": "µIU/mL", "µiu/ml": "µIU/mL", "μiu/ml": "µIU/mL",
    "ng/ml": "ng/mL", "pg/ml": "pg/mL", "ng/dl": "ng/dL", "mg/l": "mg/L", "meq/l": "mEq/L",
    "%": "%", "fl": "fL", "pg": "pg", "mm/hr": "mm/h", "mm/h": "mm/h", "mm/1st hr": "mm/h",
    "cells/cumm": "cells/µL", "/cumm": "cells/µL", "cells/µl": "cells/µL", "cells/ul": "cells/µL", "/µl": "cells/µL",
    "10^3/µl": "10^3/µL", "10^3/ul": "10^3/µL", "x10^3/µl": "10^3/µL", "thou/cumm": "10^3/µL", "10³/µl": "10^3/µL",
    "10^6/µl": "10^6/µL", "10^6/ul": "10^6/µL", "mill/cumm": "10^6/µL", "million/cumm": "10^6/µL",
    "lakhs/cumm": "10^5/µL", "lakh/cumm": "10^5/µL",
    "mmhg": "mmHg", "bpm": "bpm", "kg": "kg", "cm": "cm", "kg/m2": "kg/m²", "kg/m²": "kg/m²",
}


def normalize_unit(unit: str | None) -> str | None:
    if not unit:
        return None
    u = unicodedata.normalize("NFKC", unit).strip().replace(" ", "")
    return _UNIT_ALIASES.get(u.lower(), u)


def units_compatible(a: str | None, b: str | None) -> bool:
    """Only identical normalized units are comparable. We never auto-convert."""
    return normalize_unit(a) is not None and normalize_unit(a) == normalize_unit(b)


# ----------------------------------------------------------------------------- names
_NAME_ALIASES = {
    "hb": "hemoglobin", "hgb": "hemoglobin", "haemoglobin": "hemoglobin",
    "fbs": "fasting glucose", "fasting blood sugar": "fasting glucose", "glucose fasting": "fasting glucose",
    "fasting plasma glucose": "fasting glucose", "blood sugar fasting": "fasting glucose",
    "ppbs": "postprandial glucose", "post prandial blood sugar": "postprandial glucose",
    "hba1c": "hba1c", "glycated hemoglobin": "hba1c", "glycosylated hemoglobin": "hba1c",
    "tsh": "tsh", "thyroid stimulating hormone": "tsh",
    "ldl": "ldl cholesterol", "ldl-c": "ldl cholesterol", "hdl": "hdl cholesterol", "hdl-c": "hdl cholesterol",
    "total cholesterol": "total cholesterol", "cholesterol total": "total cholesterol", "serum cholesterol": "total cholesterol",
    "tg": "triglycerides", "triglyceride": "triglycerides",
    "wbc": "total leucocyte count", "tlc": "total leucocyte count", "total wbc count": "total leucocyte count",
    "plt": "platelet count", "platelets": "platelet count",
    "sgpt": "alt", "alt (sgpt)": "alt", "sgot": "ast", "ast (sgot)": "ast",
    "s. creatinine": "creatinine", "serum creatinine": "creatinine",
    "vit d": "vitamin d", "25-oh vitamin d": "vitamin d", "vitamin d3": "vitamin d", "vitamin b12": "vitamin b12",
}


def normalize_test_name(name: str) -> str:
    n = unicodedata.normalize("NFKC", name).lower().strip()
    n = re.sub(r"[\s_]+", " ", n)
    n = re.sub(r"[,:;]+$", "", n).strip()
    if n in _NAME_ALIASES:
        return _NAME_ALIASES[n]
    stripped = re.sub(r"\s*\((?:serum|plasma|blood|whole blood)\)$", "", n)
    stripped = re.sub(r"^(serum|plasma|s\.)\s+", "", stripped)
    return _NAME_ALIASES.get(stripped, stripped)


# ----------------------------------------------------------------------------- provenance
def _squash(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower()
    return re.sub(r"[^a-z0-9.]+", "", s)


def appears_in(snippet: str | None, source_text: str) -> bool:
    """True when the snippet occurs in the document text (whitespace/punctuation-insensitive)."""
    if not snippet:
        return False
    sq = _squash(snippet)
    return bool(sq) and sq in _squash(source_text)


def value_in_snippet(value: str | None, snippet: str | None) -> bool:
    if not value or not snippet:
        return False
    pv = parse_value(value)
    if pv.number is not None:
        nums = [_to_float(x) for x in re.findall(_NUM, unicodedata.normalize("NFKC", snippet).replace(" ", " "))
                if x not in ("-", "+", ".")]
        return any(abs(n - pv.number) < 1e-9 for n in nums)
    return _squash(value) in _squash(snippet)


def parse_iso_date(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        d = date.fromisoformat(raw.strip()[:10])
    except ValueError:
        return None
    if d.year < 1900:
        return None
    return d
