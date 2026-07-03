"""cache.py — shared Redis connection for rate limiting and LLM cooldown.

Redis is OPTIONAL. When REDIS_URL is set (e.g. the Railway Redis add-on), state
is shared across every gunicorn worker and replica, which is what makes rate
limits and model-cooldowns correct at scale. When it's absent or Redis is
unreachable, callers fall back to per-process in-memory state so the app still
works — correct for a single replica, approximate across many.

A failed connection is NOT cached forever: we back off and retry, so Redis that
comes up (or gets wired in) shortly after boot connects on its own. The last
error is exposed via redis_status() for the /models debug endpoint.
"""
import os
import time

_redis = None
_last_error = None
_next_retry = 0.0
_RETRY_BACKOFF = 30  # seconds to wait before re-attempting after a failure


def get_redis():
    """Return a shared redis client, or None if unconfigured/unreachable."""
    global _redis, _last_error, _next_retry
    if _redis is not None:
        return _redis
    url = (os.environ.get("REDIS_URL") or "").strip()
    if not url:
        _last_error = "REDIS_URL not set"
        return None
    now = time.time()
    if now < _next_retry:
        return None  # still backing off from a recent failure
    try:
        import redis
        client = redis.from_url(
            url,
            socket_connect_timeout=3,
            socket_timeout=3,
            decode_responses=True,
        )
        client.ping()
        _redis = client
        _last_error = None
        print("[cache] Redis connected — rate limits and LLM cooldown are shared.")
        return _redis
    except Exception as e:  # noqa: BLE001 — degrade gracefully, never crash a request
        _last_error = f"{type(e).__name__}: {e}"
        _next_retry = now + _RETRY_BACKOFF
        print(f"[cache] Redis unavailable ({_last_error}); retrying in {_RETRY_BACKOFF}s.")
        return None


def redis_status():
    """For the /models debug endpoint: is Redis connected, and if not, why."""
    return {"connected": _redis is not None, "error": _last_error}
