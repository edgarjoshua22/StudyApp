"""ratelimit.py — per-user, per-endpoint rate limiting.

A fixed-window counter keyed by (user_id, endpoint). Uses Redis (shared across
workers/replicas) when available, else a per-process in-memory fallback.

Fails OPEN on purpose: if the limiter itself errors (e.g. Redis blips), the
request is allowed rather than locking every user out over an ops problem. The
goal here is budget protection against abuse/runaway loops, not hard security.
"""
import time
import threading
from fastapi import HTTPException
from cache import get_redis

# in-process fallback: key -> (window_start_epoch, count)
_local = {}
_lock = threading.Lock()


def enforce(user_id: str, endpoint: str, max_calls: int, window_seconds: int):
    """Raise HTTP 429 if user_id has exceeded max_calls for endpoint in window."""
    key = f"rl:{user_id}:{endpoint}"
    try:
        count, ttl = _incr(key, window_seconds)
    except Exception:  # noqa: BLE001 — limiter must never take down a request
        return  # fail open
    if count > max_calls:
        raise HTTPException(
            status_code=429,
            detail=f"You're doing that too fast. Try again in about {ttl}s.",
        )


def _incr(key, window_seconds):
    """Increment the window counter, returning (count, seconds_until_reset)."""
    r = get_redis()
    if r is not None:
        count = r.incr(key)
        if count == 1:
            r.expire(key, window_seconds)
            ttl = window_seconds
        else:
            ttl = r.ttl(key)
            if ttl is None or ttl < 0:  # key with no TTL — repair it
                r.expire(key, window_seconds)
                ttl = window_seconds
        return count, ttl
    return _incr_local(key, window_seconds)


def _incr_local(key, window_seconds):
    now = time.time()
    with _lock:
        start, count = _local.get(key, (now, 0))
        if now - start >= window_seconds:
            start, count = now, 0
        count += 1
        _local[key] = (start, count)
        # opportunistic cleanup so the dict can't grow unbounded
        if len(_local) > 10000:
            for k, (s, _c) in list(_local.items()):
                if now - s >= window_seconds:
                    _local.pop(k, None)
        return count, int(window_seconds - (now - start))
