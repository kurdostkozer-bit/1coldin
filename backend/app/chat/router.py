"""
Chat endpoints.
POST /api/v1/chat         — non-stream + stream (unified via stream:true in body)
POST /api/v1/chat/stream  — always streams
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request, HTTPException, status
from fastapi.responses import StreamingResponse, JSONResponse

from app.auth.dependencies import get_current_user
from app.chat.schemas import ChatRequest

logger = logging.getLogger("kurdbox.chat.router")
router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("")
async def chat(
    request: Request,
    body: ChatRequest,
    _: dict = Depends(get_current_user),
):
    svc = request.app.state.chat_service
    if body.stream:
        return StreamingResponse(
            svc.stream_chat(body),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    try:
        return await svc.process_chat(body)
    except Exception as e:
        logger.warning(f"Chat request failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service temporarily unavailable. Please try again later.",
        )


@router.post("/stream")
async def chat_stream(
    request: Request,
    body: ChatRequest,
    _: dict = Depends(get_current_user),
):
    svc = request.app.state.chat_service
    return StreamingResponse(
        svc.stream_chat(body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
