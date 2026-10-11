"""Minimal Groq client (OpenAI-compatible chat completions + strict JSON schema)."""
import json
import logging
import re
import time

import httpx

from ..config import get_settings

log = logging.getLogger("healthcopilot.groq")


class LLMError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _wait_seconds(r: httpx.Response) -> float | None:
    """Seconds Groq asks us to wait (Retry-After or x-ratelimit-reset-* like '1m2.5s')."""
    ra = r.headers.get("retry-after")
    if ra:
        try:
            return float(ra)
        except ValueError:
            pass
    reset = r.headers.get("x-ratelimit-reset-tokens") or r.headers.get("x-ratelimit-reset-requests")
    m = re.fullmatch(r"(?:(\d+)m)?([\d.]+)s", reset or "")
    if m:
        return int(m.group(1) or 0) * 60 + float(m.group(2))
    return None


def chat_json(system: str, user: str, schema_name: str, schema: dict,
              temperature: float = 0.1, max_tokens: int = 4096, max_wait: float = 60.0) -> tuple[dict, str]:
    """Returns (parsed_json, model). Raises LLMError with a safe, user-facing message.

    `max_wait` caps how long a single rate-limit pause may be (background jobs can wait
    longer than interactive requests)."""
    s = get_settings()
    if not s.groq_configured:
        raise LLMError("ai_not_configured", "AI processing is not configured. Set GROQ_API_KEY on the backend.")
    payload = {
        "model": s.groq_model,
        "temperature": temperature,
        "max_completion_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {"type": "json_schema",
                            "json_schema": {"name": schema_name, "strict": True, "schema": schema}},
    }
    if s.groq_model.startswith("openai/gpt-oss"):
        payload["reasoning_effort"] = "low"
    headers = {"Authorization": f"Bearer {s.groq_api_key}", "Content-Type": "application/json"}

    last_status = None
    waited = 0.0
    for attempt in range(s.groq_max_retries + 1):
        delay = 1.5 * (2 ** attempt)
        try:
            with httpx.Client(timeout=s.groq_timeout_seconds) as client:
                r = client.post(f"{s.groq_base_url}/chat/completions", headers=headers, json=payload)
        except httpx.TimeoutException:
            last_status = "timeout"
        except httpx.HTTPError:
            last_status = "network"
        else:
            last_status = r.status_code
            if r.status_code == 200:
                body = r.json()
                content = body["choices"][0]["message"].get("content") or ""
                try:
                    return json.loads(content), body.get("model", s.groq_model)
                except json.JSONDecodeError:
                    raise LLMError("ai_invalid_output", "The AI returned an unreadable response. Please retry.")
            if r.status_code in (401, 403):
                raise LLMError("ai_auth_failed", "The AI provider rejected the API key. Check GROQ_API_KEY.")
            if r.status_code == 404:
                raise LLMError("ai_model_unavailable", f"The configured model '{s.groq_model}' is not available.")
            if r.status_code == 413:
                raise LLMError("ai_input_too_large", "The document is too long for the AI model.")
            if r.status_code == 400:
                log.warning("Groq 400: %s", r.text[:300].replace("\n", " "))
                raise LLMError("ai_request_rejected", "The AI provider could not process this document. Please retry.")
            if r.status_code not in (408, 429, 500, 502, 503, 504):
                break
            if r.status_code == 429:
                hint = _wait_seconds(r)
                if hint is not None:
                    if hint > max_wait or waited + hint > max_wait * 2:
                        break
                    delay = hint + 0.5
        if attempt < s.groq_max_retries:
            log.info("Groq retry in %.1fs (status=%s)", delay, last_status)
            time.sleep(delay)
            waited += delay
    if last_status == 429:
        raise LLMError("ai_rate_limited", "The AI service is busy (rate limited). Please retry in a minute.")
    raise LLMError("ai_unavailable", "The AI service is temporarily unavailable. Please retry.")
