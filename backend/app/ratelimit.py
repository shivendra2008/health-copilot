"""Simple in-memory sliding-window rate limiter (per user, per bucket).
For multi-instance deployments swap for Redis; single Render instance is fine."""
import time
from collections import defaultdict, deque

from .config import get_settings
from .errors import ApiError

_HITS: dict[tuple[str, str], deque] = defaultdict(deque)


def check_rate_limit(user_id: str, bucket: str, limit: int) -> None:
    window = get_settings().rate_limit_window_seconds
    now = time.monotonic()
    q = _HITS[(user_id, bucket)]
    while q and q[0] <= now - window:
        q.popleft()
    if len(q) >= limit:
        raise ApiError(429, "rate_limited", f"Too many requests. Please wait a moment and try again.",
                       {"retry_after_seconds": int(window - (now - q[0])) + 1})
    q.append(now)
