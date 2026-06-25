"""
economy/context_classifier.py — Classifies chat requests into SIMPLE/CODING/COMPLEX/FILE
and returns the optimal token budget + context window size.
Pure stateless functions — zero I/O, zero DB access.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import List


class RequestType(str, Enum):
    SIMPLE  = "SIMPLE"
    CODING  = "CODING"
    COMPLEX = "COMPLEX"
    FILE    = "FILE"


@dataclass
class ClassificationResult:
    request_type: RequestType
    token_budget: int       # max_tokens cap for this type
    context_messages: int   # how many recent messages to keep
    reason: str


_CODING_KW = {
    "كود", "code", "function", "دالة", "script", "برمجة", "bug", "خطأ", "error",
    "debug", "اكتب", "write", "implement", "نفذ", "class", "كلاس", "loop", "حلقة",
    "algorithm", "خوارزمية", "compile", "syntax", "import", "library", "مكتبة",
    "api", "json", "sql", "python", "javascript", "typescript", "rust", "go",
    "java", "c++", "html", "css", "react", "fastapi", "flask", "stacktrace",
    "traceback", "exception", "lint", "test", "pytest", "اختبار", "refactor",
    "optimize", "regex", "تحسين الكود", "ليش هذا الخطأ", "هذا الكود",
}

_COMPLEX_KW = {
    "قارن", "compare", "فرق", "difference", "خطط", "plan", "تحليل", "analyze",
    "analysis", "بالتفصيل", "in detail", "شرح مفصل", "استراتيجية", "strategy",
    "مشروع", "project", "architecture", "معمارية", "تصميم", "design",
    "pros and cons", "ايجابيات", "سلبيات", "advantages", "disadvantages",
    "evaluate", "قيّم", "research", "بحث", "study", "دراسة", "مقارنة",
    "تخطيط", "roadmap", "خارطة طريق", "comprehensive", "شامل",
}


def _has_code_block(text: str) -> bool:
    return bool(
        re.search(r"```", text) or
        re.search(r"^\s{4,}\S", text, re.MULTILINE) or
        re.search(r"\bdef \w|\bclass \w|#include\b|<\?php|\bfunction\s+\w+\s*\(", text)
    )


def _looks_like_file(text: str, has_attachment: bool) -> bool:
    return (
        has_attachment or
        len(text) > 8000 or
        bool(re.search(r"^#{1,3}\s+Workspace Context|^##\s+Active File", text, re.MULTILINE))
    )


def _kw_match(text: str, kw_set: set) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in kw_set)


class RequestClassifier:

    def classify(self, messages: list, has_attachment: bool = False) -> ClassificationResult:
        if not messages:
            return ClassificationResult(RequestType.SIMPLE, 500, 1, "empty request")

        last_user_msg = ""
        all_text = ""
        for m in messages:
            content = m.get("content", "") if isinstance(m, dict) else getattr(m, "content", "")
            role    = m.get("role",    "") if isinstance(m, dict) else getattr(m, "role",    "")
            all_text += content + " "
            if role == "user":
                last_user_msg = content

        last_len = len(last_user_msg)

        if _looks_like_file(last_user_msg, has_attachment):
            return ClassificationResult(RequestType.FILE, 4000, 6, "file or very long message")

        if _has_code_block(last_user_msg) or _kw_match(last_user_msg, _CODING_KW):
            return ClassificationResult(RequestType.CODING, 2000, 12, "code block or technical keywords")

        if _kw_match(last_user_msg, _COMPLEX_KW) or last_len > 350:
            return ClassificationResult(RequestType.COMPLEX, 3000, 16, "complex analysis or long message")

        return ClassificationResult(RequestType.SIMPLE, 1024, 20, "short direct question")


classifier = RequestClassifier()
