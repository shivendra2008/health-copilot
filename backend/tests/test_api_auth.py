"""Authorization & error-shape tests (no network, DB stubbed)."""
import pytest
from fastapi.testclient import TestClient

from app import auth
from app.auth import CurrentUser
from app.deps import owned_document
from app.errors import ApiError
from app.main import app


class _Q:
    def __init__(self, rows):
        self.rows, self.filters = rows, {}

    def select(self, *a, **k): return self
    def limit(self, *a): return self

    def eq(self, col, val):
        self.filters[col] = val
        return self

    def execute(self):
        class R: pass
        r = R()
        r.data = [x for x in self.rows if all(x.get(k) == v for k, v in self.filters.items())]
        return r


class FakeDB:
    def __init__(self, rows): self.rows = rows
    def table(self, _): return _Q(self.rows)


DOC = {"id": "11111111-1111-1111-1111-111111111111", "user_id": "owner"}


def test_owned_document_allows_owner():
    assert owned_document(FakeDB([DOC]), DOC["id"], "owner")["id"] == DOC["id"]


def test_owned_document_hides_other_users_docs():
    with pytest.raises(ApiError) as e:
        owned_document(FakeDB([DOC]), DOC["id"], "intruder")
    assert e.value.status == 404


def test_owned_document_rejects_non_uuid():
    with pytest.raises(ApiError) as e:
        owned_document(FakeDB([DOC]), "1 or 1=1", "owner")
    assert e.value.status == 404


client = TestClient(app)


