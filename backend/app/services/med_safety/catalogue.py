"""Curated medicine catalogue + brand resolution.

Resolution NEVER guesses: an ingredient list is only attached to a medicine when its name (and strength,
when given) matches a catalogue entry, or the user explicitly picked one. Everything else is
`ambiguous` (user must choose) or `unresolved`.
"""
import difflib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).parent / "data"
_FORM_WORDS = {"tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules", "ip", "bp", "usp"}
_STRENGTH = re.compile(r"(\d+(?:\.\d+)?)\s*(mg|mcg|µg|μg|ug|g)\b", re.I)


@lru_cache
def catalogue() -> dict:
    data = json.loads((DATA / "catalogue.json").read_text(encoding="utf-8"))
    data["by_id"] = {e["id"]: e for e in data["entries"]}
    index: dict[str, list[str]] = {}
    for e in data["entries"]:
        for a in e["aliases"]:
            index.setdefault(normalize_name(a), []).append(e["id"])
    data["alias_index"] = index
    return data


def normalize_name(s: str | None) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = re.sub(r"[^a-z0-9.+ ]+", " ", s.replace("+", " ").replace("-", " "))
    words = [w for w in s.split() if w not in _FORM_WORDS and w not in {"and"}]
    return " ".join(words)


def parse_strength(s: str | None) -> tuple[float, str] | None:
    """'650 mg' → (650.0, 'mg'). Units are never converted: 0.5 g is not treated as 500 mg."""
    if not s:
        return None
    m = _STRENGTH.search(unicodedata.normalize("NFKC", s))
    if not m:
        return None
    unit = m.group(2).lower().replace("µg", "mcg").replace("μg", "mcg").replace("ug", "mcg")
    return float(m.group(1)), unit


def _brief(e: dict) -> dict:
    return {"id": e["id"], "name": e["name"], "kind": e["kind"], "form": e["form"],
            "ingredients": [{"id": i["id"], "name": catalogue()["ingredients"][i["id"]]["name"], "strength": i["strength"]}
                            for i in e["ingredients"]]}


def entry_brief(catalogue_id: str) -> dict | None:
    e = catalogue()["by_id"].get(catalogue_id)
    return _brief(e) if e else None


@dataclass
class Resolution:
    status: str  # resolved | ambiguous | unresolved
    catalogue_id: str | None = None
    confidence: str = "none"  # high | medium | low | none
    reason: str = ""
    candidates: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"status": self.status, "catalogue_id": self.catalogue_id, "confidence": self.confidence,
                "reason": self.reason, "candidates": self.candidates}


def _strength_matches(entry: dict, st: tuple[float, str | None]) -> bool:
    value, unit = st
    for ing in entry["ingredients"]:
        s = ing["strength"]
        if s and s["value"] == value and (unit is None or s["unit"] == unit):
            return True
    return False


def _has_strength(entry: dict) -> bool:
    return any(i["strength"] for i in entry["ingredients"])


def resolve(name: str | None, strength: str | None = None) -> Resolution:
    cat = catalogue()
    q = normalize_name(name)
    if not q:
        return Resolution("unresolved", reason="empty_name")
    st: tuple[float, str | None] | None = parse_strength(strength)

    # strength written inside the name, e.g. "Dolo 650mg" → remove it from the lookup text
    in_name = parse_strength(name)
    if in_name:
        q = normalize_name(_STRENGTH.sub(" ", name or ""))
        st = st or in_name

    ids = cat["alias_index"].get(q)
    if not ids:
        m = re.fullmatch(r"(.*?)\s+(\d+(?:\.\d+)?)", q)  # "dolo 650" typed with a brand-number suffix
        if m and m.group(1) in cat["alias_index"]:
            ids = cat["alias_index"][m.group(1)]
            st = st or (float(m.group(2)), None)
            q = m.group(1)
    if not ids:
        near = difflib.get_close_matches(q, list(cat["alias_index"]), n=3, cutoff=0.82)
        sug = list({i: None for a in near for i in cat["alias_index"][a]})
        if sug:
            return Resolution("ambiguous", None, "low", "no_exact_match_suggestions", [_brief(cat["by_id"][i]) for i in sug])
        return Resolution("unresolved", reason="not_in_catalogue")

    entries = [cat["by_id"][i] for i in dict.fromkeys(ids)]
    if st is not None:
        hit = [e for e in entries if not _has_strength(e) or _strength_matches(e, st)]
        if len(hit) == 1:
            e = hit[0]
            return Resolution("resolved", e["id"], "high", "name_and_strength")
        if not hit:
            return Resolution("ambiguous", None, "low", "strength_not_in_catalogue", [_brief(e) for e in entries])
        entries = hit
    if len(entries) == 1:
        e = entries[0]
        # A brand with no strength given: identity is clear, but the exact product variant is not confirmed.
        return Resolution("resolved", e["id"], "high" if e["kind"] == "generic" else "medium", "name_only")
    return Resolution("ambiguous", None, "low", "multiple_matches", [_brief(e) for e in entries])


def search(q: str, limit: int = 10) -> list[dict]:
    cat = catalogue()
    nq = normalize_name(q)
    if len(nq) < 2:
        return []
    scored = []
    for e in cat["entries"]:
        names = [normalize_name(a) for a in e["aliases"]] + [normalize_name(e["name"])]
        if any(n.startswith(nq) for n in names):
            scored.append((0, e))
        elif any(nq in n for n in names):
            scored.append((1, e))
    scored.sort(key=lambda t: (t[0], t[1]["name"]))
    return [_brief(e) for _, e in scored[:limit]]
