from collections import defaultdict
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


@router.get("/trends")
def trends(test: str | None = Query(None, max_length=200), user: CurrentUser = Depends(get_current_user)):
    """Without `test`: list of tests with ≥1 confirmed value. With `test`: series grouped by unit.
    Values with different units are NEVER merged into one series."""
    db = get_db()
    if not test:
        rows = (db.table("observations").select("normalized_name,test_name,unit_normalized,value_num,effective_date,category")
                .eq("user_id", user.id).limit(5000).execute().data)
        agg: dict[str, dict] = {}
        for r in rows:
            a = agg.setdefault(r["normalized_name"], {"test": r["normalized_name"], "display_name": r["test_name"],
                                                      "category": r["category"], "count": 0, "numeric_count": 0,
                                                      "units": set(), "latest_date": None})
            a["count"] += 1
            if r["value_num"] is not None:
                a["numeric_count"] += 1
            if r["unit_normalized"]:
                a["units"].add(r["unit_normalized"])
            if r["effective_date"] and (a["latest_date"] is None or r["effective_date"] > a["latest_date"]):
                a["latest_date"] = r["effective_date"]
        items = [{**a, "units": sorted(a["units"])} for a in agg.values()]
        items.sort(key=lambda a: (-a["numeric_count"], a["display_name"].lower()))
        return {"tests": items}

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
    db = get_db()
    uid = user.id

    def count(table, **filters):
        q = db.table(table).select("id", count="exact").eq("user_id", uid)
        for k, v in filters.items():
            q = q.in_(k, v) if isinstance(v, list) else q.eq(k, v)
        return q.limit(1).execute().count or 0

    recent_docs = (db.table("documents")
                   .select("id,file_name,doc_type,status,document_date,source_facility,created_at,status_detail")
                   .eq("user_id", uid).order("created_at", desc=True).limit(6).execute().data)
    attention = (db.table("observations")
                 .select("id,document_id,test_name,value_text,unit,reference_range_text,interpretation,effective_date")
                 .eq("user_id", uid).in_("interpretation", ["above_range", "below_range"])
                 .order("effective_date", desc=True).limit(6).execute().data)
    activity = (db.table("audit_logs").select("action,entity_id,created_at,metadata")
                .eq("user_id", uid).in_("action", ["document.uploaded", "document.processed", "extraction.corrected",
                                                   "extraction.confirmed", "document.process_failed", "document.deleted"])
                .order("created_at", desc=True).limit(8).execute().data)
    return {
        "stats": {
            "total_documents": count("documents"),
            "confirmed_documents": count("documents", status="confirmed"),
            "pending_review": count("documents", status="needs_review"),
            "processing": count("documents", status=["uploaded", "extracting_text", "analyzing"]),
            "failed": count("documents", status="failed"),
            "lab_results": count("observations"),
            "out_of_range": count("observations", interpretation=["above_range", "below_range"]),
            "medications": count("medications"),
        },
        "recent_documents": recent_docs,
        "attention": attention,
        "activity": activity,
    }