@pytest.mark.parametrize("method,path", [
    ("get", "/api/v1/documents"), ("get", "/api/v1/dashboard"), ("get", "/api/v1/timeline"),
    ("get", "/api/v1/trends"), ("post", "/api/v1/assistant/chat"), ("get", "/api/v1/profile"),
    ("patch", f"/api/v1/documents/{DOC['id']}/extraction"), ("post", f"/api/v1/documents/{DOC['id']}/confirm"),
])
def test_protected_endpoints_require_token(method, path):
    r = getattr(client, method)(path)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_invalid_token_rejected(monkeypatch):
    async def bad(_):
        raise ApiError(401, "unauthorized", "x")
    monkeypatch.setattr(auth, "_fetch_user", bad)
    r = client.get("/api/v1/documents", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


def test_validation_error_shape():
    app.dependency_overrides[auth.get_current_user] = lambda: CurrentUser("u1", "a@b.c")
    try:
        r = client.post("/api/v1/assistant/chat", json={"message": ""})
        assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
        r = client.get("/api/v1/health-records?type=passwords")
        assert r.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_health_endpoint_reports_config():
    body = client.get("/api/v1/health").json()
    assert set(body) >= {"supabase_configured", "ai_configured", "ocr_available"}


def test_rate_limit():
    from app.ratelimit import check_rate_limit
    for _ in range(3):
        check_rate_limit("rl-user", "t", 3)
    with pytest.raises(ApiError) as e:
        check_rate_limit("rl-user", "t", 3)
    assert e.value.status == 429


def test_groq_wait_parsing():
    import httpx
    from app.services.groq_client import _wait_seconds
    mk = lambda h: httpx.Response(429, headers=h)
    assert _wait_seconds(mk({"retry-after": "7"})) == 7.0
    assert _wait_seconds(mk({"x-ratelimit-reset-tokens": "47.062s"})) == 47.062
    assert _wait_seconds(mk({"x-ratelimit-reset-tokens": "1m2.5s"})) == 62.5
    assert _wait_seconds(mk({})) is None


def test_signup_validation():
    r = client.post("/api/v1/auth/signup", json={"full_name": "A", "email": "not-an-email", "password": "longenough"})
    assert r.status_code == 422
    r = client.post("/api/v1/auth/signup", json={"full_name": "A", "email": "a@b.co", "password": "short"})
    assert r.status_code == 422
    r = client.post("/api/v1/auth/signup", json={"full_name": "A", "email": "a@b.co", "password": "longenough", "admin": True})
    assert r.status_code == 422


def test_profile_patch_ranges():
    from app.schemas.api import ProfilePatch
    import pydantic
    ProfilePatch(age_years=34, height_cm=162.5, weight_kg=58, onboarding_completed=True)
    for bad in ({"age_years": -1}, {"height_cm": 900}, {"weight_kg": 0}):
        with pytest.raises(pydantic.ValidationError):
            ProfilePatch(**bad)


def test_telugu_supported_everywhere():
    from app.routers.assistant import NO_DATA
    from app.schemas.api import ChatRequest, ProfilePatch, SummaryRequest
    from app.services.prompts import LANG_NAMES
    assert ChatRequest(message="hi", language="te").language == "te"
    assert SummaryRequest(language="te").language == "te"
    assert ProfilePatch(preferred_language="te").preferred_language == "te"
    assert "Telugu" in LANG_NAMES["te"] and NO_DATA["te"]


def test_translate_requires_auth_and_valid_language():
    r = client.post("/api/v1/assistant/messages/11111111-1111-1111-1111-111111111111/translate", json={"language": "te"})
    assert r.status_code == 401
    app.dependency_overrides[auth.get_current_user] = lambda: CurrentUser("u1", "a@b.c")
    try:
        r = client.post("/api/v1/assistant/messages/x/translate", json={"language": "fr"})
        assert r.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_translation_fact_guard():
    from app.routers.assistant import same_facts
    src = "Hemoglobin was 11.2 g/dL on 12 Mar 2026 [R1], range 12.0 - 15.5. Ferrous Ascorbate 100 mg [R3]."
    ok = "हीमोग्लोबिन 12 मार्च 2026 को 11.2 g/dL था [R1], सीमा 12.0 - 15.5। Ferrous Ascorbate 100 mg [R3]।"
    assert same_facts(src, ok)
    assert not same_facts(src, ok.replace("11.2", "12.2"))      # changed value
    assert not same_facts(src, ok.replace("[R3]", ""))          # dropped citation
    assert same_facts("Value १२", "Value 12")                    # Devanagari digits fold to ASCII


# ---- local JWT verification (no network) -------------------------------------------------
import time as _time
import types as _types

import jwt as _jwt
from cryptography.hazmat.primitives.asymmetric import ec as _ec
from jwt import PyJWK as _PyJWK

_URL = "https://proj.supabase.co"


def _keypair(kid="k1"):
    priv = _ec.generate_private_key(_ec.SECP256R1())
    jwk = _jwt.algorithms.ECAlgorithm.to_jwk(priv.public_key(), as_dict=True) | {"kid": kid, "alg": "ES256", "use": "sig"}
    return priv, {kid: _PyJWK(jwk)}


def _token(priv, **over):
    claims = {"sub": "user-123", "email": "a@b.c", "aud": "authenticated", "iss": f"{_URL}/auth/v1",
              "exp": int(_time.time()) + 600} | over
    return _jwt.encode(claims, priv, algorithm="ES256", headers={"kid": "k1"})


@pytest.fixture
def jwks(monkeypatch):
    priv, keys = _keypair()
    monkeypatch.setattr(auth, "_load_jwks", lambda force=False: keys)
    monkeypatch.setattr(auth, "get_settings", lambda: _types.SimpleNamespace(supabase_url=_URL, supabase_configured=True))
    return priv


def test_local_verify_accepts_valid_token(jwks):
    u = auth.verify_locally(_token(jwks))
    assert u == CurrentUser("user-123", "a@b.c")


@pytest.mark.parametrize("over", [{"exp": 1}, {"aud": "anon"}, {"iss": "https://evil.example/auth/v1"}])
def test_local_verify_rejects_expired_wrong_audience_wrong_issuer(jwks, over):
    with pytest.raises(ApiError) as e:
        auth.verify_locally(_token(jwks, **over))
    assert e.value.status == 401


def test_local_verify_rejects_token_signed_by_another_key(jwks):
    other, _ = _keypair()
    with pytest.raises(ApiError) as e:
        auth.verify_locally(_token(other))   # same kid, different key → bad signature
    assert e.value.status == 401


def test_local_verify_unknown_kid_or_alg_defers_to_network(jwks):
    other, _ = _keypair()
    t = _jwt.encode({"sub": "x", "exp": int(_time.time()) + 60}, other, algorithm="ES256", headers={"kid": "other-kid"})
    assert auth.verify_locally(t) is None
    hs = _jwt.encode({"sub": "x"}, "secret-secret-secret-secret-secret!", algorithm="HS256")
    assert auth.verify_locally(hs) is None
    with pytest.raises(ApiError):
        auth.verify_locally("not.a.jwt")
