"""Deterministic medication-safety engine. No LLM, no network, no database: a pure function of
(medicines, patient context, versioned catalogue, versioned ruleset)."""
import json
from functools import lru_cache
from itertools import combinations

from .catalogue import DATA, catalogue, entry_brief, parse_strength
from .dose import doses_per_day, units_per_dose

SEVERITY_ORDER = {"critical": 0, "high": 1, "moderate": 2, "low": 3, "info": 4}
TIER = {"critical": "act", "high": "act", "moderate": "know", "low": "fyi", "info": "fyi"}
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


def _side_matches(ingredients: set[str], side: dict) -> set[str]:
    hit = set(ingredients & set(side.get("ingredients", [])))
    if side.get("classes"):
        cat = catalogue()["ingredients"]
        hit |= {i for i in ingredients if set(cat[i]["classes"]) & set(side["classes"])}
    return hit


def _finding(fid: str, ftype: str, severity: str, status: str, meds: list[dict], title: str, explanation: str,
             evidence: dict | None, next_step: str = "consult_clinician") -> dict:
    return {"id": fid, "type": ftype, "severity": severity, "tier": TIER[severity], "status": status,
            "medicines": [_ref(m) for m in meds], "title": title, "explanation": explanation,
            "evidence": evidence, "next_step": next_step}


def patient_context(patient: dict | None) -> dict:
    """Normalise what we know about the patient. Unknown stays unknown: it is never defaulted."""
    p = patient or {}
    age, adult = p.get("age_years"), p.get("adult")
    if adult is None and age is not None:
        adult = age >= 18
    return {"adult": adult, "age_years": age, "weight_kg": p.get("weight_kg"),
            "kidney": p.get("kidney") if p.get("kidney") in ("normal", "reduced") else "unknown"}


def run_check(meds: list[dict], patient: dict | None = None) -> dict:
    """meds: dicts with id, name, strength, dosage, frequency, uncertain_fields, catalogue_id, resolution_status."""
    cat, rules, pt = catalogue(), ruleset(), patient_context(patient)
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
            f"Could not identify {m['name']}",
            "This medicine is not matched to a verified catalogue entry, so duplicate and interaction checks "
            "could not include it. No conclusion is drawn about it.", None, "confirm_medicine"))

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
                ha, hb = _side_matches(ix, r["a"]), _side_matches(iy, r["b"])
                if ha and hb and (r["id"], frozenset((x["id"], y["id"]))) not in seen:
                    seen.add((r["id"], frozenset((x["id"], y["id"]))))
                    findings.append(_finding(f"int:{r['id']}:{x['id']}:{y['id']}", "interaction", r["severity"],
                                             "potential_issue", [x, y], r["title"], r["explanation"],
                                             _evidence(r, matched_ingredients=sorted(ha | hb))))

    # --- patient-specific rules (kidney function) -----------------------------------------------------
    for r in rules["patient_rules"]:
        carriers = [m for m, _, ings in resolved if _side_matches(ings, r)]
        if not carriers:
            continue
        if pt["kidney"] == r["kidney"]:
            findings.append(_finding(f"pat:{r['id']}", "patient_specific", r["severity"], "potential_issue", carriers,
                                     r["title"], r["explanation"], _evidence(r, patient_factor="kidney_function")))
        elif pt["kidney"] == "unknown":
            for m in carriers:
                missing.append({"medicine": _ref(m), "missing": ["kidney_function"], "reason": "kidney_function_matters"})

    # --- daily totals + dose limits that depend on the patient --------------------------------------------
    totals = _daily_totals(resolved)
    asked: set[str] = set()
    for ing, t in totals.items():
        for r in _applicable_dose_rules(ing, pt, missing, asked, [m for m, _, i in resolved if ing in i]):
            limit = r["max_daily_mg"] if "max_daily_mg" in r else r["max_mg_per_kg_day"] * pt["weight_kg"]
            carriers = [m for m, _, ings in resolved if ing in ings]
            ev = dict(ingredient=ing, ingredient_name=cat["ingredients"][ing]["name"], computed_daily_mg=round(t["total_mg"]),
                      limit_mg=round(limit), complete=t["complete"], applies_to=r["applies_to"])
            if "max_mg_per_kg_day" in r:
                ev.update(weight_kg=pt["weight_kg"], mg_per_kg_day=r["max_mg_per_kg_day"])
            if t["total_mg"] > limit:
                findings.append(_finding(
                    f"dose:{r['id']}", "dose_concern", r["severity"],
                    "potential_issue" if t["complete"] else "needs_confirmation", carriers, r["title"],
                    r["explanation"] + ("" if t["complete"] else " Some entries were missing details, so the real total may be higher."),
                    _evidence(r, **ev)))
            elif not t["complete"]:
                findings.append(_finding(
                    f"dose:{r['id']}:incomplete", "dose_concern", "info", "needs_confirmation", carriers,
                    f"Daily {cat['ingredients'][ing]['name']} total could not be fully checked",
                    "Strength, dose or how often it is taken is missing or unclear for at least one medicine containing "
                    f"{cat['ingredients'][ing]['name']}, so the daily total was not fully calculated.",
                    _evidence(r, **ev), "complete_details"))

    # --- other missing details (informational) --------------------------------------------------------
    have = {x["medicine"]["id"] for x in missing if x["medicine"]}
    dose_ings = {r["ingredient"] for r in rules["dose_rules"]}
    for m, entry, ings in resolved:
        brand_has_strength = all(i["strength"] for i in entry["ingredients"])  # e.g. "Dolo 650" already says 650 mg
        gaps = [k for k in ("strength", "dosage", "frequency") if not m.get(k) and not (k == "strength" and brand_has_strength)]
        # a strength that can't be used for the dose maths (e.g. written in grams) is reported, never converted
        if "strength" not in gaps and any(_ingredient_mg(m, entry, i) is None for i in ings & dose_ings):
            gaps.insert(0, "strength")
        if gaps and m["id"] not in have:
            missing.append({"medicine": _ref(m), "missing": gaps, "reason": "incomplete_details"})

    findings.sort(key=lambda f: (SEVERITY_ORDER[f["severity"]], f["status"] != "potential_issue", f["title"]))
    by_sev = {k: sum(1 for f in findings if f["severity"] == k) for k in SEVERITY_ORDER}
    # Unresolved-medicine notices are shown with the identification step, so they don't count as alerts.
    alerts = [f for f in findings if f["type"] != "unresolved_medicine"]
    by_tier = {k: sum(1 for f in alerts if f["tier"] == k) for k in ("act", "know", "fyi")}
    return {
        "findings": findings, "unresolved": unresolved, "missing_information": missing,
        "ingredient_totals": [
            {"ingredient": ing, "name": cat["ingredients"][ing]["name"], "total_mg": round(t["total_mg"]),
             "complete": t["complete"], "parts": t["parts"]} for ing, t in sorted(totals.items())],
        "limitations": rules["limitations"],
        "summary": {"total_findings": len(findings), "by_severity": by_sev, "by_tier": by_tier,
                    "medicines_checked": len(resolved), "medicines_unresolved": len(unresolved)},
        "ruleset_version": rules["version"], "catalogue_version": cat["version"],
        "patient": {"adult": pt["adult"], "age_known": pt["age_years"] is not None, "weight_known": pt["weight_kg"] is not None,
                    "kidney": pt["kidney"]},
    }


