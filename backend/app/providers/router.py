"""
Provider management endpoints.
GET    /api/v1/providers                    — list active providers
GET    /api/v1/providers/supported          — list all supported provider types
POST   /api/v1/providers                    — add a provider
GET    /api/v1/providers/{id}               — get one provider
DELETE /api/v1/providers/{id}               — remove provider
POST   /api/v1/providers/{id}/enable        — re-enable
POST   /api/v1/providers/{id}/disable       — disable
GET    /api/v1/providers/{id}/keys          — list pool keys
POST   /api/v1/providers/{id}/keys          — add pool key
DELETE /api/v1/providers/{id}/keys/{kid}    — remove pool key
"""

import json
import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, require_admin
from app.providers.schemas import (
    Provider, ProviderAdd, ProviderUpdate, ProviderKeyAdd, ProviderKeyInfo
)
from app.providers.config import SUPPORTED_PROVIDERS, detect_provider_from_key
from app.providers.provider_orchestrator import provider_router
from app.providers.key_pool import PoolKey
from app.security.key_vault import encrypt
from app.storage.database import get_db
from app.storage.models import DBProvider, DBProviderKey

router = APIRouter(prefix="/providers", tags=["providers"])

_ID_RE = re.compile(r"^[a-z0-9_-]{1,64}$")


def _validate_id(provider_id: str) -> None:
    if not _ID_RE.match(provider_id):
        raise HTTPException(status_code=400, detail="Invalid provider_id format")


def _mask_key(key: str) -> str:
    """Return a safe preview — never expose full key to API clients."""
    return key[:8] + "…" + key[-4:] if len(key) > 12 else "****"


def _safe(p: Provider) -> Provider:
    """Return a copy of the provider with the api_key masked."""
    masked = p.model_copy()
    masked.api_key = _mask_key(p.api_key)
    return masked


# ── Supported list (no auth) ──────────────────────────────────────────────────

@router.get("/supported")
async def list_supported():
    return [
        {"id": pid, "name": cfg["name"], "key_hint": cfg["key_hint"],
         "pricing": cfg.get("pricing", {"input": 0, "output": 0})}
        for pid, cfg in SUPPORTED_PROVIDERS.items()
    ]


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[Provider])
async def list_providers(_: dict = Depends(get_current_user)):
    return [_safe(p) for p in provider_router.list_providers()]


@router.post("", response_model=Provider)
async def add_provider(
    body: ProviderAdd,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    api_key = body.api_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="API key cannot be empty")

    ptype = body.provider_type.strip().lower()
    if ptype in ("auto", "", "detect"):
        ptype = detect_provider_from_key(api_key)
        if not ptype:
            raise HTTPException(status_code=400, detail="Cannot auto-detect provider")

    cfg = SUPPORTED_PROVIDERS.get(ptype)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"Unknown provider '{ptype}'")

    if provider_router.get_provider(ptype):
        raise HTTPException(status_code=409, detail=f"Provider '{ptype}' already added")

    p = Provider(id=ptype, name=cfg["name"], base_url=cfg["base_url"],
                 api_key=api_key, models=cfg["models"],
                 priority=cfg["priority"], weight=cfg["weight"])
    provider_router.add_provider(p)

    try:
        db.add(DBProvider(
            provider_id=ptype, name=cfg["name"], base_url=cfg["base_url"],
            api_key=encrypt(api_key), models=json.dumps(cfg["models"]),
            priority=cfg["priority"], weight=cfg["weight"],
        ))
        db.commit()
    except Exception:
        provider_router.remove_provider(ptype)
        raise

    # Never return plaintext api_key to client
    p.api_key = "****"
    return p


@router.get("/{provider_id}", response_model=Provider)
async def get_provider(provider_id: str, _: dict = Depends(get_current_user)):
    _validate_id(provider_id)
    p = provider_router.get_provider(provider_id)
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    return _safe(p)


