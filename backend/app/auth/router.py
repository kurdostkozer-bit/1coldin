"""
Auth endpoints.
POST /api/v1/auth/register    — create account (first user becomes admin)
POST /api/v1/auth/login       — username + password → JWT
GET  /api/v1/auth/me          — requires valid JWT
GET  /api/v1/auth/token       — refresh JWT
"""
from __future__ import annotations

import logging
import re
import time

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session

from app.auth.service import AuthService
from app.auth.schemas import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.auth.dependencies import get_current_user
from app.storage.database import get_db
from app.storage.models import DBUser

logger = logging.getLogger("kurdbox.auth")
router = APIRouter(prefix="/auth", tags=["auth"])

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")

# Simple in-memory rate limiting for login attempts
_login_attempts: dict[str, tuple[int, float]] = {}
_MAX_LOGIN_ATTEMPTS = 5
_LOGIN_WINDOW_SECONDS = 60


def _check_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else 'unknown'
    now = time.time()
    count, first = _login_attempts.get(ip, (0, now))
    if now - first > _LOGIN_WINDOW_SECONDS:
        count, first = 0, now
    count += 1
    _login_attempts[ip] = (count, first)
    if count > _MAX_LOGIN_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many login attempts. Please wait 1 minute.")


def _validate_password(password: str) -> str:
    if len(password) < 8:
        return "Password must be at least 8 characters."
    if not re.search(r'[A-Z]', password):
        return "Password must contain at least one uppercase letter."
    if not re.search(r'[a-z]', password):
        return "Password must contain at least one lowercase letter."
    if not re.search(r'[0-9]', password):
        return "Password must contain at least one digit."
    return ""


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    if not _USERNAME_RE.match(body.username):
        raise HTTPException(status_code=400, detail="Invalid username format.")
    if body.email and not _EMAIL_RE.match(body.email):
        raise HTTPException(status_code=400, detail="Invalid email format.")
    pwd_error = _validate_password(body.password)
    if pwd_error:
        raise HTTPException(status_code=400, detail=pwd_error)
    if db.query(DBUser).filter(DBUser.username == body.username).first():
        raise HTTPException(status_code=409, detail="Username already taken.")
    if body.email and db.query(DBUser).filter(DBUser.email == body.email).first():
        raise HTTPException(status_code=409, detail="Email already taken.")
    # First registered user automatically becomes admin
    is_first_user = db.query(DBUser).count() == 0
    user = DBUser(
        username=body.username,
        email=body.email,
        hashed_password=AuthService.hash_password(body.password),
        is_admin=is_first_user,
    )
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except Exception as e:
        db.rollback()
        logger.error(f"Registration DB error: {e}")
        raise HTTPException(status_code=500, detail="Registration failed. Please try again.")
    logger.info(f"New user registered: {body.username} (admin={user.is_admin})")
    return TokenResponse(access_token=AuthService.create_token(str(user.id), user.username, is_admin=user.is_admin))


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    _check_rate_limit(request)
    if not _USERNAME_RE.match(body.username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Invalid username format.")
    user = db.query(DBUser).filter(DBUser.username == body.username).first()
    if not user or not AuthService.verify_password(body.password, user.hashed_password):
        logger.warning(f"Failed login attempt for username='{body.username}'")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Account is disabled.")
    return TokenResponse(access_token=AuthService.create_token(str(user.id), user.username, is_admin=user.is_admin))


@router.get("/token")
async def get_token(current_user: dict = Depends(get_current_user)):
    """Return a fresh JWT for the authenticated user."""
    return {"token": AuthService.create_token(
        current_user["sub"],
        current_user.get("username", ""),
        is_admin=bool(current_user.get("is_admin")),
    )}


@router.get("/me", response_model=UserResponse)
async def me(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = int(current_user["sub"])
    db_user = db.query(DBUser).filter(DBUser.id == user_id).first()
    if db_user:
        return UserResponse(
            id=db_user.id,
            username=db_user.username,
            email=db_user.email,
            is_active=db_user.is_active,
            created_at=str(db_user.created_at) if db_user.created_at else None,
        )
    return UserResponse(
        id=user_id,
        username=current_user.get("username", "unknown"),
        is_active=True,
    )


# ── Demo token (for development / dashboard testing) ─────────────────────────

@router.post("/demo-token", response_model=TokenResponse)
async def demo_token():
    """Return a demo token for quick testing. Disabled in production unless DEMO_MODE is set."""
    import os
    if os.environ.get("DEMO_MODE") not in ("true", "1", "yes"):
        raise HTTPException(status_code=403, detail="Demo mode is disabled.")
    return TokenResponse(access_token=AuthService.create_token("0", "demo", is_admin=True))
