"""
economy/router.py — Budget management endpoints.
GET  /api/v1/budget       — get current budget state
POST /api/v1/budget       — configure daily limit
POST /api/v1/budget/reset — reset spent_today to 0
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from typing import Optional

from app.auth.dependencies import get_current_user, require_admin

router = APIRouter(prefix="/budget", tags=["budget"])


class BudgetConfig(BaseModel):
    daily_limit_usd: float
    cheap_threshold_pct: Optional[float] = 0.9


@router.get("", dependencies=[Depends(get_current_user)])
async def get_budget(request: Request):
    return request.app.state.budget.to_dict()


@router.post("", dependencies=[Depends(require_admin)])
async def set_budget(body: BudgetConfig, request: Request):
    request.app.state.budget.configure(body.daily_limit_usd, body.cheap_threshold_pct)
    return request.app.state.budget.to_dict()


@router.post("/reset", dependencies=[Depends(require_admin)])
async def reset_budget(request: Request):
    request.app.state.budget.reset()
    return request.app.state.budget.to_dict()
