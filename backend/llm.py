"""llm.py — task-aware model router with automatic fallback.

Why this exists
---------------
Generation tasks differ wildly in difficulty. Mapping a whole handout into a
concept brain wants the strongest model available; writing a one-line topic
intro does not. And on the free tier, any single model's daily quota runs out.

So instead of one hardcoded GEN_MODEL, every generation call picks a TIER
(heavy / standard / light). Each tier is an ordered list of models, best first.
`generate()` walks that list: it uses the first model that works, and on a
quota cap (429) or an unavailable model (paid-only / not found) it automatically
falls through to the next one. A model that just hit its cap is put on a short
cooldown so we don't keep slamming it.

Net effect:
  * Complex tasks try the flagship first (e.g. gemini-3.1-pro), and the day you
    enable billing they start using it automatically — no code change.
  * On the free tier, paid-only models are skipped and the best *free* model
    (currently gemini-3.5-flash) is used instead.
  * When today's quota on one model is gone, the app keeps working on another.

Tiers are fully overridable from the environment (LLM_HEAVY / LLM_STANDARD /
LLM_LIGHT as comma-separated model ids), and LLM_FORCE_MODEL pins everything to
a single model when you want a hard override. Embeddings are NOT routed here —
they stay on gemini-embedding-001 (one model, separate quota, fixed dimensions).
"""

import os
import time
import random

_client = None


def init(client):
    """Hand the router the shared genai client (called once from main.py)."""
    global _client
    _client = client


# --- Tier definitions (best -> cheapest). Override any via env. ---

def _env_list(name, default):
    raw = (os.environ.get(name) or "").strip()
    if raw:
        return [m.strip() for m in raw.split(",") if m.strip()]
    return default


# Default chains, current as of mid-2026. Pro models are paid-only; on the free
# tier they error out and the router falls straight through to the Flash models.
TIERS = {
    # Hardest work: concept-brain extraction, scanned-PDF transcription, topic mining.
    "heavy": _env_list("LLM_HEAVY", [
        "gemini-3.1-pro",
        "gemini-3-pro",
        "gemini-3.5-flash",
        "gemini-3-flash",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
    ]),
    # Everyday generation: quizzes, tutor answers.
    "standard": _env_list("LLM_STANDARD", [
        "gemini-3-flash",
        "gemini-3.5-flash",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-3.1-flash-lite",
    ]),
    # Cheap, high-volume bits: topic intros, short rewrites.
    "light": _env_list("LLM_LIGHT", [
        "gemini-2.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3-flash",
        "gemini-2.5-flash",
    ]),
}

# Hard override: pin every tier to one model when set.
_FORCE = (os.environ.get("LLM_FORCE_MODEL") or "").strip()
if _FORCE:
    for _k in TIERS:
        TIERS[_k] = [_FORCE]

# The old single-model knob is superseded by tiered routing. Warn if it lingers
# so it isn't mistaken for being in effect.
if (os.environ.get("GEMINI_GEN_MODEL") or "").strip() and not _FORCE:
    print("[llm] Note: GEMINI_GEN_MODEL is set but no longer used — task-aware "
          "routing is active. Use LLM_FORCE_MODEL to pin a single model.")

_COOLDOWN = int(os.environ.get("LLM_COOLDOWN_SECONDS", "600"))          # quota/RPM rest
_UNAVAILABLE_COOLDOWN = int(os.environ.get("LLM_UNAVAILABLE_COOLDOWN", "3600"))  # paid-only/404 rest

_cooldown_until = {}   # model id -> epoch seconds when it's usable again
_last_used = None      # most recent model that successfully answered


def _is_cooling(model):
    until = _cooldown_until.get(model)
    return until is not None and time.time() < until


def _cool(model, seconds):
    _cooldown_until[model] = time.time() + seconds


def _classify(exc):
    """Bucket an SDK exception so we know whether to fall through or retry."""
    msg = (str(exc) or "").lower()
    code = getattr(exc, "code", None)
    if code is None:
        resp = getattr(exc, "response", None)
        code = getattr(resp, "status_code", None)
    if code == 429 or "resource_exhausted" in msg or "quota" in msg or "rate limit" in msg:
        return "quota"
    if code in (400, 403, 404) or "not found" in msg or "permission" in msg \
            or "does not exist" in msg or "not supported" in msg or "unsupported" in msg \
            or "billing" in msg or "only accessible to billed" in msg:
        return "unavailable"
    if code in (500, 502, 503, 504) or "unavailable" in msg or "overloaded" in msg \
            or "internal error" in msg or "deadline" in msg or "timeout" in msg:
        return "transient"
    return "other"


class AllModelsFailed(Exception):
    """Raised when every model in a tier failed (so callers can surface it)."""


def generate(tier, contents, *, config=None, retries_per_model=1):
    """Generate content using the best available model for `tier`.

    Returns (response, model_id_used). Raises AllModelsFailed if the whole tier
    is exhausted. `contents` and `config` are passed straight to the SDK, so
    multimodal Parts (e.g. a PDF) work exactly as before.
    """
    global _last_used
    if _client is None:
        raise RuntimeError("llm.init(client) was never called.")
    models = TIERS.get(tier) or TIERS["standard"]
    last_err = None

    # Pass 1 skips models on cooldown; pass 2 is a last-ditch retry of everything.
    for allow_cooling in (False, True):
        for model in models:
            if not allow_cooling and _is_cooling(model):
                continue
            attempt = 0
            while attempt <= retries_per_model:
                try:
                    resp = _client.models.generate_content(
                        model=model, contents=contents, config=config,
                    )
                    _cooldown_until.pop(model, None)   # it works — clear any cooldown
                    _last_used = model
                    return resp, model
                except Exception as e:                 # noqa: BLE001 — classify, don't crash
                    last_err = e
                    kind = _classify(e)
                    if kind == "quota":
                        _cool(model, _COOLDOWN)
                        break
                    if kind == "unavailable":
                        _cool(model, _UNAVAILABLE_COOLDOWN)
                        break
                    if kind == "transient" and attempt < retries_per_model:
                        time.sleep(0.5 * (attempt + 1) + random.random() * 0.4)
                        attempt += 1
                        continue
                    break  # "other", or retries spent -> move to next model

    raise AllModelsFailed(
        f"Every model for the '{tier}' task is unavailable right now "
        f"(last error: {last_err})."
    )


def status():
    """Snapshot of routing state for the /models debug endpoint."""
    now = time.time()
    return {
        "tiers": TIERS,
        "force_model": _FORCE or None,
        "last_used": _last_used,
        "cooling_down": {
            m: round(until - now, 1)
            for m, until in _cooldown_until.items() if until > now
        },
    }


def list_available():
    """Best-effort list of model ids the API key can actually see."""
    try:
        out = []
        for m in _client.models.list():
            name = getattr(m, "name", "") or ""
            out.append(name.split("/")[-1] if "/" in name else name)
        return sorted(set(out))
    except Exception as e:   # noqa: BLE001
        return {"error": str(e)}
