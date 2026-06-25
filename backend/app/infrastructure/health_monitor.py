"""
infrastructure/health_monitor.py — Provider health checking loop.
Responsibilities:
  - Periodic HTTP health checks against provider /models endpoints
  - Auto-restore COOLDOWN providers that pass health check
  - Decoupled from routing logic — communicates via ProviderRouter interface
"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    import httpx
    from app.providers.router_service import ProviderRouter

logger = logging.getLogger("kurdbox.health")

HEALTH_CHECK_INTERVAL = 30  # seconds
HEALTH_CHECK_TIMEOUT  = 8.0


class HealthMonitor:

    def __init__(self, router: "ProviderRouter", http_client: "httpx.AsyncClient") -> None:
        self._router = router
        self._http   = http_client
        self._task: Optional[asyncio.Task] = None

    def start(self) -> None:
        """Start the background health check loop as an async task."""
        self._task = asyncio.create_task(self._loop())
        logger.info("HealthMonitor started")

    def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            logger.info("HealthMonitor stopped")

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(HEALTH_CHECK_INTERVAL)
            await self._check_all()

    async def _check_all(self) -> None:
        from app.providers.schemas import ProviderStatus
        from app.security.key_vault import decrypt

        for p in self._router.list_providers():
            if p.status == ProviderStatus.INACTIVE:
                continue

            try:
                r = await self._http.get(
                    p.base_url.rstrip("/") + "/models",
                    headers={"Authorization": f"Bearer {decrypt(p.api_key)}"},
                    timeout=HEALTH_CHECK_TIMEOUT,
                )
                if r.status_code < 500:
                    if p.status == ProviderStatus.COOLDOWN:
                        self._router.restore_provider(p.id)
                        logger.info(f"✅ {p.id} health check passed — restored from cooldown")
                    else:
                        logger.debug(f"✅ {p.id} health check OK (status={p.status})")
                else:
                    logger.warning(f"⚠️ {p.id} health check returned HTTP {r.status_code}")
            except Exception as e:
                logger.debug(f"Health check failed {p.id}: {e}")
