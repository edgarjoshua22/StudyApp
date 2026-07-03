"""cache.py — shared Redis connection for rate limiting and LLM cooldown.

Redis is OPTIONAL. When REDIS_URL is set (e.g. the Railway Redis add-on), state
is shared across every gunicorn worker and replica, which is what makes rate
limits and model-cooldowns correct at scale. When it's absent or Redis is
unreachable, callers fall back to per-process in-memory state so the app still
works — correct for a single replica, approximate across many.

The client is created once and pinged; if the ping fails we disable Redis for
the life of the process instead of paying a connect timeout on every request.
"""
import os

_redis = None
_resolved = False


def get_redis():
    """Return a shared redis client, or None if unconfigured/unreachable."""
    global _redis, _resolved
    if _resolved:
        return _redis
    _resolved = True
    url = (os.environ.get("REDIS_URL") or "").strip()
    if not url:
        return None
    try:
        import redis
        client = redis.from_url(
            url,
            socket_connect_timeout=2,
            socket_timeout=2,
            decode_responses=True,
        )
        client.ping()
        _redis = client
        print("[cache] Redis connected — rate limits and LLM cooldown are shared.")
    except Exception as e:  # noqa: BLE001 — degrade gracefully, never crash boot
        print(f"[cache] Redis unavailable ({e}); using per-process in-memory state.")
        _redis = None
    return _redis
