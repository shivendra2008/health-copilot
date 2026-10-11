"""Authentication: validates the Supabase access token sent as a Bearer header."""
import hashlib
import time
from dataclasses import dataclass

import httpx
from fastapi import Header

from .config import get_settings
from .errors import ApiError

_CACHE: dict[str, tuple[float, "CurrentUser"]] = {}
_TTL = 60.0


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None


async def _fetch_user(token: str) -> CurrentUser:
    s = get_settings()
    if not s.supabase_configured:
        raise ApiError(503, "supabase_not_configured", "Authentication backend is not configured.")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            f"{s.supabase_url}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}",
                     "apikey": s.supabase_anon_key or s.supabase_service_role_key},
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
    user = await _fetch_user(token)
    _CACHE[key] = (now + _TTL, user)
    if len(_CACHE) > 5000:
        for k in [k for k, v in _CACHE.items() if v[0] <= now]:
            _CACHE.pop(k, None)
    return user
