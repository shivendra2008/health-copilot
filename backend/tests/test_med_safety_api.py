"""API behaviour: ownership (404), failure isolation, state handling, explain guard. DB is an in-memory fake."""
import pytest
from fastapi.testclient import TestClient

from app.auth import CurrentUser, get_current_user
from app.main import app
from app.routers import medication_safety as ms
from app.services.groq_client import LLMError

from .fakedb import FakeDB

ALICE, BOB = "aaaaaaaa-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-000000000002"
DOC_A = "11111111-1111-1111-1111-111111111111"
DOC_B = "22222222-2222-2222-2222-222222222222"


def med(i, user, name, cid, doc=DOC_A, status="current", **k):
    return {"id": f"00000000-0000-0000-0000-{i:012d}", "user_id": user, "document_id": doc, "name": name,
            "strength": None, "dosage": None, "frequency": None, "duration": None, "route": None, "instructions": None,
            "current_status": status, "uncertain_fields": [], "catalogue_id": cid,
            "resolution_status": "resolved" if cid else "unresolved", "resolution_confidence": "high",
            "resolution_candidates": [], "created_at": f"2026-10-24T10:00:0{i}+00:00", **k}


@pytest.fixture
def db(monkeypatch):
    d = FakeDB(
        documents=[{"id": DOC_A, "user_id": ALICE, "status": "confirmed", "document_date": "2026-09-01", "created_at": "2026-09-02T00:00:00+00:00"},
                   {"id": DOC_B, "user_id": BOB, "status": "confirmed", "document_date": None, "created_at": "2026-09-02T00:00:00+00:00"}],
        confirmed_medications=[med(1, ALICE, "Dolo 650", "br_dolo_650"), med(2, ALICE, "Combiflam", "br_combiflam"),
                               med(3, BOB, "Warfarin", "gen_warfarin", DOC_B), med(4, BOB, "Voveran", "br_voveran_50", DOC_B)],
        profiles=[{"id": ALICE, "age_years": 40}], medications=[], audit_logs=[], medication_safety_reports=[])
    monkeypatch.setattr(ms, "get_db", lambda: d)
    monkeypatch.setattr("app.audit.log.warning", lambda *a, **k: None)
    return d


def as_user(uid):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=uid, email=None)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    from app import ratelimit
    ratelimit._HITS.clear()  # the limiter is process-global; each test starts with a clean window
    yield
    app.dependency_overrides.clear()


# ----------------------------------------------------------------------------- access control
@pytest.mark.parametrize("method,path", [
    ("post", "/api/v1/medication-safety/check"), ("get", "/api/v1/medication-safety/reports"),
    ("get", "/api/v1/medication-safety/reports/x"), ("get", "/api/v1/medication-safety/confirmed-medications"),
    ("get", "/api/v1/medication-safety/medicines/search?q=dol"), ("post", "/api/v1/medication-safety/resolve-brand"),
    ("post", "/api/v1/medication-safety/reports/x/explain"),
])
def test_endpoints_require_auth(method, path):
    r = getattr(TestClient(app), method)(path)
    assert r.status_code == 401


def test_check_and_fetch_report_roundtrip(db):
    c = as_user(ALICE)
    r = c.post("/api/v1/medication-safety/check", json={"source_type": "document", "document_id": DOC_A})
    assert r.status_code == 201
    rep = r.json()
    assert rep["ruleset_version"] and rep["catalogue_version"] and rep["ruleset_label"]
    assert any(f["type"] == "duplicate_ingredient" for f in rep["findings"])
    assert [m["name"] for m in rep["medication_snapshot"]] == ["Dolo 650", "Combiflam"]
    got = c.get(f"/api/v1/medication-safety/reports/{rep['id']}")
    assert got.status_code == 200 and got.json()["id"] == rep["id"]
    assert c.get("/api/v1/medication-safety/reports").json()["total"] == 1


def test_other_users_report_is_404(db):
    rid = as_user(ALICE).post("/api/v1/medication-safety/check", json={"source_type": "current_list"}).json()["id"]
    bob = as_user(BOB)
    assert bob.get(f"/api/v1/medication-safety/reports/{rid}").status_code == 404
    assert bob.post(f"/api/v1/medication-safety/reports/{rid}/explain", json={"language": "en"}).status_code == 404
    assert bob.delete(f"/api/v1/medication-safety/reports/{rid}").status_code == 404
    assert bob.get("/api/v1/medication-safety/reports").json()["total"] == 0
    assert len(db.tables["medication_safety_reports"]) == 1  # not deleted


