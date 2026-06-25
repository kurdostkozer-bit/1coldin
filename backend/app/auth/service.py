"""
Auth service — password hashing, token creation, user management.
Depends on security/key_vault for JWT operations.
"""
from __future__ import annotations

import logging
from typing import Optional

import bcrypt

from app.security.key_vault import create_token, verify_token

logger = logging.getLogger("kurdbox.auth")


class AuthService:

    @staticmethod
    def hash_password(password: str) -> str:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    @staticmethod
    def verify_password(plain: str, hashed: str) -> bool:
        try:
            return bcrypt.checkpw(plain.encode(), hashed.encode())
        except (ValueError, TypeError) as e:
            logger.warning(f"Password verify error: {e}")
            return False

    @staticmethod
    def create_token(sub: str, username: str, expires_delta: Optional[int] = None, is_admin: bool = False) -> str:
        return create_token(sub, username, expires_delta, is_admin)

    @staticmethod
    def verify_token(token: str) -> dict:
        return verify_token(token)


