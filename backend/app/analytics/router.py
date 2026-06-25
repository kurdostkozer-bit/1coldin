"""
analytics/router.py — Rankings, stats, and alias endpoints.
GET /api/v1/rankings  — live provider ranking by score
GET /api/v1/stats     — aggregate provider stats
GET /api/v1/aliases   — model alias map
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.providers.aliases import MODEL_ALIASES
from app.storage.database import get_db
from app.storage.models import DBUsageRecord

router = APIRouter(tags=["analytics"])


@router.get("/rankings", dependencies=[Depends(get_current_user)])
async def get_rankings(request: Request):
    return request.app.state.rankings.get_rankings()


@router.get("/stats", dependencies=[Depends(get_current_user)])
async def get_stats(request: Request):
    return request.app.state.rankings.get_stats()


@router.get("/aliases")
async def get_aliases():
    return MODEL_ALIASES


@router.get("/usage", dependencies=[Depends(get_current_user)])
async def get_usage(
    provider_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    q = db.query(DBUsageRecord)
    if provider_id:
        q = q.filter(DBUsageRecord.provider_id == provider_id)
    rows = q.order_by(DBUsageRecord.timestamp.desc()).limit(limit).all()
    return [
        {
            "id": r.id,
            "provider_id": r.provider_id,
            "model": r.model,
            "tokens_used": r.tokens_used,
            "prompt_tokens": r.prompt_tokens,
            "completion_tokens": r.completion_tokens,
            "latency_ms": r.latency_ms,
            "success": r.success,
            "estimated_cost_usd": r.estimated_cost_usd,
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
        }
        for r in rows
    ]
