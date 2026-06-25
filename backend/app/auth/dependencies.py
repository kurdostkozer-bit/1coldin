"""
FastAPI dependency: get_current_user, require_admin
Validates JWT from Authorization: Bearer header.
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.auth.service import AuthService

_bearer = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    payload = AuthService.verify_token(credentials.credentials)
    if "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )
    return payload


def require_admin(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Only admin users can access this endpoint."""
    if not current_user.get("is_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user
