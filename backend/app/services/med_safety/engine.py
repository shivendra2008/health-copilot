"""Deterministic medication-safety engine. No LLM, no network, no database: a pure function of
(confirmed medicines, patient context, versioned catalogue, versioned ruleset)."""
import json
from functools import lru_cache
from itertools import combinations

from .catalogue import DATA, catalogue, entry_brief, parse_strength
from .dose import doses_per_day, units_per_dose

SEVERITY_ORDER = {"critical": 0, "high": 1, "moderate": 2, "low": 3, "info": 4}
RESOLVED_STATUSES = {"resolved", "user_selected"}


@lru_cache
def ruleset() -> dict:
    return json.loads((DATA / "ruleset.json").read_text(encoding="utf-8"))


def _label(m: dict) -> str:
    st = m.get("strength")
    return " ".join(x for x in (m["name"], st if st and st.lower() not in m["name"].lower() else None) if x)


def _ref(m: dict) -> dict:
    return {"id": m["id"], "label": _label(m)}


def _evidence(rule: dict, **extra) -> dict:
    return {"rule_id": rule["id"], "source": rule["source"], "review_status": rule["review_status"],
            "curated_on": rule.get("curated_on", ruleset()["curated_on"]),
            "ruleset_version": ruleset()["version"], **extra}


def _side_matches(ingredients: set[str], classes: set[str], side: dict) -> set[str]:
    hit = set(ingredients & set(side.get("ingredients", [])))
    if side.get("classes"):
        cat = catalogue()["ingredients"]
        hit |= {i for i in ingredients if set(cat[i]["classes"]) & set(side["classes"])}
    return hit


def _finding(fid: str, ftype: str, severity: str, status: str, meds: list[dict], title: str, explanation: str,
             evidence: dict | None, next_step: str = "consult_clinician") -> dict:
    return {"id": fid, "type": ftype, "severity": severity, "status": status, "medicines": [_ref(m) for m in meds],
            "title": title, "explanation": explanation, "evidence": evidence, "next_step": next_step}