def test_other_users_document_and_medicines_are_404(db):
    alice = as_user(ALICE)
    assert alice.post("/api/v1/medication-safety/check", json={"source_type": "document", "document_id": DOC_B}).status_code == 404
    assert alice.post(f"/api/v1/medication-safety/confirmed-medications/from-document/{DOC_B}").status_code == 404
    bobs_med = "00000000-0000-0000-0000-000000000003"
    assert alice.patch(f"/api/v1/medication-safety/confirmed-medications/{bobs_med}", json={"name": "x"}).status_code == 404
    assert alice.delete(f"/api/v1/medication-safety/confirmed-medications/{bobs_med}").status_code == 404
    assert any(m["id"] == bobs_med for m in db.tables["confirmed_medications"])
    assert all(m["user_id"] == ALICE for m in alice.get("/api/v1/medication-safety/confirmed-medications").json()["items"])


def test_non_uuid_ids_are_404_not_500(db):
    c = as_user(ALICE)
    assert c.get("/api/v1/medication-safety/reports/1%20or%201=1").status_code == 404
    assert c.patch("/api/v1/medication-safety/confirmed-medications/nope", json={"name": "x"}).status_code == 404


def test_include_current_never_pulls_in_other_users_medicines(db):
    rep = as_user(ALICE).post("/api/v1/medication-safety/check",
                              json={"source_type": "document", "document_id": DOC_A, "include_current": True}).json()
    assert {m["name"] for m in rep["medication_snapshot"]} == {"Dolo 650", "Combiflam"}


