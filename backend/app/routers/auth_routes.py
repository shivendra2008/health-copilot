"""Account creation without email verification.

The backend creates the user with the Supabase admin API and marks the email as
confirmed, so a new user can sign in immediately. Rate-limited per client IP.
"""
from fastapi import APIRouter, Request

from ..audit import audit
from ..config import get_settings
from ..deps import get_db
from ..errors import ApiError
from ..ratelimit import check_rate_limit
from ..schemas.api import SignupRequest

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for") or request.headers.get("cf-connecting-ip")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/signup", status_code=201)
def signup(body: SignupRequest, request: Request):
    check_rate_limit(f"ip:{_client_ip(request)}", "signup", max(3, get_settings().rate_limit_uploads // 2))
    db = get_db()
    try:
        res = db.auth.admin.create_user({
            "email": body.email.lower(),
            "password": body.password,
            "email_confirm": True,
            "user_metadata": {"full_name": body.full_name},
        })
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        if "already" in msg and ("registered" in msg or "exists" in msg):
            raise ApiError(409, "email_taken", "An account with this email already exists. Sign in instead.")
        if "password" in msg:
            raise ApiError(422, "weak_password", "Choose a stronger password (at least 8 characters).")
        raise ApiError(502, "signup_failed", "We couldn't create your account. Please try again.")
    user_id = res.user.id
    # Profile row is created by the auth trigger; make sure the name is set and onboarding is pending.
    try:
        db.table("profiles").upsert({"id": user_id, "full_name": body.full_name, "onboarding_completed": False}).execute()
    except Exception:  # migration 0002 not applied yet → just set the name
        db.table("profiles").upsert({"id": user_id, "full_name": body.full_name}).execute()
    audit(db, user_id, "account.created", "profile", user_id)
    return {"user_id": user_id}
