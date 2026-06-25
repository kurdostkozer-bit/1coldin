"""
key_vault.py — Fernet AES-128 encryption for API keys + JWT helpers.
Responsibilities:
  - encrypt(plaintext) / decrypt(stored): API key vault (enc: prefix protocol)
  - create_token / verify_token: JWT HS256 auth tokens
Rules:
  - Plaintext keys NEVER logged, never returned in API responses
  - Encrypted prefix "enc:" distinguishes encrypted values from legacy plaintext
"""
from __future__ import annotations

import os
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from jose import jwt, JWTError
from fastapi import HTTPException, status

logger = logging.getLogger("kurdbox.security")

# ── Fernet key loading ────────────────────────────────────────────────────────

_ENC_KEY_FILE = Path(__file__).parent.parent.parent / ".kurdost_enc_key"
_ENCRYPTED_PREFIX = "enc:"


def _load_or_create_fernet_key() -> bytes:
    env_key = os.environ.get("KURDOST_ENCRYPTION_KEY", "").strip()
    if env_key:
        return env_key.encode()

    if _ENC_KEY_FILE.exists():
        try:
            key = _ENC_KEY_FILE.read_bytes().strip()
            if len(key) >= 44:
                return key
        except OSError as e:
            logger.warning(f"Could not read encryption key file: {e}")

    key = Fernet.generate_key()
    try:
        _ENC_KEY_FILE.write_bytes(key)
        _ENC_KEY_FILE.chmod(0o600)
        logger.info("Generated new Fernet key → .kurdost_enc_key")
    except Exception as e:
        logger.warning(f"Could not persist encryption key: {e}")
    return key


_fernet = Fernet(_load_or_create_fernet_key())

# ── API Key encrypt / decrypt ─────────────────────────────────────────────────


def encrypt(plaintext: str) -> str:
    """Encrypt an API key for DB storage. Idempotent — already-encrypted values pass through."""
    if not plaintext:
        return plaintext
    if plaintext.startswith(_ENCRYPTED_PREFIX):
        return plaintext
    return _ENCRYPTED_PREFIX + _fernet.encrypt(plaintext.encode()).decode()


def decrypt(stored: str) -> str:
    """Decrypt a stored API key. Legacy unencrypted values returned as-is."""
    if not stored:
        return stored
    if not stored.startswith(_ENCRYPTED_PREFIX):
        logger.debug("Returning legacy unencrypted key as-is")
        return stored
    try:
        return _fernet.decrypt(stored[len(_ENCRYPTED_PREFIX):].encode()).decode()
    except InvalidToken:
        logger.error("Failed to decrypt API key — wrong key or corrupted data")
        raise ValueError("Cannot decrypt API key: invalid token or key mismatch")


def is_encrypted(value: str) -> bool:
    return bool(value) and value.startswith(_ENCRYPTED_PREFIX)


# ── JWT ───────────────────────────────────────────────────────────────────────

_JWT_SECRET = os.getenv("KURDOST_SECRET_KEY", "")
if not _JWT_SECRET:
    raise RuntimeError("KURDOST_SECRET_KEY environment variable is not set")

_ALGORITHM = "HS256"
_EXPIRE_MINUTES = 480  # 8 hours


def create_token(sub: str, username: str, expires_minutes: Optional[int] = None, is_admin: bool = False) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes or _EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": sub, "username": username, "exp": expire, "is_admin": is_admin},
        _JWT_SECRET, algorithm=_ALGORITHM,
    )


def verify_token(token: str) -> dict:
    try:
        return jwt.decode(token, _JWT_SECRET, algorithms=[_ALGORITHM])
    except JWTError as e:
        logger.debug(f"Token verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
