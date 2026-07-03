import os
import json
import urllib.request
from fastapi import HTTPException, Header

_URL = os.environ["SUPABASE_URL"].rstrip("/")
_KEY = os.environ["SUPABASE_SERVICE_KEY"]


def verify_user(authorization: str = Header(...)) -> str:
    """Verify a Supabase JWT and return the caller's user_id.

    We ask GoTrue directly (GET /auth/v1/user with the caller's token) rather
    than using supabase-py's `client.auth.get_user()`. On a service-key client
    that call could resolve to the WRONG user (it leans on the client's own
    session state), which caused owners to get 403 on their own data — and is a
    latent cross-user risk. A direct, stateless HTTP call always returns the
    identity of exactly the token passed.

    Raises 401 when the header is missing or the token is invalid/expired.
    Add as a FastAPI dependency: user_id: str = Depends(verify_user)
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization[7:].strip()
    req = urllib.request.Request(
        f"{_URL}/auth/v1/user",
        headers={"apikey": _KEY, "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    uid = data.get("id")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return uid
