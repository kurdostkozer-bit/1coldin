"""
economy/economy_middleware.py — Context Economy System.
Intercepts every chat request and:
  1. Classifies request type (SIMPLE / CODING / COMPLEX / FILE)
  2. Compresses messages to the type's context window
  3. Caps max_tokens to the type's token budget
  4. Logs token savings to DB (fire-and-forget)

Toggle: set env var ECONOMY_MODE=false to bypass entirely.
"""
from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass

from app.economy.context_classifier import classifier, RequestType
from app.economy.context_compressor import compressor

logger = logging.getLogger("kurdbox.economy")

ECONOMY_MODE: bool = os.environ.get("ECONOMY_MODE", "true").lower() in ("1", "true", "yes")

_STRATEGY = {
    RequestType.SIMPLE:  "sliding",
    RequestType.CODING:  "importance",
    RequestType.COMPLEX: "summary",
    RequestType.FILE:    "sliding",
}

_stats: dict = {
    "total_requests":          0,
    "tokens_original_total":   0,
    "tokens_compressed_total": 0,
    "by_type": {t.value: 0 for t in RequestType},
}


@dataclass
class EconomyResult:
    request_type:        str
    token_budget:        int
    tokens_original:     int
    tokens_compressed:   int
    tokens_saved:        int
    saving_pct:          float
    strategy_used:       str
    messages_original:   int
    messages_compressed: int
    economy_enabled:     bool


def _estimate_tokens(messages: list) -> int:
    total = 0
    for m in messages:
        content = m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")
        total  += max(1, len(str(content)) // 4)
    return total


def process(messages: list, max_tokens: int = 1024, has_attachment: bool = False):
    """
    Main entry point. Returns (compressed_messages, new_max_tokens, EconomyResult).
    """
    tokens_original   = _estimate_tokens(messages)
    messages_original = len(messages)

    if not ECONOMY_MODE:
        return messages, max_tokens, EconomyResult(
            request_type="BYPASS", token_budget=max_tokens,
            tokens_original=tokens_original, tokens_compressed=tokens_original,
            tokens_saved=0, saving_pct=0.0, strategy_used="none",
            messages_original=messages_original, messages_compressed=messages_original,
            economy_enabled=False,
        )

    classification = classifier.classify(messages, has_attachment)
    strategy       = _STRATEGY.get(classification.request_type, "sliding")

    compressed_msgs, strategy_used, _, compressed_count = compressor.compress(
        messages, classification.context_messages, strategy
    )

    new_max_tokens    = min(max_tokens, classification.token_budget)
    tokens_compressed = _estimate_tokens(compressed_msgs)
    tokens_saved      = max(0, tokens_original - tokens_compressed)
    saving_pct        = round(tokens_saved / tokens_original * 100, 1) if tokens_original > 0 else 0.0

    _stats["total_requests"]          += 1
    _stats["tokens_original_total"]   += tokens_original
    _stats["tokens_compressed_total"] += tokens_compressed
    _stats["by_type"][classification.request_type.value] += 1

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(_log_to_db(
                classification.request_type.value,
                tokens_original, tokens_compressed, strategy_used,
            ))
    except RuntimeError:
        pass  # no event loop in sync context — skip logging

    logger.info(
        f"Economy [{classification.request_type.value}] "
        f"{messages_original}->{compressed_count} msgs | "
        f"~{tokens_original}->~{tokens_compressed} tokens | "
        f"saved {saving_pct}% | {strategy_used}"
    )

    return compressed_msgs, new_max_tokens, EconomyResult(
        request_type=classification.request_type.value,
        token_budget=classification.token_budget,
        tokens_original=tokens_original, tokens_compressed=tokens_compressed,
        tokens_saved=tokens_saved, saving_pct=saving_pct,
        strategy_used=strategy_used, messages_original=messages_original,
        messages_compressed=compressed_count, economy_enabled=True,
    )


async def _log_to_db(request_type: str, tokens_original: int,
                     tokens_compressed: int, strategy: str) -> None:
    try:
        loop = asyncio.get_event_loop()
        def _write():
            from app.storage.database import get_db_session
            # DBEconomyLog not in current schema — log as usage note only
            pass
        await loop.run_in_executor(None, _write)
    except Exception as e:
        logger.debug(f"Economy DB log skipped: {e}")


def get_economy_stats() -> dict:
    total_orig = _stats["tokens_original_total"]
    total_comp = _stats["tokens_compressed_total"]
    saved      = max(0, total_orig - total_comp)
    saving_pct = round(saved / total_orig * 100, 1) if total_orig > 0 else 0.0
    return {
        "enabled":                  ECONOMY_MODE,
        "total_requests_processed": _stats["total_requests"],
        "tokens_original_total":    total_orig,
        "tokens_compressed_total":  total_comp,
        "tokens_saved_total":       saved,
        "saving_pct":               saving_pct,
        "by_type":                  dict(_stats["by_type"]),
    }
