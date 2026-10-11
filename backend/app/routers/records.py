from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from fastapi import APIRouter, Depends, Query

from ..auth import CurrentUser, get_current_user
from ..deps import Pagination, get_db
from ..errors import ApiError
from ..services.clinical_rules import normalize_test_name

router = APIRouter(prefix="/api/v1", tags=["records"])

RECORD_TABLES = {
    "observations": ("observations", "effective_date"),
    "medications": ("medications", "authored_date"),
    "conditions": ("conditions", "recorded_date"),
}


@router.get("/health-records")
def health_records(type: str = Query("observations", pattern="^(observations|medications|conditions)$"),
                   p: Pagination = Depends(), q: str | None = Query(None, max_length=100),
                   interpretation: str | None = Query(None, pattern="^(within_range|above_range|below_range|unverified|out_of_range)$"),
                   category: str | None = Query(None, max_length=80),
                   user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    table, date_col = RECORD_TABLES[type]
    query = db.table(table).select("*, documents(file_name, doc_type)", count="exact").eq("user_id", user.id)
    if q:
        col = {"observations": "test_name", "medications": "name", "conditions": "description"}[type]
        query = query.ilike(col, f"%{q.replace('%', '')}%")
    if type == "observations":
        if interpretation == "out_of_range":
            query = query.in_("interpretation", ["above_range", "below_range"])
        elif interpretation:
            query = query.eq("interpretation", interpretation)
        if category:
            query = query.eq("category", category)
    res = query.order(date_col, desc=True).order("created_at", desc=True).range(*p.range).execute()
    return {"items": res.data, "total": res.count or 0, "limit": p.limit, "offset": p.offset}


@router.get("/timeline")
def timeline(p: Pagination = Depends(), date_from: date | None = None, date_to: date | None = None,
             event_type: str | None = Query(None, pattern="^(document|lab_result|medication|diagnosis|procedure|follow_up)$"),
             doc_type: str | None = Query(None, pattern="^(prescription|lab_report|diagnostic_report|discharge_summary|other)$"),
             category: str | None = Query(None, max_length=80),
             user: CurrentUser = Depends(get_current_user)):
    db = get_db()
    sel = "*, documents!inner(file_name, doc_type)" if doc_type else "*, documents(file_name, doc_type)"
    query = db.table("timeline_events").select(sel, count="exact").eq("user_id", user.id)
    if date_from:
        query = query.gte("event_date", date_from.isoformat())
    if date_to:
        query = query.lte("event_date", date_to.isoformat())
    if event_type:
        query = query.eq("event_type", event_type)
    if doc_type:
        query = query.eq("documents.doc_type", doc_type)
    if category:
        query = query.ilike("category", f"%{category.replace('%', '')}%")
    res = (query.order("event_date", desc=True).order("created_at", desc=True).range(*p.range).execute())
    return {"items": res.data, "total": res.count or 0, "limit": p.limit, "offset": p.offset}


OBS_COLS = ("normalized_name,test_name,category,document_id,value_text,value_num,value_comparator,unit,"
            "unit_normalized,reference_range_text,ref_low,ref_high,interpretation,effective_date,created_at")


def fetch_observations(db, user_id: str) -> list[dict]:
    return (db.table("observations").select(OBS_COLS).eq("user_id", user_id)
            .order("effective_date").order("created_at").limit(5000).execute().data)


def test_summaries(db, user_id: str, rows: list[dict] | None = None) -> list[dict]:
    """One entry per test: latest confirmed value plus a same-unit sparkline (oldest → newest)."""
    if rows is None:
        rows = fetch_observations(db, user_id)
    by_test: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_test[r["normalized_name"]].append(r)
    out = []
    for name, rs in by_test.items():
        latest = rs[-1]
        unit = latest["unit_normalized"]
        spark = [{"date": r["effective_date"], "value": float(r["value_num"])} for r in rs
                 if unit and r["unit_normalized"] == unit and r["value_num"] is not None and not r["value_comparator"]][-8:]
        out.append({
            "test": name, "display_name": latest["test_name"], "category": latest["category"],
            "count": len(rs), "numeric_count": sum(1 for r in rs if r["value_num"] is not None),
            "units": sorted({r["unit_normalized"] for r in rs if r["unit_normalized"]}),
            "latest_date": latest["effective_date"],
            "latest": {k: latest[k] for k in ("document_id", "value_text", "value_num", "value_comparator", "unit",
                                              "reference_range_text", "ref_low", "ref_high", "interpretation",
                                              "effective_date")},
            "spark": spark,
        })
    out.sort(key=lambda a: (-a["numeric_count"], a["display_name"].lower()))
    return out


@router.get("/trends")
def trends(test: str | None = Query(None, max_length=200), user: CurrentUser = Depends(get_current_user)):
    """Without `test`: list of tests with ≥1 confirmed value. With `test`: series grouped by unit.
    Values with different units are NEVER merged into one series."""
    db = get_db()
    if not test:
        return {"tests": test_summaries(db, user.id)}

    name = normalize_test_name(test)
    rows = (db.table("observations")
            .select("id,document_id,test_name,value_text,value_num,value_comparator,unit,unit_normalized,"
                    "reference_range_text,ref_low,ref_high,interpretation,effective_date,is_user_corrected")
            .eq("user_id", user.id).eq("normalized_name", name).order("effective_date").execute().data)
    if not rows:
        raise ApiError(404, "not_found", "No confirmed results for this test.")
    series: dict[str, list] = defaultdict(list)
    excluded = []
    for r in rows:
        if r["value_num"] is None or r["value_comparator"]:
            excluded.append({**r, "reason": "non_numeric" if r["value_num"] is None else "comparator_value"})
        elif not r["unit_normalized"]:
            excluded.append({**r, "reason": "missing_unit"})
        else:
            series[r["unit_normalized"]].append(r)
    return {
        "test": name,
        "display_name": rows[-1]["test_name"],
        "series": [{"unit": u, "points": pts} for u, pts in sorted(series.items(), key=lambda kv: -len(kv[1]))],
        "excluded": excluded,
        "note": "Values are grouped by unit and never converted. Reference ranges are those printed on each report "
                "and may differ between laboratories. A change in a value does not by itself indicate improvement or deterioration.",
    }


@router.get("/dashboard")
def dashboard(user: CurrentUser = Depends(get_current_user)):
    """Everything the Overview needs from 6 queries run IN PARALLEL (latency ≈ one round trip).

    Previously this issued 14 sequential requests, which made the page crawl on a slow link."""
    db = get_db()
    uid = user.id

    def docs():
        return (db.table("documents")
                .select("id,file_name,doc_type,status,document_date,source_facility,created_at,status_detail")
                .eq("user_id", uid).order("created_at", desc=True).limit(2000).execute().data)

    def meds():
        return db.table("medications").select("id", count="exact").eq("user_id", uid).limit(1).execute().count or 0

    def convs():
        return db.table("assistant_conversations").select("id", count="exact").eq("user_id", uid).limit(1).execute().count or 0

    def activity():
        return (db.table("audit_logs").select("action,entity_id,created_at,metadata").eq("user_id", uid)
                .in_("action", ["document.uploaded", "document.processed", "extraction.corrected",
                                "extraction.confirmed", "document.process_failed", "document.deleted"])
                .order("created_at", desc=True).limit(8).execute().data)

    with ThreadPoolExecutor(max_workers=5) as pool:
        f_docs, f_obs, f_meds, f_convs, f_act = (pool.submit(fn) for fn in (docs, lambda: fetch_observations(db, uid), meds, convs, activity))
        all_docs, obs_rows, n_meds, n_convs, act = (f.result() for f in (f_docs, f_obs, f_meds, f_convs, f_act))

    status_count = lambda *names: sum(1 for d in all_docs if d["status"] in names)  # noqa: E731
    tests = test_summaries(db, uid, obs_rows)

    breakdown = {"within_range": 0, "above_range": 0, "below_range": 0, "unverified": 0}
    for t in tests:
        breakdown[t["latest"]["interpretation"]] += 1

    attention = [
        {k: r[k] for k in ("document_id", "test_name", "value_text", "value_num", "unit", "reference_range_text",
                           "ref_low", "ref_high", "interpretation", "effective_date")} | {"id": f"{r['document_id']}:{r['normalized_name']}:{i}"}
        for i, r in enumerate(sorted((r for r in obs_rows if r["interpretation"] in ("above_range", "below_range")),
                                     key=lambda r: r["effective_date"] or "", reverse=True)[:6])
    ]

    # Documents per month for the last 12 months (by the date printed on the document, else upload date)
    months: dict[str, dict[str, int]] = {}
    today = date.today()
    for i in range(11, -1, -1):
        y, m = divmod(today.year * 12 + today.month - 1 - i, 12)
        months[f"{y:04d}-{m + 1:02d}"] = {"documents": 0, "confirmed": 0}
    for d in all_docs:
        key = (d["document_date"] or d["created_at"])[:7]
        if key in months:
            months[key]["documents"] += 1
            months[key]["confirmed"] += d["status"] == "confirmed"

    return {
        "range_breakdown": breakdown,
        "monthly": [{"month": k, **v} for k, v in months.items()],
        "stats": {
            "total_documents": len(all_docs),
            "confirmed_documents": status_count("confirmed"),
            "pending_review": status_count("needs_review"),
            "processing": status_count("uploaded", "extracting_text", "analyzing"),
            "failed": status_count("failed"),
            "lab_results": len(obs_rows),
            "out_of_range": sum(1 for r in obs_rows if r["interpretation"] in ("above_range", "below_range")),
            "medications": n_meds,
            "conversations": n_convs,
        },
        "snapshot": sorted((t for t in tests if t["latest"]["value_num"] is not None),
                           key=lambda t: (len(t["spark"]) > 1, t["latest_date"] or ""), reverse=True)[:4],
        "recent_documents": all_docs[:6],
        "attention": attention,
        "activity": act,
    }