def run_check(meds: list[dict], patient: dict | None = None) -> dict:
    """meds: confirmed medicine dicts (id, name, strength, dosage, frequency, uncertain_fields, catalogue_id,
    resolution_status). patient: {'adult': bool | None}."""
    cat, rules, patient = catalogue(), ruleset(), patient or {}
    findings: list[dict] = []
    unresolved: list[dict] = []
    missing: list[dict] = []
    resolved: list[tuple[dict, dict, set[str]]] = []  # (med, catalogue entry, ingredient ids)

    for m in meds:
        uncertain = set(m.get("uncertain_fields") or [])
        entry = cat["by_id"].get(m.get("catalogue_id") or "")
        if "name" in uncertain:
            reason = "marked_uncertain"
        elif m.get("resolution_status") not in RESOLVED_STATUSES:
            reason = {"ambiguous": "ambiguous", "user_unresolved": "marked_unresolved"}.get(m.get("resolution_status"), "not_in_catalogue")
        elif entry is None:
            reason = "catalogue_changed"
        else:
            resolved.append((m, entry, {i["id"] for i in entry["ingredients"]}))
            continue
        unresolved.append({"medicine": _ref(m), "reason": reason})
        findings.append(_finding(
            f"unresolved:{m['id']}", "unresolved_medicine", "info", "needs_confirmation", [m],
            f"Could not verify ingredients for {m['name']}",
            "This medicine is not matched to a verified catalogue entry, so duplicate and interaction checks "
            "could not include it. No conclusion is drawn about it.",
            None, "confirm_medicine"))

    # --- duplicate active ingredient -------------------------------------------------------------
    dup = rules["duplicate_ingredient"]
    by_ing: dict[str, list[dict]] = {}
    for m, _, ings in resolved:
        for i in ings:
            by_ing.setdefault(i, []).append(m)
    for ing, ms in sorted(by_ing.items()):
        if len(ms) >= 2:
            name = cat["ingredients"][ing]["name"]
            findings.append(_finding(
                f"dup:{ing}", "duplicate_ingredient", dup["severity_overrides"].get(ing, dup["default_severity"]),
                "potential_issue", ms, f"{name} appears in more than one listed medicine",
                f"{len(ms)} of the listed medicines contain {name}. Taking them together may add up to more "
                f"{name} than intended. This could also be the same medicine listed twice.",
                _evidence(dup, matched_ingredients=[ing])))

    # --- same-class duplication (different ingredients) ---------------------------------------------
    for r in rules["class_duplicates"]:
        members = []
        for m, _, ings in resolved:
            hit = {i for i in ings if r["class"] in cat["ingredients"][i]["classes"]}
            if hit:
                members.append((m, hit))
        distinct = set().union(*[h for _, h in members]) if members else set()
        if len(members) >= 2 and len(distinct) >= 2:
            findings.append(_finding(f"class:{r['id']}", "therapeutic_duplicate", r["severity"], "potential_issue",
                                     [m for m, _ in members], r["title"], r["explanation"],
                                     _evidence(r, matched_ingredients=sorted(distinct))))

    # --- curated interactions -----------------------------------------------------------------------
    seen: set[tuple] = set()
    for r in rules["interactions"]:
        for (ma, _, ia), (mb, _, ib) in combinations(resolved, 2):
            for x, ix, y, iy in ((ma, ia, mb, ib), (mb, ib, ma, ia)):
                ha, hb = _side_matches(ix, set(), r["a"]), _side_matches(iy, set(), r["b"])
                if ha and hb and (r["id"], frozenset((x["id"], y["id"]))) not in seen:
                    seen.add((r["id"], frozenset((x["id"], y["id"]))))
                    findings.append(_finding(f"int:{r['id']}:{x['id']}:{y['id']}", "interaction", r["severity"],
                                             "potential_issue", [x, y], r["title"], r["explanation"],
                                             _evidence(r, matched_ingredients=sorted(ha | hb))))

    # --- basic dose check (paracetamol daily total), only with complete, reliable inputs ---------------
    for r in rules["dose_rules"]:
        ing = r["ingredient"]
        carriers = [(m, e) for m, e, ings in resolved if ing in ings]
        if not carriers:
            continue
        if patient.get("adult") is not True:
            missing.append({"medicine": None, "missing": ["patient_age"], "reason": "adult_status_needed_for_dose_check"})
            continue
        total, complete = 0.0, True
        for m, e in carriers:
            uncertain = set(m.get("uncertain_fields") or [])
            mg = _ingredient_mg(m, e, ing)
            n, per_day = units_per_dose(m.get("dosage")), doses_per_day(m.get("frequency"))
            gaps = [k for k, v in (("strength", mg), ("dosage", n), ("frequency", per_day)) if v is None]
            gaps += [k for k in ("strength", "dosage", "frequency") if k in uncertain and k not in gaps]
            if gaps:
                complete = False
                missing.append({"medicine": _ref(m), "missing": sorted(set(gaps)), "reason": "needed_for_dose_check"})
                continue
            total += mg * n * per_day
        limit = r["max_daily_mg_adult"]
        if total > limit:
            findings.append(_finding(
                f"dose:{r['id']}", "dose_concern", r["severity"],
                "potential_issue" if complete else "needs_confirmation", [m for m, _ in carriers], r["title"],
                r["explanation"] + ("" if complete else " Some entries were missing details, so the real total may be higher."),
                _evidence(r, computed_daily_mg=round(total), limit_mg=limit, complete=complete)))
        elif not complete:
            findings.append(_finding(
                f"dose:{r['id']}:incomplete", "dose_concern", "info", "needs_confirmation", [m for m, _ in carriers],
                "Daily paracetamol total could not be checked",
                "Strength, dose or how often it is taken is missing or unclear for at least one paracetamol-containing "
                "medicine, so the daily total was not calculated.", _evidence(r, complete=False), "complete_details"))

    # --- other missing details (informational) --------------------------------------------------------
    have = {x["medicine"]["id"] for x in missing if x["medicine"]}
    for m, _, _ in resolved:
        gaps = [k for k in ("strength", "dosage", "frequency") if not m.get(k)]
        if gaps and m["id"] not in have:
            missing.append({"medicine": _ref(m), "missing": gaps, "reason": "incomplete_details"})

    findings.sort(key=lambda f: (SEVERITY_ORDER[f["severity"]], f["status"] != "potential_issue", f["title"]))
    counts = {k: sum(1 for f in findings if f["severity"] == k) for k in SEVERITY_ORDER}
    return {
        "findings": findings, "unresolved": unresolved, "missing_information": missing,
        "limitations": rules["limitations"],
        "summary": {"total_findings": len(findings), "by_severity": counts,
                    "medicines_checked": len(resolved), "medicines_unresolved": len(unresolved)},
        "ruleset_version": rules["version"], "catalogue_version": cat["version"],
    }


def _ingredient_mg(m: dict, entry: dict, ing: str) -> float | None:
    """Strength of one ingredient in mg: from the catalogue entry when it has one, else from the user's
    confirmed strength (only for single-ingredient generics, only in mg — units are never converted)."""
    for i in entry["ingredients"]:
        if i["id"] == ing and i["strength"]:
            return float(i["strength"]["value"]) if i["strength"]["unit"] == "mg" else None
    if len(entry["ingredients"]) == 1 and "strength" not in set(m.get("uncertain_fields") or []):
        st = parse_strength(m.get("strength"))
        if st and st[1] == "mg":
            return st[0]
    return None


__all__ = ["run_check", "ruleset", "entry_brief"]
