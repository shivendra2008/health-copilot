"""Supabase client (service role). Every query MUST be scoped by user_id."""
from functools import lru_cache

from supabase import Client, create_client
from supabase.lib.client_options import SyncClientOptions

from .config import get_settings
from .errors import ApiError


@lru_cache
def _client() -> Client:
    s = get_settings()
    # Bounded timeouts: a slow or unreachable database must fail fast, not hang a request for minutes.
    opts = SyncClientOptions(postgrest_client_timeout=s.db_timeout_seconds, storage_client_timeout=s.db_timeout_seconds * 2)
    return create_client(s.supabase_url, s.supabase_service_role_key, options=opts)


def get_db() -> Client:
    if not get_settings().supabase_configured:
        raise ApiError(503, "supabase_not_configured",
                       "Database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.")
    return _client()
