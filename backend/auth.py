import os
from fastapi import HTTPException, Header
from supabase import create_client

_sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])


async def verify_user(authorization: str = Header(...)) -> str:
    """Verify a Supabase JWT and return the caller's user_id.

    Raises 401 when the header is missing or the token is invalid/expired.
    Add as a FastAPI dependency: user_id: str = Depends(verify_user)
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = authorization[7:].strip()
    try:
        result = _sb.auth.get_user(token)
        if not result or not result.user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return result.user.id
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token verification failed")