def _applicable_dose_rules(ing: str, pt: dict, missing: list[dict], asked: set[str], carriers: list[dict]) -> list[dict]:
    """The dose rule (if any) that fits THIS patient. Unknown age/weight is reported, never assumed."""
    rules = [r for r in ruleset()["dose_rules"] if r["ingredient"] == ing]
    if not rules:
        return []
    by_kind = {r["applies_to"]: r for r in rules}

    def need(what: str):
        if what not in asked:
            asked.add(what)
            missing.append({"medicine": None, "missing": [what], "reason": "needed_for_dose_check"})

    if pt["adult"] is None:
        need("patient_age")
        return []
    if pt["adult"]:
        if pt["weight_kg"] is not None and pt["weight_kg"] < 50 and "adult_under_50kg" in by_kind:
            return [by_kind["adult_under_50kg"]]
        return [by_kind["adult"]] if "adult" in by_kind else []
    if "child" not in by_kind:
        return []  # no reviewed children's limit for this ingredient: say nothing rather than apply an adult limit
    if pt["weight_kg"] is None:
        need("patient_weight")
        return []
    return [by_kind["child"]]


def _daily_totals(resolved: list[tuple[dict, dict, set[str]]]) -> dict[str, dict]:
    """Per ingredient: total mg/day across all medicines that contain it, using only reliable inputs."""
    out: dict[str, dict] = {}
    for m, entry, ings in resolved:
        n, per_day = units_per_dose(m.get("dosage")), doses_per_day(m.get("frequency"))
        uncertain = set(m.get("uncertain_fields") or [])
        for ing in sorted(ings):
            mg = _ingredient_mg(m, entry, ing)
            ok = mg is not None and n is not None and per_day is not None and not (uncertain & {"strength", "dosage", "frequency"})
            t = out.setdefault(ing, {"total_mg": 0.0, "complete": True, "parts": []})
            if ok:
                t["total_mg"] += mg * n * per_day
                t["parts"].append({"medicine": _ref(m), "mg_per_day": round(mg * n * per_day)})
            else:
                t["complete"] = False
    return {i: t for i, t in out.items() if t["parts"]}


def _ingredient_mg(m: dict, entry: dict, ing: str) -> float | None:
    """Strength of one ingredient in mg: from the catalogue entry when it has one, else from the confirmed
    strength (only for single-ingredient generics, only in mg — units are never converted)."""
    for i in entry["ingredients"]:
        if i["id"] == ing and i["strength"]:
            return float(i["strength"]["value"]) if i["strength"]["unit"] == "mg" else None
    if len(entry["ingredients"]) == 1 and "strength" not in set(m.get("uncertain_fields") or []):
        st = parse_strength(m.get("strength"))
        if st and st[1] == "mg":
            return st[0]
    return None


__all__ = ["run_check", "ruleset", "entry_brief", "patient_context"]
