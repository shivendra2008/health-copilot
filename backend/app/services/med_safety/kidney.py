"""Kidney function from the user's own confirmed lab results, and the re-check of kidney-related medication rules
whenever a new result is added. Deterministic: no AI.

Nothing is guessed. A creatinine value is turned into an eGFR only when it is a plain number in mg/dL AND the profile
has age and a sex of female/male (the CKD-EPI 2021 equation needs both); otherwise the result is not used and the
reason is reported. The 60 mL/min/1.73 m² threshold lives in the ruleset (pending pharmacist review).
"""
import logging
import re
from datetime import date

from .engine import ruleset, run_check
from .timeline import _item

log = logging.getLogger("healthcopilot.kidney")

_EGFR_NAME = re.compile(r"\b(e\s?gfr|gfr|glomerular filtration)\b", re.I)
_NOT_SERUM = re.compile(r"urine|24\s?h|ratio|clearance|acr|albumin", re.I)
_MG_DL = re.compile(r"^mg\s*/\s*dl$", re.I)


def egfr_ckd_epi_2021(scr_mg_dl: float, age: int, sex: str) -> float | None:
    """CKD-EPI 2021 creatinine equation (race-free). Returns None when sex is not female/male or inputs are unusable."""
    if sex not in ("female", "male") or scr_mg_dl <= 0 or age < 18 or age > 120:
        return None
    kappa, alpha = (0.7, -0.241) if sex == "female" else (0.9, -0.302)
    r = scr_mg_dl / kappa
    v = 142 * (min(r, 1) ** alpha) * (max(r, 1) ** -1.200) * (0.9938 ** age) * (1.012 if sex == "female" else 1.0)
    return round(v, 1)


def _is_plain(o: dict) -> bool:
    return o.get("value_num") is not None and o.get("value_comparator") in (None, "", "=")


def _candidates(observations: list[dict], age: int | None, sex: str | None) -> tuple[list[dict], list[str]]:
    """Usable kidney measurements (newest first) and the reasons other kidney results could not be used."""
    out: list[dict] = []
    reasons: list[str] = []
    for o in observations:
        name = o.get("test_name") or ""
        norm = o.get("normalized_name") or ""
        if not _is_plain(o) or not o.get("effective_date"):
            continue
        base = {"observation_id": o.get("id"), "document_id": o.get("document_id"), "observed_date": o["effective_date"][:10]}
        if _EGFR_NAME.search(name) and not _NOT_SERUM.search(name):
            unit = (o.get("unit") or "").lower()
            if unit and "min" not in unit:
                reasons.append("egfr_unit_unsupported")
                continue
            out.append({**base, "egfr": round(float(o["value_num"]), 1), "method": "reported_egfr", "rank": 0})
        elif norm == "creatinine" and not _NOT_SERUM.search(name):
            if not _MG_DL.match((o.get("unit") or "").strip()):
                reasons.append("creatinine_unit_unsupported")
                continue
            if age is None or sex not in ("female", "male"):
                reasons.append("needs_age_and_sex")
                continue
            v = egfr_ckd_epi_2021(float(o["value_num"]), age, sex)
            if v is None:
                reasons.append("needs_age_and_sex")
                continue
            out.append({**base, "egfr": v, "method": "calculated_ckd_epi_2021", "rank": 1})
    # newest first; on the same day a reported eGFR beats a calculated one
    out.sort(key=lambda c: (c["observed_date"], -c["rank"]), reverse=True)
    return out, sorted(set(reasons))


def kidney_status(observations: list[dict], profile: dict | None, today: date | None = None) -> dict:
    """{status: normal|reduced|unknown, egfr, method, observed_date, ...}. `unknown` always says why."""
    cfg = ruleset()["kidney_function"]
    profile = profile or {}
    cands, reasons = _candidates(observations, profile.get("age_years"), profile.get("sex"))
    base = {"threshold": cfg["reduced_below_egfr"], "unit": cfg["egfr_unit"], "ruleset_version": ruleset()["version"]}
    if not cands:
        return {**base, "status": "unknown", "egfr": None, "method": None, "observed_date": None, "document_id": None,
                "observation_id": None, "reason": reasons[0] if reasons else "no_kidney_result", "stale": False}
    best = cands[0]
    today = today or date.today()
    age_days = (today - date.fromisoformat(best["observed_date"])).days
    return {**base, "status": "reduced" if best["egfr"] < cfg["reduced_below_egfr"] else "normal", "egfr": best["egfr"],
            "method": best["method"], "observed_date": best["observed_date"], "document_id": best["document_id"],
            "observation_id": best["observation_id"], "reason": None, "stale": age_days > cfg["max_result_age_days"],
            "unused_results": reasons}


