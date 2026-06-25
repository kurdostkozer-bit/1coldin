"""
Auth endpoints.
POST /api/v1/auth/register    — create account (first user becomes admin)
POST /api/v1/auth/login       — username + password → JWT
GET  /api/v1/auth/me          — requires valid JWT
"""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth.service import AuthService
from app.auth.schemas import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.auth.dependencies import get_current_user
from app.storage.database import get_db
from app.storage.models import DBUser

logger = logging.getLogger("kurdbox.auth")
router = APIRouter(prefix="/auth", tags=["auth"])

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, db: Session = Depends(get_db)):
    if not _USERNAME_RE.match(body.username):
        raise HTTPException(status_code=400, detail="Invalid username format.")
    if db.query(DBUser).filter(DBUser.username == body.username).first():
        raise HTTPException(status_code=409, detail="Username already taken.")
    # First registered user automatically becomes admin
    is_first_user = db.query(DBUser).count() == 0
    user = DBUser(
        username=body.username,
        email=body.email,
        hashed_password=AuthService.hash_password(body.password),
        is_admin=is_first_user,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info(f"New user registered: {body.username} (admin={user.is_admin})")
    return TokenResponse(access_token=AuthService.create_token(str(user.id), user.username, is_admin=user.is_admin))


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: Session = Depends(get_db)):
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
