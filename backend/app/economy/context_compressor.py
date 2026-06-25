"""
economy/context_compressor.py — Three compression strategies to reduce context tokens.
Pure stateless functions — zero I/O, zero DB access.
"""
from __future__ import annotations

import re
from typing import List, Tuple


def _has_code(content: str) -> bool:
    return bool(re.search(r"```|def |class |import |traceback|exception|error",
                           content, re.IGNORECASE))


def _has_error(content: str) -> bool:
    return bool(re.search(r"error|exception|traceback|خطأ|استثناء|فشل",
                           content, re.IGNORECASE))


def _msg_content(m) -> str:
    return m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")


def _msg_role(m) -> str:
    return m.get("role", "") if isinstance(m, dict) else getattr(m, "role", "")


def _importance_score(msg, index: int, total: int) -> int:
    role    = _msg_role(msg)
    content = _msg_content(msg)
    if role == "system":
        return 999
    score = 0
    if _has_code(content):    score += 2
    if _has_error(content):   score += 2
    if (total - index) <= 3:  score += 1
    return score


def _summarize(messages: list) -> str:
    parts = []
    for m in messages:
        role    = _msg_role(m)
        content = _msg_content(m)[:80].replace("\n", " ")
        if role == "user":
            parts.append(f"المستخدم: {content}")
        elif role == "assistant":
            parts.append(f"المساعد: {content[:50]}")
    return "السياق السابق: " + " | ".join(parts) if parts else ""


def _split(messages: list):
    system  = [m for m in messages if _msg_role(m) == "system"]
    non_sys = [m for m in messages if _msg_role(m) != "system"]
    return system, non_sys


class ContextCompressor:

    def sliding_window(self, messages: list, n: int) -> list:
        system, non_sys = _split(messages)
        return system + non_sys[-n:]

    def smart_summary(self, messages: list, keep_last: int) -> list:
        system, non_sys = _split(messages)
        if len(non_sys) <= keep_last:
            return messages
        old, recent = non_sys[:-keep_last], non_sys[-keep_last:]
        summary = _summarize(old)
        result = list(system)
        if summary:
            result.append({"role": "system", "content": summary})
        result.extend(recent)
        return result

    def importance_scoring(self, messages: list, threshold: int = 1) -> list:
        system, non_sys = _split(messages)
        total = len(non_sys)
        kept  = [m for i, m in enumerate(non_sys)
                 if _importance_score(m, i, total) >= threshold]
        if non_sys and non_sys[-1] not in kept:
            kept.append(non_sys[-1])
        return system + kept

    def compress(
        self, messages: list, context_messages: int, strategy: str = "sliding",
    ) -> Tuple[list, str, int, int]:
        original_count = len(messages)
        if not messages:
            return messages, "none", 0, 0
        if original_count <= context_messages:
            return messages, "none", original_count, original_count

        if strategy == "sliding":
            compressed = self.sliding_window(messages, context_messages)
        elif strategy == "summary":
            compressed = self.smart_summary(messages, context_messages)
        elif strategy == "importance":
            compressed = self.importance_scoring(messages, threshold=1)
        else:
            compressed = self.sliding_window(messages, context_messages)
            strategy   = "sliding"

        if not compressed and messages:
            compressed = [messages[-1]]
        return compressed, strategy, original_count, len(compressed)


compressor = ContextCompressor()