def has_kidney_result(lab_results: list) -> bool:
    """Cheap check on a document's extracted lab names, so a confirm only triggers a re-check when it is relevant."""
    for r in lab_results:
        n = getattr(r, "test_name", "") or ""
        if (_EGFR_NAME.search(n) or re.search(r"creatinine", n, re.I)) and not _NOT_SERUM.search(n):
            return True
    return False


# ----------------------------------------------------------------------------- database-backed
OBS_COLS = "id,document_id,test_name,normalized_name,value_num,value_comparator,unit,effective_date"


def _profile(db, user_id: str) -> dict:
    return (db.table("profiles").select("age_years,sex").eq("id", user_id).limit(1).execute().data or [{}])[0]


def latest_kidney(db, user_id: str, today: date | None = None) -> dict:
    obs = (db.table("observations").select(OBS_COLS).eq("user_id", user_id)
           .order("effective_date", desc=True).limit(2000).execute().data)
    return kidney_status(obs, _profile(db, user_id), today)


def active_medicines(db, user_id: str, today: date | None = None) -> tuple[list[dict], int]:
    """Medicines from confirmed documents whose course has not clearly finished: end date today or later, or no end
    stated (started within a year). Courses with no start date are skipped and counted, never assumed."""
    today = today or date.today()
    rows = (db.table("medications")
            .select("id,document_id,name,strength,dosage,frequency,duration,authored_date,"
                    "documents(file_name,doc_type,source_clinician,source_facility,document_date)")
            .eq("user_id", user_id).order("authored_date", desc=True).limit(500).execute().data)
    active, skipped = [], 0
    for r in rows:
        it = _item(r)
        if it["_start"] is None:
            skipped += 1
        elif (it["_end"] and it["_end"] >= today) or (it["_end"] is None and (today - it["_start"]).days <= 365):
            active.append(it)
    return active, skipped


def recheck(db, user_id: str, trigger_document_id: str | None = None, today: date | None = None, persist: bool = True) -> dict:
    """Re-run the kidney-related rules for the user's active medicines using the latest kidney result."""
    k = latest_kidney(db, user_id, today)
    active, skipped = active_medicines(db, user_id, today)
    meds = [{"id": i["id"], "name": i["name"], "strength": i["strength"], "dosage": i["dosage"], "frequency": i["frequency"],
             "uncertain_fields": [], "catalogue_id": i["_catalogue_id"],
             "resolution_status": "resolved" if i["_catalogue_id"] else i["resolution"]} for i in active]
    findings: list[dict] = []
    if meds and k["status"] != "unknown":
        findings = [f for f in run_check(meds, {"kidney": k["status"]})["findings"] if f["type"] == "patient_specific"]
        for f in findings:
            f["evidence"] = {**(f["evidence"] or {}), "kidney": {k2: k[k2] for k2 in ("egfr", "method", "observed_date", "threshold", "unit")}}
    previous = None
    if persist:
        prev = (db.table("kidney_rechecks").select("kidney_status").eq("user_id", user_id)
                .order("created_at", desc=True).limit(1).execute().data)
        previous = prev[0]["kidney_status"] if prev else None
    out = {"kidney": k, "medicines_checked": len(meds), "medicines_skipped_no_date": skipped, "findings": findings,
           "previous_status": previous, "changed": previous is not None and previous != k["status"],
           "trigger_document_id": trigger_document_id}
    if persist:
        db.table("kidney_rechecks").insert({
            "user_id": user_id, "trigger_document_id": trigger_document_id, "kidney_status": k["status"], "egfr": k["egfr"],
            "method": k["method"], "observed_date": k["observed_date"], "threshold": k["threshold"], "previous_status": previous,
            "medicines_checked": len(meds), "findings": findings, "ruleset_version": k["ruleset_version"]}).execute()
    return out