# ----------------------------------------------------------------------------- state handling
def test_check_without_confirmed_medicines_is_409(db):
    db.tables["confirmed_medications"] = []
    r = as_user(ALICE).post("/api/v1/medication-safety/check", json={"source_type": "current_list"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "no_confirmed_medications"


def test_current_list_only_includes_explicitly_current(db):
    for m in db.tables["confirmed_medications"]:
        if m["user_id"] == ALICE and m["name"] == "Combiflam":
            m["current_status"] = "unknown"
    rep = as_user(ALICE).post("/api/v1/medication-safety/check", json={"source_type": "current_list"}).json()
    assert [m["name"] for m in rep["medication_snapshot"]] == ["Dolo 650"]
    assert not [f for f in rep["findings"] if f["type"] in ("duplicate_ingredient", "interaction")]
    assert all(f["severity"] == "info" for f in rep["findings"])  # only "details missing" notices


def test_seed_requires_confirmed_document_and_starts_unknown(db):
    db.tables["documents"][0]["status"] = "needs_review"
    c = as_user(ALICE)
    assert c.post(f"/api/v1/medication-safety/confirmed-medications/from-document/{DOC_A}").status_code == 409
    db.tables["documents"][0]["status"] = "confirmed"
    db.tables["confirmed_medications"] = []
    db.tables["medications"] = [{"id": "m1", "user_id": ALICE, "document_id": DOC_A, "item_key": "k1", "name": "Dolo", "strength": None},
                                {"id": "m2", "user_id": ALICE, "document_id": DOC_A, "item_key": "k2", "name": "Zyxotab", "strength": None}]
    out = c.post(f"/api/v1/medication-safety/confirmed-medications/from-document/{DOC_A}").json()
    by_name = {m["name"]: m for m in out["items"]}
    assert all(m["current_status"] == "unknown" for m in out["items"])
    assert by_name["Dolo"]["resolution_status"] == "ambiguous" and by_name["Dolo"]["catalogue_id"] is None
    assert by_name["Zyxotab"]["resolution_status"] == "unresolved"
    assert by_name["Dolo"]["prescription_date"] == "2026-09-01"
    assert c.post(f"/api/v1/medication-safety/confirmed-medications/from-document/{DOC_A}").json()["added"] == 0  # idempotent


def test_patch_resolution_select_unresolved_and_reset(db):
    c = as_user(ALICE)
    mid = "00000000-0000-0000-0000-000000000001"
    url = f"/api/v1/medication-safety/confirmed-medications/{mid}"
    assert c.patch(url, json={"resolution": {"action": "select", "catalogue_id": "nope"}}).status_code == 422
    r = c.patch(url, json={"resolution": {"action": "select", "catalogue_id": "br_dolo_500"}}).json()
    assert r["resolution_status"] == "user_selected" and r["catalogue_id"] == "br_dolo_500"
    r = c.patch(url, json={"resolution": {"action": "unresolved"}}).json()
    assert r["resolution_status"] == "user_unresolved" and r["catalogue_id"] is None
    r = c.patch(url, json={"name": "Combiflam"}).json()  # renaming re-resolves instead of keeping a stale match
    assert r["catalogue_id"] == "br_combiflam"
    r = c.patch(url, json={"current_status": "past", "uncertain_fields": ["strength", "strength"]}).json()
    assert r["current_status"] == "past" and r["status_confirmed_at"] and r["uncertain_fields"] == ["strength"]


def test_patch_rejects_unknown_fields_and_bad_status(db):
    c = as_user(ALICE)
    url = "/api/v1/medication-safety/confirmed-medications/00000000-0000-0000-0000-000000000001"
    assert c.patch(url, json={"user_id": BOB}).status_code == 422
    assert c.patch(url, json={"current_status": "maybe"}).status_code == 422


# ----------------------------------------------------------------------------- failure isolation
def test_engine_failure_returns_503_and_saves_nothing(db, monkeypatch):
    def boom(*a, **k): raise RuntimeError("patient text must not leak: Dolo")
    monkeypatch.setattr(ms, "run_check", boom)
    r = as_user(ALICE).post("/api/v1/medication-safety/check", json={"source_type": "current_list"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "check_failed"
    assert "Dolo" not in r.text and "patient text" not in r.text
    assert db.tables["medication_safety_reports"] == []


def test_missing_migration_gives_clear_503(db, monkeypatch):
    class Gone:
        def table(self, *_): raise Exception("PGRST205: Could not find the table 'public.confirmed_medications' in the schema cache")
    monkeypatch.setattr(ms, "get_db", lambda: Gone())
    r = as_user(ALICE).get("/api/v1/medication-safety/confirmed-medications")
    assert r.status_code == 503 and r.json()["error"]["code"] == "medication_safety_not_ready"


def test_safety_failure_does_not_break_existing_endpoints(db, monkeypatch):
    monkeypatch.setattr(ms, "run_check", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    c = as_user(ALICE)
    assert c.post("/api/v1/medication-safety/check", json={"source_type": "current_list"}).status_code == 503
    assert c.get("/api/v1/health").status_code == 200
    assert c.get("/api/v1/medication-safety/medicines/search?q=dol").status_code == 200


# ----------------------------------------------------------------------------- explain guard
def _report(c):
    return c.post("/api/v1/medication-safety/check", json={"source_type": "current_list"}).json()["id"]


def test_explain_accepts_grounded_text_and_caches(db, monkeypatch):
    calls = []
    def fake(system, prompt, *a, **k):
        calls.append(prompt)
        return {"explanation": "Dolo 650 and Combiflam both contain paracetamol. Please ask your pharmacist."}, "m"
    monkeypatch.setattr(ms, "chat_json", fake)
    c = as_user(ALICE)
    rid = _report(c)
    a = c.post(f"/api/v1/medication-safety/reports/{rid}/explain", json={"language": "hi"}).json()
    b = c.post(f"/api/v1/medication-safety/reports/{rid}/explain", json={"language": "hi"}).json()
    assert a["generated_by"] == "assistant" == b["generated_by"] and len(calls) == 1
    assert "Bob" not in calls[0] and BOB not in calls[0]


def test_explain_with_invented_number_falls_back_to_deterministic_text(db, monkeypatch):
    monkeypatch.setattr(ms, "chat_json", lambda *a, **k: ({"explanation": "Take 3 tablets of Dolo 650 and stop Combiflam 999."}, "m"))
    c = as_user(ALICE)
    rid = _report(c)
    out = c.post(f"/api/v1/medication-safety/reports/{rid}/explain", json={"language": "en"}).json()
    assert out["generated_by"] == "deterministic" and "999" not in out["content"]
    assert "Do not stop or change a medicine" in out["content"]
    assert db.tables["medication_safety_reports"][0].get("explanations", {}) == {}  # unverified output is never cached


def test_explain_llm_outage_is_a_clean_error(db, monkeypatch):
    def down(*a, **k): raise LLMError("ai_unavailable", "The AI service is unavailable.")
    monkeypatch.setattr(ms, "chat_json", down)
    c = as_user(ALICE)
    r = c.post(f"/api/v1/medication-safety/reports/{_report(c)}/explain", json={"language": "en"})
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_unavailable"


def test_explain_prompt_contains_only_report_data(db):
    from app.services.med_safety.explain import explain_prompt
    c = as_user(ALICE)
    rep = c.get(f"/api/v1/medication-safety/reports/{_report(c)}").json()
    system, prompt = explain_prompt(rep, "mr")
    assert "Marathi" in system and "ALICE" not in prompt.upper() and ALICE not in prompt and "user_id" not in prompt
