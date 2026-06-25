"""
analytics/rankings_service.py — Provider intelligence & ranking.
Responsibilities:
  - Compute live provider rankings by composite score
  - Aggregate usage stats across providers
  - Return history snapshots
  - Pure reads from ProviderRouter — no writes
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, List, Optional

if TYPE_CHECKING:
    from app.providers.router_service import ProviderRouter

logger = logging.getLogger("kurdbox.analytics")


class RankingsService:

    def __init__(self, router: "ProviderRouter") -> None:
        self._router = router

    # ── Rankings ──────────────────────────────────────────────────────────────

    def get_rankings(self) -> List[dict]:
        """Live provider ranking sorted by composite score (success_rate + latency)."""
        providers = self._router.list_providers()
        rankings = []
        for p in providers:
            pool       = self._router.get_pool_keys(p.id)
            active_keys = sum(1 for k in pool if k.status == "active")
            score      = (
                (100 - p.failures * 10) * 0.6 +
                (1000 / (p.avg_latency_ms + 1)) * 0.4
            )
            rankings.append({
                "provider_id":    p.id,
                "name":           p.name,
                "status":         p.status,
                "avg_latency_ms": round(p.avg_latency_ms, 2),
                "failures":       p.failures,
                "requests_today": p.requests_today,
                "total_requests": p.total_requests,
                "total_cost_usd": round(p.total_cost_usd, 6),
                "pool_keys":      len(pool),
                "active_keys":    active_keys,
                "score":          round(score, 2),
            })
        return sorted(rankings, key=lambda x: x["score"], reverse=True)

    # ── Stats ─────────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        """Aggregate stats across all providers (no usage history required)."""
        providers = self._router.list_providers()
        total_req  = sum(p.total_requests for p in providers)
        total_cost = sum(p.total_cost_usd for p in providers)
        active     = sum(1 for p in providers if p.status == "active")

        return {
            "total_providers":  len(providers),
            "active_providers": active,
            "total_requests":   total_req,
            "total_cost_usd":   round(total_cost, 6),
            "providers":        {
                p.id: {
                    "status":         p.status,
                    "requests_today": p.requests_today,
                    "total_requests": p.total_requests,
                    "avg_latency_ms": round(p.avg_latency_ms, 2),
                    "failures":       p.failures,
                    "total_cost_usd": round(p.total_cost_usd, 6),
                    "pool_size":      len(self._router.get_pool_keys(p.id)),
                }
                for p in providers
            },
        }
