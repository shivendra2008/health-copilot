"""Ask AI on the safety results page: the app's check result reaches the assistant as citable [S#] items."""
import pytest
from fastapi.testclient import TestClient

from app.auth import CurrentUser, get_current_user
from app.main import app
from app.routers import assistant as asst
from app.schemas.api import ChatRequest, SafetyContext

from .fakedb import FakeDB

ALICE = "aaaaaaaa-0000-0000-0000-000000000001"

CTX = {
    "medicines": ["Dolo 650", "Combiflam", "Crocin"],
    "findings": [{
        "title": "Paracetamol overdose risk", "severity": "critical",
        "explanation": "Several medicines contain paracetamol.", "medicines": ["Dolo 650", "Combiflam"],
        "computed_daily_mg": 4600, "limit_mg": 3000,
    }],
}


@pytest.fixture
def db(monkeypatch):
    d = FakeDB(observations=[], medications=[], conditions=[], documents=[], assistant_conversations=[],
               assistant_messages=[], audit_logs=[])
    monkeypatch.setattr(asst, "get_db", lambda: d)
    monkeypatch.setattr("app.audit.log.warning", lambda *a, **k: None)
    return d


@pytest.fixture(autouse=True)
def _clean():
    from app import ratelimit
    ratelimit._HITS.clear()
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=ALICE, email=None)
    yield
    app.dependency_overrides.clear()


def test_safety_items_are_numbered_and_carry_the_numbers():
    items = asst.safety_items(SafetyContext(**CTX))
    assert [i["ref"] for i in items] == ["S1", "S2"]
    assert "Dolo 650, Combiflam, Crocin" in items[0]["text"]
    assert "4.6 g" in items[1]["text"] and "3 g" in items[1]["text"]
    assert all(i["document_id"] is None for i in items)
    assert asst.safety_items(None) == [] and asst.safety_items(SafetyContext()) == []


def test_context_is_optional_and_size_capped():
    assert ChatRequest(message="hi").safety_context is None
    with pytest.raises(ValueError):
        ChatRequest(message="hi", safety_context={"medicines": ["x"] * 31})
    with pytest.raises(ValueError):
        ChatRequest(message="hi", safety_context={"findings": [{"title": "t" * 161}]})


def test_chat_answers_from_safety_context_without_any_records(db, monkeypatch):
    seen = {}

    def fake_chat(system, prompt, *a, **k):
        seen["system"], seen["prompt"] = system, prompt
        return {"answer": "Two of your medicines both contain paracetamol [S2].", "citations": ["S2"], "insufficient_information": False}, "m"

    monkeypatch.setattr(asst, "chat_json", fake_chat)
    r = TestClient(app).post("/api/v1/assistant/chat", json={"message": "Why is this a problem?", "safety_context": CTX})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["insufficient_information"] is False
    assert body["citations"][0]["ref"] == "S2" and body["citations"][0]["kind"] == "safety_check"
    assert body["citations"][0]["document_id"] is None
    assert "SAFETY-CHECK ITEMS" in seen["prompt"] and "[S2] Safety-check finding (critical)" in seen["prompt"]
    assert "[S1]" in seen["system"]
    # Only the question is stored, not the context.
    assert db.tables["assistant_messages"][0]["content"] == "Why is this a problem?"


def test_without_records_or_context_nothing_changes(db, monkeypatch):
    monkeypatch.setattr(asst, "chat_json", lambda *a, **k: pytest.fail("the model must not be called"))
    r = TestClient(app).post("/api/v1/assistant/chat", json={"message": "Why is this a problem?"})
    assert r.status_code == 200
    assert r.json()["insufficient_information"] is True and r.json()["answer"] == asst.NO_DATA["en"]


def test_made_up_citations_are_dropped(db, monkeypatch):
    monkeypatch.setattr(asst, "chat_json", lambda *a, **k: ({"answer": "See [S9].", "citations": ["S9", "R4"], "insufficient_information": False}, "m"))
    r = TestClient(app).post("/api/v1/assistant/chat", json={"message": "Explain", "safety_context": CTX})
    assert r.json()["citations"] == [] and r.json()["insufficient_information"] is True
