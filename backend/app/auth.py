"""Authentication: validates the Supabase access token sent as a Bearer header.

Fast path: verify the JWT signature locally against the project's public keys (JWKS, cached),
with no network call. Fallback: ask Supabase Auth (`/auth/v1/user`) over a shared keep-alive
connection, used for legacy symmetric-key projects or if the local check can't decide.

Trade-off of local verification: a token stays valid until it expires (about an hour) even if the
user signs out elsewhere. The network fallback checks the live session every time it is used.
"""
import hashlib
import logging
import threading
import time
from dataclasses import dataclass

import httpx
import jwt
from fastapi import Header
from jwt import PyJWK

from .config import get_settings
from .errors import ApiError

log = logging.getLogger("healthcopilot.auth")

_CACHE: dict[str, tuple[float, "CurrentUser"]] = {}
_TTL = 120.0  # network-validated tokens are re-checked at most every 2 minutes

_JWKS: dict[str, PyJWK] = {}
_JWKS_FETCHED = 0.0
_JWKS_TTL = 3600.0
_JWKS_LOCK = threading.Lock()
_client: httpx.AsyncClient | None = None


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None


def _http() -> httpx.AsyncClient:
    """One shared client, so the TLS connection to Supabase is reused instead of re-opened per request."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10, limits=httpx.Limits(max_keepalive_connections=10, keepalive_expiry=60))
    return _client


def _load_jwks(force: bool = False) -> dict[str, PyJWK]:
    global _JWKS, _JWKS_FETCHED
    now = time.monotonic()
    with _JWKS_LOCK:
        if not force and _JWKS and now - _JWKS_FETCHED < _JWKS_TTL:
            return _JWKS
        if force and now - _JWKS_FETCHED < 30:  # don't hammer the endpoint on bad tokens
            return _JWKS
        s = get_settings()
        try:
            r = httpx.get(f"{s.supabase_url}/auth/v1/.well-known/jwks.json", timeout=5)
            keys = r.json().get("keys", []) if r.status_code == 200 else []
            _JWKS = {k["kid"]: PyJWK(k) for k in keys if k.get("kid") and k.get("kty") in ("EC", "RSA")}
        except Exception as exc:  # noqa: BLE001
            log.warning("JWKS fetch failed: %s", type(exc).__name__)
        _JWKS_FETCHED = now
        return _JWKS


def verify_locally(token: str) -> CurrentUser | None:
    """CurrentUser if the signature, expiry, audience and issuer all check out; None if undecidable
    (no matching public key / unsupported algorithm); ApiError 401 if the token is definitely bad."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise ApiError(401, "unauthorized", "Invalid session.")
    alg, kid = header.get("alg"), header.get("kid")
    if alg not in ("ES256", "RS256") or not kid:
        return None
    keys = _load_jwks()
    if kid not in keys:
        keys = _load_jwks(force=True)  # key rotation
    if kid not in keys:
        return None
    s = get_settings()
    try:
        claims = jwt.decode(token, keys[kid].key, algorithms=[alg], audience="authenticated",
                            issuer=f"{s.supabase_url}/auth/v1", options={"require": ["exp", "sub"]})
    except jwt.ExpiredSignatureError:
        raise ApiError(401, "unauthorized", "Your session has expired. Please sign in again.")
    except jwt.PyJWTError:
        raise ApiError(401, "unauthorized", "Invalid session.")
    return CurrentUser(id=claims["sub"], email=claims.get("email"))


async def _fetch_user(token: str) -> CurrentUser:
    s = get_settings()
    if not s.supabase_configured:
        raise ApiError(503, "supabase_not_configured", "Authentication backend is not configured.")
    r = await _http().get(
        f"{s.supabase_url}/auth/v1/user",
        headers={"Authorization": f"Bearer {token}", "apikey": s.supabase_anon_key or s.supabase_service_role_key},
    )
    if r.status_code != 200:
        raise ApiError(401, "unauthorized", "Your session is invalid or has expired. Please sign in again.")
    data = r.json()
    if not data.get("id"):
        raise ApiError(401, "unauthorized", "Invalid session.")
    return CurrentUser(id=data["id"], email=data.get("email"))


async def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise ApiError(401, "unauthorized", "Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()

    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    hit = _CACHE.get(key)
    if hit and hit[0] > now:
        return hit[1]

    user = verify_locally(token)  # no network when the project uses asymmetric signing keys
    if user is None:
        user = await _fetch_user(token)
    _CACHE[key] = (now + _TTL, user)
    if len(_CACHE) > 5000:
        for k in [k for k, v in _CACHE.items() if v[0] <= now]:
            _CACHE.pop(k, None)
    return user
