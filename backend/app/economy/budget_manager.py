"""
economy/budget_manager.py — Daily budget tracking service.
Responsibilities:
  - Track daily spend per server lifetime
  - Enforce hard limit (reject routing when exceeded)
  - Soft threshold for cheap-model fallback
  - Thread-safe (own Lock, not shared with router)
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Callable, Optional

logger = logging.getLogger("kurdbox.budget")


class BudgetManager:

    def __init__(self) -> None:
        self.daily_limit_usd: float = 0.0
        self.spent_today_usd: float = 0.0
        self.cheap_threshold_pct: float = 0.9
        self._last_reset: float = time.time()
        self._lock = threading.Lock()
        self._persist_callback: Optional[Callable[[], None]] = None

    def set_persist_callback(self, fn: Callable[[], None]) -> None:
        """Inject a callback that syncs budget state to DB (called after mutations)."""
        self._persist_callback = fn

    def _persist(self) -> None:
        if self._persist_callback:
            try:
                self._persist_callback()
            except Exception as e:
                logger.warning(f"Budget persist failed (non-critical): {e}")

    # ── Checks ────────────────────────────────────────────────────────────────

    def is_enabled(self) -> bool:
        return self.daily_limit_usd > 0

    def is_tight(self) -> bool:
        """True when spend ≥ cheap_threshold. Triggers cheap-model fallback."""
        if not self.is_enabled():
            return False
        return self.spent_today_usd >= self.daily_limit_usd * self.cheap_threshold_pct

    def is_exceeded(self) -> bool:
        """True when daily limit is fully consumed. Blocks all routing."""
        if not self.is_enabled():
            return False
        return self.spent_today_usd >= self.daily_limit_usd

    # ── Mutations ─────────────────────────────────────────────────────────────

    def add_cost(self, cost_usd: float) -> None:
        with self._lock:
            self._check_daily_reset()
            self.spent_today_usd += cost_usd
        self._persist()

    def reset(self) -> None:
        with self._lock:
            self.spent_today_usd = 0.0
            self._last_reset = time.time()
            logger.info("Budget manually reset")
        self._persist()

    def configure(self, daily_limit_usd: float, cheap_threshold_pct: float) -> None:
        if daily_limit_usd < 0:
            raise ValueError("daily_limit_usd must be non-negative")
        if not (0.0 <= cheap_threshold_pct <= 1.0):
            raise ValueError("cheap_threshold_pct must be between 0.0 and 1.0")
        with self._lock:
            self.daily_limit_usd = daily_limit_usd
            self.cheap_threshold_pct = cheap_threshold_pct
        self._persist()

    # ── Serialisation ─────────────────────────────────────────────────────────

    def to_dict(self) -> dict:
        return {
            "daily_limit_usd":    self.daily_limit_usd,
            "spent_today_usd":    round(self.spent_today_usd, 6),
            "cheap_threshold_pct": self.cheap_threshold_pct,
            "is_enabled":         self.is_enabled(),
            "is_tight":           self.is_tight(),
            "is_exceeded":        self.is_exceeded(),
            "pct_used":           round(self.spent_today_usd / self.daily_limit_usd * 100, 1)
                                  if self.is_enabled() else 0,
            "remaining_usd":      round(max(self.daily_limit_usd - self.spent_today_usd, 0), 6)
                                  if self.is_enabled() else None,
        }

    # ── Internal ──────────────────────────────────────────────────────────────

    def _check_daily_reset(self) -> None:
        today = datetime.now().date()
        if datetime.fromtimestamp(self._last_reset).date() < today:
            self.spent_today_usd = 0.0
            self._last_reset = time.time()
            logger.info("Budget auto-reset for new day")


# Module-level singleton
budget_manager = BudgetManager()
