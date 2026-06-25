"""
PoolKey — per-key health tracking + weighted routing.
Ported from old state.py PoolKey dataclass with same logic.
"""

import time
import logging
from dataclasses import dataclass, field

logger = logging.getLogger("kurdbox.keypool")

KEY_DEGRADED_FAILURES = 3
KEY_DISABLED_FAILURES = 6
KEY_RECOVERY_SECONDS = 30 * 60  # 30 minutes


@dataclass
class PoolKey:
    api_key: str
    db_id: int
    label: str = ""
    weight: float = 10.0
    status: str = "active"          # active | degraded | disabled
    consecutive_failures: int = 0
    total_failures: int = 0
    requests_count: int = 0
    avg_latency_ms: float = 0.0
    last_success: float = 0.0
    last_failure: float = 0.0
    disabled_until: float = 0.0

    def effective_weight(self) -> float:
        if self.status == "disabled":
            return 0.0
        if self.status == "degraded":
            return max(self.weight * 0.3, 0.1)
        return self.weight

    def record_success(self, latency_ms: float) -> None:
        self.requests_count += 1
        self.last_success = time.time()
        self.consecutive_failures = 0
        self.avg_latency_ms = (
            latency_ms if self.avg_latency_ms == 0
            else self.avg_latency_ms * 0.8 + latency_ms * 0.2
        )
        if self.status == "degraded":
            self.status = "active"

    def record_failure(self) -> None:
        self.requests_count += 1
        self.last_failure = time.time()
        self.consecutive_failures += 1
        self.total_failures += 1
        if self.consecutive_failures >= KEY_DISABLED_FAILURES:
            self.status = "disabled"
            self.disabled_until = time.time() + KEY_RECOVERY_SECONDS
            logger.warning(f"Pool key (id={self.db_id}) DISABLED after {self.consecutive_failures} failures")
        elif self.consecutive_failures >= KEY_DEGRADED_FAILURES:
            self.status = "degraded"
            logger.warning(f"Pool key (id={self.db_id}) DEGRADED after {self.consecutive_failures} failures")

    def try_recover(self) -> bool:
        if self.status == "disabled" and time.time() >= self.disabled_until:
            self.status = "active"
            self.consecutive_failures = 0
            logger.info(f"Pool key (id={self.db_id}) auto-recovered")
            return True
        return False
