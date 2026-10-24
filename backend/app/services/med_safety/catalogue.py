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


# ----------------------------------------------------------------------------- brand verification
# `resolve()` decides what the safety engine may USE. `verify()` explains how much we know about a brand and, when
# there is real evidence, suggests a likely composition with an explicit confidence. A suggestion is information for
# the person to check: it is never applied to the checks automatically, and a brand with no evidence is "unverified".
CONF_ORDER = {"high": 0, "medium": 1, "low": 2, "none": 3}
BASIS_ORDER = {"local_dataset": 0, "written_in_prescription": 1, "catalogue_name_match": 2, "spelling_similarity": 3}
_RESOLVED = {"resolved", "user_selected"}


@lru_cache
def brand_dataset() -> dict:
    """Optional curated brand→composition list (data/brand_evidence.json). Not shipped by default: add one with a
    citable source and its entries are used as the strongest evidence. Entries that cite no source are ignored."""
    f = DATA / "brand_evidence.json"
    if not f.exists():
        return {"label": None, "index": {}}
    raw = json.loads(f.read_text(encoding="utf-8"))
    index: dict[str, dict] = {}
    for b in raw.get("brands", []):
        if not (b.get("source") or {}).get("citation") or not b.get("ingredients"):
            continue
        for a in b.get("aliases", []):
            index.setdefault(normalize_name(a), b)
    return {"label": raw.get("label"), "index": index}


def _comp(ingredients: list[dict]) -> list[dict]:
    cat = catalogue()["ingredients"]
    return [{"id": i.get("id"), "name": i.get("name") or cat.get(i.get("id") or "", {}).get("name") or i.get("id"),
             "strength": i.get("strength")} for i in ingredients]


@lru_cache
def _ingredient_aliases() -> dict[str, str]:
    """normalised ingredient name/alias → ingredient id, from the single-ingredient generics in the catalogue."""
    out: dict[str, str] = {}
    cat = catalogue()
    for iid, ing in cat["ingredients"].items():
        out.setdefault(normalize_name(ing["name"]), iid)
    for e in cat["entries"]:
        if e["kind"] == "generic" and len(e["ingredients"]) == 1:
            for a in e["aliases"]:
                out.setdefault(normalize_name(a), e["ingredients"][0]["id"])
    return {a: i for a, i in out.items() if len(a) >= 4}  # short aliases ("pcm") are too easy to hit by accident


def composition_in_text(raw: str | None, name: str | None) -> list[dict]:
    """Ingredients the prescription itself spells out next to the brand, e.g. 'Tab Zyxotab (Rabeprazole 20 mg)'.
    The brand's own name is removed first so a brand that merely contains an ingredient name is not counted."""
    if not raw:
        return []
    text = normalize_name(raw.replace(name or "", " ", 1) if name else raw)
    cat = catalogue()["ingredients"]
    found: dict[str, dict] = {}
    for alias, iid in sorted(_ingredient_aliases().items(), key=lambda kv: -len(kv[0])):
        m = re.search(rf"(?<![a-z]){re.escape(alias)}(?![a-z])\s*\(?\s*(\d+(?:\.\d+)?)?\s*(mg|mcg|g)?", text)
        if m and iid not in found:
            st = {"value": float(m.group(1)), "unit": m.group(2)} if m.group(1) and m.group(2) else None
            found[iid] = {"id": iid, "name": cat[iid]["name"], "strength": st}
    return list(found.values())


def _best_similarity(q: str, entry: dict) -> float:
    names = [normalize_name(a) for a in entry["aliases"]] + [normalize_name(entry["name"])]
    return max(difflib.SequenceMatcher(None, q, n).ratio() for n in names)


def verify(name: str | None, strength: str | None, raw: str | None, resolution: dict) -> dict:
    """How much do we know about this medicine name?
    state: verified (matched to the catalogue) | suggested (evidence for a likely composition) | unverified (none).
    Every suggestion carries its own confidence (high | medium | low) and the basis it rests on."""
    status = resolution["status"]
    if status in _RESOLVED:
        entry = entry_brief(resolution["catalogue_id"]) if resolution.get("catalogue_id") else None
        return {"state": "verified", "confidence": resolution["confidence"],
                "basis": "user_confirmed" if status == "user_selected" else "catalogue_match",
                "composition": _comp(entry["ingredients"]) if entry else [], "suggestions": []}
    if status == "user_unresolved":
        return {"state": "unverified", "confidence": "none", "basis": "skipped_by_user", "composition": [], "suggestions": []}

    q = normalize_name(name)
    sugg: list[dict] = []
    ds = brand_dataset()
    hit = ds["index"].get(q)
    if hit:
        sugg.append({"basis": "local_dataset", "confidence": hit.get("confidence", "medium"), "composition": _comp(hit["ingredients"]),
                     "source": {"label": ds["label"], **hit["source"]}})
    written = composition_in_text(raw, name)
    if written:
        complete = all(w["strength"] for w in written)
        sugg.append({"basis": "written_in_prescription", "confidence": "medium" if complete else "low", "composition": written,
                     "source": {"citation": "Written next to the brand on the prescription"}})
    for c in resolution.get("candidates", []):
        entry = catalogue()["by_id"].get(c["id"])
        if not entry:
            continue
        if resolution.get("reason") == "no_exact_match_suggestions":
            sim = round(_best_similarity(q, entry), 2)
            sugg.append({"basis": "spelling_similarity", "confidence": "medium" if sim >= 0.92 else "low", "similarity": sim,
                         "catalogue_id": c["id"], "name": c["name"], "composition": _comp(c["ingredients"])})
        else:  # the name matches exactly but the strength/variant is unclear
            sugg.append({"basis": "catalogue_name_match", "confidence": "medium", "catalogue_id": c["id"], "name": c["name"],
                         "composition": _comp(c["ingredients"])})
    sugg.sort(key=lambda s: (CONF_ORDER[s["confidence"]], BASIS_ORDER[s["basis"]], -s.get("similarity", 0)))
    if not sugg:
        return {"state": "unverified", "confidence": "none", "basis": "no_evidence", "composition": [], "suggestions": []}
    return {"state": "suggested", "confidence": sugg[0]["confidence"], "basis": sugg[0]["basis"],
            "composition": sugg[0]["composition"], "suggestions": sugg[:4]}
