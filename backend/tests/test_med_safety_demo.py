"""The documented demo case must produce exactly the documented outcome (so the demo is reproducible)."""
import json
from pathlib import Path

from app.services.med_safety.catalogue import resolve
from app.services.med_safety.engine import run_check

DEMO = json.loads((Path(__file__).resolve().parents[2] / "samples" / "medication_safety_demo.json").read_text(encoding="utf-8"))


def _meds():
    out = []
    for i, m in enumerate(DEMO["confirmed"], 1):
        r = resolve(m["name"], m["strength"])
        out.append({"id": str(i), **m, "uncertain_fields": [], "catalogue_id": r.catalogue_id,
                    "resolution_status": r.status})
    return out


def test_demo_brand_resolution():
    for m in _meds():
        exp = DEMO["expected_resolution"][m["name"]]
        assert (m["resolution_status"], m["catalogue_id"]) == (exp["status"], exp["catalogue_id"]), m["name"]
    crocin = resolve("Crocin", None)
    assert [c["id"] for c in crocin.candidates] == DEMO["expected_resolution"]["Crocin"]["candidates"]


def test_demo_findings_match_documented_outcome():
    result = run_check(_meds(), DEMO["patient"])
    got = sorted((f["type"], f["severity"], f["status"], (f["evidence"] or {}).get("rule_id"),
                  tuple(sorted(m["label"] for m in f["medicines"]))) for f in result["findings"])
    exp = sorted((f["type"], f["severity"], f["status"], f["rule"], tuple(sorted(f["medicines"]))) for f in DEMO["expected_findings"])
    assert got == exp
    assert not [f for f in result["findings"] if f["type"] == "dose_concern"]
    unresolved = {u["medicine"]["label"]: u["reason"] for u in result["unresolved"]}
    assert unresolved == {"Zyxotab 20 mg": "not_in_catalogue", "Crocin": "ambiguous"}
