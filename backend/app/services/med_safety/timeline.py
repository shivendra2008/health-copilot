"""Cross-prescription medication timeline. A pure function of the user's confirmed document medications: no AI,
no network. It places each medicine's course on a date axis and flags the same medicine (or the same active
ingredient) prescribed by different documents/doctors when the courses overlap.

Nothing is guessed: a course whose end date cannot be worked out from what was written is shown as "end not
stated" and any overlap with it is reported as POSSIBLE, never as confirmed.
"""
import re
from datetime import date, timedelta

from .catalogue import catalogue, normalize_name, resolve
from .engine import SEVERITY_ORDER, rank_findings, run_check

_DUR = re.compile(r"(\d{1,3})\s*(days?|d|weeks?|wks?|w|months?|mos?)\b", re.I)
_ONGOING = re.compile(r"\b(ongoing|continue|continuing|long[\s-]?term|life\s?long|regular|indefinite|till\s+review)\b", re.I)
_UNIT_DAYS = {"d": 1, "w": 7, "m": 30}  # a month is taken as 30 days; the course end is then shown as approximate

MAX_PAIRS = 4000
LIMITATIONS = ["timeline_from_confirmed_documents", "timeline_dates_as_written", "timeline_not_medical_advice"]


def _date(s: str | None) -> date | None:
    try:
        return date.fromisoformat(s[:10]) if s else None
    except ValueError:
        return None


def course_length(duration: str | None) -> tuple[int | None, bool]:
    """(days, ongoing) from free text such as '5 days', 'x 2 weeks', '1 month', 'ongoing'. (None, False) = not stated."""
    if not duration:
        return None, False
    if _ONGOING.search(duration):
        return None, True
    m = _DUR.search(duration)
    if not m:
        return None, False
    n, unit = int(m.group(1)), m.group(2).lower()[0]
    return (n * _UNIT_DAYS[unit], False) if n > 0 else (None, False)


def _item(row: dict) -> dict:
    doc = row.get("documents") or {}
    start = _date(row.get("authored_date")) or _date(doc.get("document_date"))
    days, ongoing = course_length(row.get("duration"))
    end = start + timedelta(days=days - 1) if start and days else None
    res = resolve(row["name"], row.get("strength"))
    cat = catalogue()
    entry = cat["by_id"].get(res.catalogue_id) if res.status == "resolved" else None
    ings = [i["id"] for i in entry["ingredients"]] if entry else []
    return {
        "id": row["id"], "document_id": row["document_id"], "name": row["name"], "strength": row.get("strength"),
        "dosage": row.get("dosage"), "frequency": row.get("frequency"), "duration": row.get("duration"),
        "start": start.isoformat() if start else None, "end": end.isoformat() if end else None,
        "end_known": end is not None, "ongoing": ongoing,
        "clinician": doc.get("source_clinician"), "facility": doc.get("source_facility"), "doc_type": doc.get("doc_type"),
        "file_name": doc.get("file_name"),
        "ingredients": [cat["ingredients"][i]["name"] for i in ings], "_ing_ids": ings,
        "resolution": res.status, "_catalogue_id": res.catalogue_id if entry else None,
        "_start": start, "_end": end, "_name_key": normalize_name(row["name"]),
    }


def _overlap(a: dict, b: dict) -> str:
    """overlapping (both courses have known dates and share days) | possibly_overlapping (an end or start is not
    stated, but the courses could share days) | sequential (one finished before the other began)."""
    if a["_start"] is None or b["_start"] is None:
        return "possibly_overlapping"
    inf = date.max
    a_end, b_end = a["_end"] or inf, b["_end"] or inf
    if not (a["_start"] <= b_end and b["_start"] <= a_end):
        return "sequential"
    return "overlapping" if a["_end"] and b["_end"] else "possibly_overlapping"


_RANK = {"overlapping": 0, "possibly_overlapping": 1, "sequential": 2}
_SEVERITY = {"overlapping": "high", "possibly_overlapping": "moderate", "sequential": "info"}


def _prescribers(a: dict, b: dict) -> bool | None:
    if a["clinician"] and b["clinician"]:
        return a["clinician"].strip().lower() != b["clinician"].strip().lower()
    return None  # unknown stays unknown