@router.delete("/{provider_id}")
async def remove_provider(
    provider_id: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    _validate_id(provider_id)
    if not provider_router.remove_provider(provider_id):
        raise HTTPException(status_code=404, detail="Provider not found")
    db.query(DBProvider).filter(DBProvider.provider_id == provider_id).delete()
    db.query(DBProviderKey).filter(DBProviderKey.provider_id == provider_id).delete()
    db.commit()
    return {"detail": f"Provider '{provider_id}' removed"}


@router.post("/{provider_id}/enable")
async def enable_provider(provider_id: str, _: dict = Depends(require_admin)):
    _validate_id(provider_id)
    p = provider_router.get_provider(provider_id)
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    from app.providers.schemas import ProviderStatus
    p.status = ProviderStatus.ACTIVE
    p.failures = 0
    p.cooldown_until = 0.0
    return {"detail": "enabled"}


@router.post("/{provider_id}/disable")
async def disable_provider(provider_id: str, _: dict = Depends(require_admin)):
    _validate_id(provider_id)
    p = provider_router.get_provider(provider_id)
    if not p:
        raise HTTPException(status_code=404, detail="Provider not found")
    from app.providers.schemas import ProviderStatus
    p.status = ProviderStatus.INACTIVE
    return {"detail": "disabled"}


# ── Key Pool ──────────────────────────────────────────────────────────────────

@router.get("/{provider_id}/keys", response_model=List[ProviderKeyInfo])
async def list_keys(provider_id: str, _: dict = Depends(get_current_user)):
    _validate_id(provider_id)
    if not provider_router.get_provider(provider_id):
        raise HTTPException(status_code=404, detail="Provider not found")
    keys = provider_router.get_pool_keys(provider_id)
    return [
        ProviderKeyInfo(
            id=k.db_id, provider_id=provider_id, label=k.label or None,
            is_active=k.status != "disabled", status=k.status, weight=k.weight,
            requests_used=k.requests_count, failures=k.total_failures,
            consecutive_failures=k.consecutive_failures,
            avg_latency_ms=round(k.avg_latency_ms, 1),
            last_success=k.last_success, last_failure=k.last_failure,
            key_preview=k.api_key[:8] + "…" + k.api_key[-4:] if len(k.api_key) > 12 else "****",
        )
        for k in keys
    ]


@router.post("/{provider_id}/keys", response_model=ProviderKeyInfo)
async def add_key(
    provider_id: str,
    body: ProviderKeyAdd,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    _validate_id(provider_id)
    if not provider_router.get_provider(provider_id):
        raise HTTPException(status_code=404, detail="Provider not found")
    api_key = body.api_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="Key cannot be empty")

    row = DBProviderKey(
        provider_id=provider_id, api_key=encrypt(api_key),
        label=body.label, weight=body.weight or 10.0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    pk = PoolKey(api_key=api_key, db_id=row.id, label=body.label or "", weight=body.weight or 10.0)
    provider_router.add_pool_key(provider_id, pk)

    return ProviderKeyInfo(
        id=row.id, provider_id=provider_id, label=row.label, is_active=True,
        status="active", weight=row.weight, requests_used=0, failures=0,
        consecutive_failures=0, avg_latency_ms=0.0, last_success=0.0, last_failure=0.0,
        key_preview=api_key[:8] + "…" + api_key[-4:] if len(api_key) > 12 else "****",
    )


@router.post("/{provider_id}/keys/{key_id}/recover")
async def recover_key(
    provider_id: str, key_id: int,
    _: dict = Depends(require_admin),
):
    _validate_id(provider_id)
    pool = provider_router.get_pool_keys(provider_id)
    for pk in pool:
        if pk.db_id == key_id:
            pk.status = "active"
            pk.consecutive_failures = 0
            pk.disabled_until = 0.0
            return {"detail": f"Key {key_id} recovered"}
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Key not found")


@router.delete("/{provider_id}/keys/{key_id}")
async def remove_key(
    provider_id: str, key_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    _validate_id(provider_id)
    row = db.query(DBProviderKey).filter(
        DBProviderKey.id == key_id, DBProviderKey.provider_id == provider_id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Key not found")
    provider_router.remove_pool_key(provider_id, key_id)
    db.delete(row)
    db.commit()
    return {"detail": f"Key {key_id} removed"}
