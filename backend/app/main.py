"""
KurdBox Backend v2.0 — FastAPI app factory.
Startup: init DB → load providers from DB → start health checker.
All routes mounted at /api/v1.
"""

import os
import json
import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

# Load .env manually if present (no python-dotenv dependency)
def _load_dotenv():
    env_file = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    os.environ.setdefault(k.strip(), v.strip())

_load_dotenv()

from app.storage.database import init_db, get_db_session
from app.storage.models import DBProvider, DBProviderKey, DBBudget
from app.providers.provider_orchestrator import provider_router
from app.providers.schemas import Provider
from app.providers.key_pool import PoolKey
from app.security.key_vault import decrypt
from app.chat.service import ChatService
from app.economy.budget_manager import budget_manager
from app.economy.router import router as budget_router
from app.analytics.rankings_service import RankingsService
from app.analytics.router import router as analytics_router
from app.infrastructure.health_monitor import HealthMonitor
from app.auth.router import router as auth_router
from app.providers.router import router as providers_router
from app.chat.router import router as chat_router
from app.auth.dependencies import get_current_user

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger("kurdbox")


# ── Startup / Shutdown ────────────────────────────────────────────────────────

def _load_providers() -> None:
    """Load providers + pool keys from DB into ProviderRouter (in-memory)."""
    try:
        with get_db_session() as db:
            for row in db.query(DBProvider).all():
                try:
                    models = json.loads(row.models) if row.models else []
                except Exception:
                    models = []
                p = Provider(
                    id=row.provider_id, name=row.name, base_url=row.base_url,
                    api_key=decrypt(row.api_key), models=models,
                    priority=max(row.priority, 1), weight=row.weight,
                    requests_today=row.requests_today or 0,
                    failures=row.failures or 0,
                    avg_latency_ms=row.avg_latency_ms or 0.0,
                    total_requests=row.total_requests or 0,
                    cooldown_until=row.cooldown_until or 0.0,
                )
                provider_router.add_provider(p)
                logger.info(f"Loaded provider: {row.provider_id} ({len(models)} models)")

            for row in db.query(DBProviderKey).filter(DBProviderKey.is_active == True).all():
                pk = PoolKey(
                    api_key=decrypt(row.api_key),
                    db_id=row.id,
                    label=row.label or "",
                    weight=row.weight or 10.0,
                    status=row.status or "active",
                    consecutive_failures=row.consecutive_failures or 0,
                    total_failures=row.failures or 0,
                    requests_count=row.requests_used or 0,
                    avg_latency_ms=row.avg_latency_ms or 0.0,
                    last_success=row.last_success or 0.0,
                    last_failure=row.last_failure or 0.0,
                    disabled_until=row.disabled_until or 0.0,
                )
                provider_router.add_pool_key(row.provider_id, pk)
    except Exception as e:
        logger.error(f"Failed to load providers: {e}")


def _load_budget() -> None:
    """Load persisted budget config from DB into BudgetManager."""
    try:
        with get_db_session() as db:
            row = db.query(DBBudget).first()
            if row:
                budget_manager.configure(row.daily_limit_usd, row.cheap_threshold_pct)
                budget_manager.spent_today_usd = row.spent_today_usd
                budget_manager._last_reset = row.last_reset or budget_manager._last_reset
                logger.info(f"Budget loaded: limit={row.daily_limit_usd} spent={row.spent_today_usd}")
    except Exception as e:
        logger.warning(f"Budget load skipped: {e}")


def _sync_budget_to_db() -> None:
    """Persist current BudgetManager state to DB (called via callback)."""
    try:
        with get_db_session() as db:
            row = db.query(DBBudget).first()
            if not row:
                row = DBBudget()
                db.add(row)
            row.daily_limit_usd = budget_manager.daily_limit_usd
            row.spent_today_usd = budget_manager.spent_today_usd
            row.cheap_threshold_pct = budget_manager.cheap_threshold_pct
            row.last_reset = budget_manager._last_reset
            db.commit()
    except Exception as e:
        logger.warning(f"Budget sync failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 KurdBox v2.0 starting…")

    # HTTP client (shared across requests)
    app.state.http_client = httpx.AsyncClient(timeout=60.0)

    # DB + providers + budget
    init_db()
    _load_providers()
    _load_budget()
    budget_manager.set_persist_callback(_sync_budget_to_db)

    # Services
    app.state.chat_service    = ChatService(provider_router, app.state.http_client)
    app.state.rankings        = RankingsService(provider_router)
    app.state.budget          = budget_manager
    app.state.health_monitor  = HealthMonitor(provider_router, app.state.http_client)
    app.state.health_monitor.start()

    logger.info("✅ KurdBox v2.0 ready")
    yield

    app.state.health_monitor.stop()
    await app.state.http_client.aclose()
    logger.info("🛑 KurdBox stopped")


# ── App factory ───────────────────────────────────────────────────────────────

def create_app() -> FastAPI:
    app = FastAPI(
        title="KurdBox API",
        description="AI Gateway — Smart LLM routing, key pooling, streaming",
        version="2.0.0",
        lifespan=lifespan,
    )

    # CORS
    origins = [o.strip() for o in
               os.environ.get("CORS_ORIGINS", "http://localhost:5000,http://localhost:5001").split(",")
               if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept"],
    )

    # Routers
    app.include_router(auth_router,      prefix="/api/v1")
    app.include_router(providers_router, prefix="/api/v1")
    app.include_router(chat_router,      prefix="/api/v1")
    app.include_router(budget_router,    prefix="/api/v1")
    app.include_router(analytics_router, prefix="/api/v1")

    # OpenAI-compatible endpoint
    @app.post("/v1/chat/completions", tags=["openai-compat"])
    async def openai_compat(
        request: Request,
        body: dict,
        _: dict = Depends(get_current_user),
    ):
        from app.chat.schemas import ChatRequest
        cr = ChatRequest(
            model=body.get("model", ""),
            messages=body.get("messages", []),
            max_tokens=body.get("max_tokens", 1024),
            temperature=body.get("temperature", 0.7),
            stream=body.get("stream", False),
        )
        svc = request.app.state.chat_service
        if cr.stream:
            return StreamingResponse(svc.stream_chat(cr), media_type="text/event-stream")
        try:
            return await svc.process_chat(cr)
        except Exception:
            raise HTTPException(status_code=503, detail="Service temporarily unavailable.")

    # Health
    @app.get("/api/v1/health", tags=["system"])
    async def health():
        active = sum(1 for p in provider_router.list_providers() if p.status == "active")
        return {"status": "ok", "version": "2.0.0", "providers_active": active}

    @app.get("/", include_in_schema=False)
    async def root():
        return JSONResponse({"name": "KurdBox API", "version": "2.0.0", "docs": "/docs"})

    @app.get("/dashboard", include_in_schema=False)
    async def dashboard():
        html = (Path(__file__).parent / "web" / "dashboard.html").read_text(encoding="utf-8")
        return HTMLResponse(html)

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5001"))
    uvicorn.run("app.main:app", host=host, port=port, reload=True)