def _flags(items: list[dict]) -> tuple[list[dict], set[str]]:
    """Flags for the same ingredient (or, when a brand is not in the catalogue, the same name) across DIFFERENT documents."""
    groups: dict[tuple[str, str], list[dict]] = {}
    for it in items:
        if it["_ing_ids"]:
            for i in it["_ing_ids"]:
                groups.setdefault(("ingredient", i), []).append(it)
        else:
            groups.setdefault(("name", it["_name_key"]), []).append(it)
    flags, concurrent = [], set()
    ings = catalogue()["ingredients"]
    for (kind, key), members in sorted(groups.items()):
        pairs = [(a, b) for n, a in enumerate(members) for b in members[n + 1:] if a["document_id"] != b["document_id"]]
        if not pairs:
            continue
        rel = [(_overlap(a, b), a, b) for a, b in pairs]
        worst = min(r for r, _, _ in rel)
        if worst != "sequential":
            for r, a, b in rel:
                if r != "sequential":
                    concurrent |= {a["id"], b["id"]}
        involved = {it["id"]: it for _, a, b in rel for it in (a, b)}
        label = ings[key]["name"] if kind == "ingredient" else involved[next(iter(involved))]["name"]
        diff = [_prescribers(a, b) for r, a, b in rel if r == worst]
        flags.append({
            "id": f"{'dup' if kind == 'ingredient' else 'same'}:{key}", "type": "duplicate_ingredient" if kind == "ingredient" else "same_medicine",
            "status": worst, "severity": _SEVERITY[worst], "subject": label,
            "medicines": [{"id": it["id"], "label": it["name"] + (f" {it['strength']}" if it["strength"] else "")} for it in involved.values()],
            "document_ids": sorted({it["document_id"] for it in involved.values()}),
            "different_prescribers": True if True in diff else (False if diff and all(d is False for d in diff) else None),
        })
    flags.sort(key=lambda f: (SEVERITY_ORDER[f["severity"]], f["subject"]))
    for i, f in enumerate(flags, 1):
        f["rank"] = i
    return flags, concurrent


def build_timeline(rows: list[dict]) -> dict:
    items = sorted((_item(r) for r in rows), key=lambda i: (i["_start"] is None, i["_start"] or date.max, i["name"]))
    flags, _ = _flags(items)
    # Interactions and same-class duplication between courses from DIFFERENT documents that run, or may run, at the
    # same time. Each overlapping pair is checked on its own, so a course that had already ended is never combined
    # with a later one. (Dose totals are not summed across prescriptions here; the duplicate flags cover that case.)
    findings: list[dict] = []
    seen_f: set[tuple] = set()
    pairs = [(a, b) for n, a in enumerate(items) for b in items[n + 1:]
             if a["document_id"] != b["document_id"] and _overlap(a, b) != "sequential"][:MAX_PAIRS]
    concurrent = {x["id"] for a, b in pairs for x in (a, b)}
    for a, b in pairs:
        meds = [{"id": i["id"], "name": i["name"], "strength": i["strength"], "dosage": i["dosage"], "frequency": i["frequency"],
                 "uncertain_fields": [], "catalogue_id": i["_catalogue_id"],
                 "resolution_status": "resolved" if i["_catalogue_id"] else i["resolution"]} for i in (a, b)]
        for f in run_check(meds)["findings"]:
            key = (f["id"], frozenset(m["id"] for m in f["medicines"]))
            if f["type"] in ("interaction", "therapeutic_duplicate") and key not in seen_f:
                seen_f.add(key)
                f["document_ids"] = sorted({a["document_id"], b["document_id"]})
                f["overlap"] = _overlap(a, b)
                findings.append(f)
    rank_findings(findings)

    starts = [i["_start"] for i in items if i["_start"]]
    ends = [i["_end"] or i["_start"] for i in items if i["_start"]]
    seen: dict[str, dict] = {}
    for i in items:
        key = (i["clinician"] or "").strip().lower() or f"doc:{i['document_id']}"
        p = seen.setdefault(key, {"key": key, "clinician": i["clinician"], "facility": i["facility"], "document_ids": [], "count": 0})
        if i["document_id"] not in p["document_ids"]:
            p["document_ids"].append(i["document_id"])
        p["count"] += 1
    for i in items:
        i["concurrent"] = i["id"] in concurrent
        i["prescriber_key"] = (i["clinician"] or "").strip().lower() or f"doc:{i['document_id']}"
        for k in [k for k in i if k.startswith("_")]:
            del i[k]
    return {
        "items": items, "prescribers": list(seen.values()), "flags": flags, "findings": findings,
        "range": {"start": min(starts).isoformat() if starts else None, "end": max(ends).isoformat() if ends else None},
        "documents": len({i["document_id"] for i in items}), "limitations": LIMITATIONS,
    }
