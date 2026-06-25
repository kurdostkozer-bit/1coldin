"""
ProviderRouter — in-memory provider registry + routing.
Owns: provider state, key pools, health metrics.
Ported from old state.py OrchestratorState with clean interface.
"""

import time
import random
import logging
import threading
from datetime import datetime, timezone
from typing import Callable, Dict, List, Optional

from app.providers.schemas import Provider, ProviderStatus
from app.providers.key_pool import PoolKey
from app.security import key_vault
from app.economy.budget_manager import budget_manager

logger = logging.getLogger("kurdbox.router")

COOLDOWN_SECONDS = 60
FAILURE_THRESHOLD = 3


class ProviderRouter:

    def __init__(self) -> None:
        self._providers: Dict[str, Provider] = {}
        self._key_pools: Dict[str, List[PoolKey]] = {}
        self._lock = threading.RLock()
        self._rr_index: int = 0
        self._stats_callback: Optional[Callable[[str], None]] = None
        self._last_reset_day: int = datetime.now(timezone.utc).day

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def set_stats_callback(self, cb: Callable[[str], None]) -> None:
        self._stats_callback = cb

    # ── Provider CRUD ─────────────────────────────────────────────────────────

    def add_provider(self, provider: Provider) -> None:
        with self._lock:
            self._providers[provider.id] = provider
            if provider.id not in self._key_pools:
                self._key_pools[provider.id] = []

    def remove_provider(self, provider_id: str) -> bool:
        with self._lock:
            if provider_id not in self._providers:
                return False
            del self._providers[provider_id]
            self._key_pools.pop(provider_id, None)
            return True

    def get_provider(self, provider_id: str) -> Optional[Provider]:
        with self._lock:
            return self._providers.get(provider_id)

    def list_providers(self) -> List[Provider]:
        with self._lock:
            return list(self._providers.values())

    # ── Key Pool ──────────────────────────────────────────────────────────────

    def add_pool_key(self, provider_id: str, key: PoolKey) -> bool:
        with self._lock:
            if provider_id not in self._providers:
                return False
            existing = [k.api_key for k in self._key_pools.get(provider_id, [])]
            if key.api_key not in existing:
                self._key_pools.setdefault(provider_id, []).append(key)
            return True

    def remove_pool_key(self, provider_id: str, key_id: int) -> bool:
        with self._lock:
            pool = self._key_pools.get(provider_id, [])
            before = len(pool)
            self._key_pools[provider_id] = [k for k in pool if k.db_id != key_id]
            return len(self._key_pools[provider_id]) < before

    def get_pool_keys(self, provider_id: str) -> List[PoolKey]:
        with self._lock:
            return list(self._key_pools.get(provider_id, []))

    def pick_key_for_provider(self, provider: Provider) -> tuple[str, Optional[PoolKey]]:
        with self._lock:
            pool = self._key_pools.get(provider.id, [])
            for k in pool:
                k.try_recover()
            active = [k for k in pool if k.status != "disabled"]
            if not active:
                return provider.api_key, None
            weights = [k.effective_weight() for k in active]
            total = sum(weights)
            if total == 0:
                return provider.api_key, None
            r = random.random() * total
            cumulative = 0.0
            for key, w in zip(active, weights):
                cumulative += w
                if r < cumulative:
                    return key.api_key, key
            return active[-1].api_key, active[-1]

    # ── Daily reset ───────────────────────────────────────────────────────────

    def _maybe_reset_daily(self) -> None:
        """Reset requests_today counter at UTC midnight. Called inside lock."""
        today = datetime.now(timezone.utc).day
        if today != self._last_reset_day:
            self._last_reset_day = today
            for p in self._providers.values():
                p.requests_today = 0
            logger.info("Daily request counters reset")

    # ── Routing ───────────────────────────────────────────────────────────────

    def _available(self, model: Optional[str] = None) -> List[Provider]:
        now = time.time()
        result = []
        for p in self._providers.values():
            if p.status == ProviderStatus.COOLDOWN and now >= p.cooldown_until:
                p.status = ProviderStatus.ACTIVE
                p.failures = 0
            if p.status in (ProviderStatus.INACTIVE, ProviderStatus.COOLDOWN):
                continue
            if model and p.models and model not in p.models:
                continue
            result.append(p)
        return result

    def pick_provider(
        self,
        model: Optional[str] = None,
        strategy: str = "smart",
        hint: Optional[str] = None,
    ) -> Optional[Provider]:
        with self._lock:
            if hint and hint in self._providers:
                p = self._providers[hint]
                if p.status == ProviderStatus.ACTIVE:
                    return p
            candidates = self._available(model)
            if not candidates:
                return None
            if strategy == "priority":
                return min(candidates, key=lambda p: p.priority)
            if strategy == "lowest_latency":
                return min(candidates, key=lambda p: p.avg_latency_ms or float("inf"))
            if strategy == "round_robin":
                p = candidates[self._rr_index % len(candidates)]
                self._rr_index += 1
                return p
            # smart
            def score(p: Provider) -> float:
                return (1.0 / (p.avg_latency_ms + 1) * 0.4 +
                        1.0 / max(p.priority, 1) * 0.6) * p.weight - p.failures * 0.2
            return max(candidates, key=score)

    def find_provider_for_model(self, model: str) -> Optional[Provider]:
        with self._lock:
            candidates = self._available(model)
            if not candidates:
                return None
            return max(candidates, key=lambda p: (p.priority == 1, -p.avg_latency_ms))

    # ── Record outcomes ───────────────────────────────────────────────────────

    def record_success(self, provider_id: str, latency_ms: float,
                       model: str = "", cost_usd: float = 0.0,
                       tokens: int = 0, prompt_tokens: int = 0,
                       completion_tokens: int = 0) -> None:
        with self._lock:
            self._maybe_reset_daily()
            p = self._providers.get(provider_id)
            if not p:
                return
            p.total_requests += 1
            p.requests_today += 1
            p.last_success = time.time()
            p.failures = 0
            p.avg_latency_ms = (latency_ms if p.avg_latency_ms == 0
                                 else p.avg_latency_ms * 0.8 + latency_ms * 0.2)
            p.total_cost_usd += cost_usd
        if cost_usd > 0:
            budget_manager.add_cost(cost_usd)
        if self._stats_callback:
            self._stats_callback(provider_id)

    def record_failure(self, provider_id: str, model: str = "", error: str = "") -> None:
        with self._lock:
            self._maybe_reset_daily()
            p = self._providers.get(provider_id)
            if not p:
                return
            p.total_requests += 1
            p.requests_today += 1
            p.failures += 1
            p.last_failure = time.time()
            if p.failures >= FAILURE_THRESHOLD and p.status != ProviderStatus.LIMITED:
                p.status = ProviderStatus.COOLDOWN
                p.cooldown_until = time.time() + COOLDOWN_SECONDS
        if self._stats_callback:
            self._stats_callback(provider_id)

    def mark_limited(self, provider_id: str) -> None:
        with self._lock:
            p = self._providers.get(provider_id)
            if p:
                p.status = ProviderStatus.LIMITED

    def restore_provider(self, provider_id: str) -> None:
        """Restore a COOLDOWN provider to ACTIVE (called by HealthMonitor)."""
        with self._lock:
            p = self._providers.get(provider_id)
            if p and p.status == ProviderStatus.COOLDOWN:
                p.status = ProviderStatus.ACTIVE
                p.failures = 0

    def record_key_success(self, provider_id: str,
                           pool_key: Optional[PoolKey], latency_ms: float) -> None:
        if pool_key:
            with self._lock:
                pool_key.record_success(latency_ms)

    def record_key_failure(self, provider_id: str, pool_key: Optional[PoolKey]) -> None:
        if pool_key:
            with self._lock:
                pool_key.record_failure()


# ── Singleton ─────────────────────────────────────────────────────────────────
provider_router = ProviderRouter()
