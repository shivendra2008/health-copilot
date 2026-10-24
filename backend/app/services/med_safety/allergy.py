"""Allergy master list: matching a person's recorded allergies against medicines. Deterministic, no AI.

How an allergy is understood (once, when it is listed or checked):
  class       "penicillins", "NSAIDs"          -> every ingredient in that class
  ingredient  "amoxicillin", "aspirin"         -> that ingredient
  brand       "Augmentin", "Dolo"              -> every ingredient of that brand
  unmatched   anything else ("sulfa", "latex") -> cannot be matched to an ingredient; it is only compared with the
                                                  written medicine name, and the UI says it is not fully checkable

A medicine whose brand is not identified cannot be checked by ingredient. It is compared by name only and reported as
"could not be checked" so nobody reads "no alerts" as "no allergy".
"""
import re

from .catalogue import catalogue, normalize_name

# What people write -> the class id used in the catalogue. Only classes the catalogue actually has.
CLASS_ALIASES = {
    "penicillin": "penicillin", "penicillins": "penicillin", "penicillin antibiotic": "penicillin", "penicillin antibiotics": "penicillin",
    "nsaid": "nsaid", "nsaids": "nsaid", "non steroidal anti inflammatory": "nsaid", "non steroidal anti inflammatory drugs": "nsaid",
    "macrolide": "macrolide", "macrolides": "macrolide", "macrolide antibiotics": "macrolide",
    "statin": "statin", "statins": "statin",
    "salicylate": "salicylate", "salicylates": "salicylate",
    "anticoagulant": "anticoagulant", "anticoagulants": "anticoagulant",
}
# Aspirin is an NSAID in practice even though the interaction rules file it as a salicylate: an NSAID allergy covers it.
CLASS_EXPANSION = {"nsaid": {"nsaid", "salicylate"}}

SEVERITIES = ("mild", "moderate", "severe", "unknown")
MIN_TEXT = 4  # shorter strings are too easy to hit by accident when comparing with names


def resolve_allergen(substance: str) -> dict:
    """{kind, label, ingredients (ids), classes, text}. `kind` is class | ingredient | brand | unmatched."""
    cat = catalogue()
    q = normalize_name(substance)
    out = {"kind": "unmatched", "label": None, "ingredients": set(), "classes": set(), "text": q}
    if q in CLASS_ALIASES:
        classes = CLASS_EXPANSION.get(CLASS_ALIASES[q], {CLASS_ALIASES[q]})
        return {**out, "kind": "class", "label": CLASS_ALIASES[q], "classes": classes,
                "ingredients": {i for i, v in cat["ingredients"].items() if set(v["classes"]) & classes}}
    for iid, v in cat["ingredients"].items():
        if q == normalize_name(v["name"]) or q in {normalize_name(s) for s in v["synonyms"]}:
            return {**out, "kind": "ingredient", "label": v["name"], "ingredients": {iid}}
    ids = cat["alias_index"].get(q)
    if ids:
        entries = [cat["by_id"][i] for i in dict.fromkeys(ids)]
        ings = {i["id"] for e in entries for i in e["ingredients"]}
        kind = "ingredient" if all(e["kind"] == "generic" for e in entries) else "brand"
        return {**out, "kind": kind, "label": entries[0]["name"], "ingredients": ings}
    return out


def prepare(rows: list[dict]) -> list[dict]:
    """Allergy rows (as stored) + how each was understood. This is what the engine receives."""
    prepared = []
    for r in rows:
        res = resolve_allergen(r["substance"])
        prepared.append({"id": r["id"], "substance": r["substance"], "severity": r.get("severity") or "unknown",
                         "reaction": r.get("reaction"), "created_at": r.get("created_at"), "resolved": res})
    return prepared


def describe(prepared: dict) -> dict:
    """What the UI shows about how an allergy is checked."""
    r, names = prepared["resolved"], catalogue()["ingredients"]
    return {"kind": r["kind"], "label": r["label"], "checked_against": sorted(names[i]["name"] for i in r["ingredients"]),
            "fully_checkable": r["kind"] != "unmatched"}


def _name_hit(allergen: dict, med_name: str) -> bool:
    n = normalize_name(med_name)
    keys = {allergen["text"], normalize_name(allergen["label"] or "")} - {""}
    return any(len(k) >= MIN_TEXT and re.search(rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])", n) for k in keys)


def screen(resolved: list[tuple[dict, dict, set[str]]], unresolved: list[dict], allergies: list[dict]) -> dict:
    """resolved: (medicine, catalogue entry, ingredient ids); unresolved: medicines with no verified ingredients.
    Returns {hits: [{allergy, medicine, via, ingredients}], unchecked: [medicine...]}."""
    names = catalogue()["ingredients"]
    hits, seen = [], set()

    def add(a, m, via, ings):
        if (a["id"], m["id"]) not in seen:
            seen.add((a["id"], m["id"]))
            hits.append({"allergy": a, "medicine": m, "via": via, "ingredients": sorted(names[i]["name"] for i in ings)})

    for a in allergies:
        al = a["resolved"]
        for m, _entry, ings in resolved:
            common = ings & al["ingredients"]
            if common:
                add(a, m, "class" if al["kind"] == "class" else "ingredient", common)
            elif _name_hit(al, m["name"]):
                add(a, m, "name_text", set())
        for m in unresolved:
            if _name_hit(al, m["name"]):
                add(a, m, "name_text", set())
    flagged = {h["medicine"]["id"] for h in hits}
    unchecked = [m for m in unresolved if m["id"] not in flagged] if allergies else []
    return {"hits": hits, "unchecked": unchecked}


# ----------------------------------------------------------------------------- database-backed
COLS = "id,substance,severity,reaction,notes,created_at,updated_at"


_NOT_READY = ("PGRST205", "PGRST200", "does not exist", "schema cache")


def load(db, user_id: str) -> list[dict]:
    """The user's allergies, prepared for the engine. A table that does not exist yet (migration not applied) means
    nothing has been recorded. Any OTHER failure is raised: a check must never quietly run without the allergy list."""
    try:
        rows = db.table("allergies").select(COLS).eq("user_id", user_id).order("created_at").limit(200).execute().data
    except Exception as e:  # noqa: BLE001
        if any(t in str(e) for t in _NOT_READY):
            return []
        raise
    return prepare(rows)


def screen_candidate(name: str, ingredient_ids: set[str], ingredient_names: list[str], allergies: list[dict]) -> list[dict]:
    """Allergy hits for a medicine that is only a SUGGESTION (an alternative). Ingredients we know are matched exactly;
    any ingredient name we do not know is compared as text, so an unknown ingredient can still be caught."""
    hits = []
    for a in allergies:
        al = a["resolved"]
        common = ingredient_ids & al["ingredients"]
        if common:
            hits.append({"allergy": a, "via": "class" if al["kind"] == "class" else "ingredient"})
        elif any(_name_hit(al, n) for n in [name, *ingredient_names]):
            hits.append({"allergy": a, "via": "name_text"})
    return hits
