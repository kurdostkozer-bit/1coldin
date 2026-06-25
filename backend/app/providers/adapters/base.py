"""
base.py — Abstract adapter interface for LLM providers.
All providers that use OpenAI-compatible API extend OpenAICompatAdapter.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, AsyncGenerator, Dict

import httpx


class BaseAdapter(ABC):
    """Minimal interface every provider adapter must implement."""

    @abstractmethod
    async def chat(
        self,
        base_url: str,
        api_key: str,
        payload: Dict[str, Any],
        http: httpx.AsyncClient,
    ) -> Dict[str, Any]:
        """Non-streaming chat completion. Returns raw provider JSON."""

    @abstractmethod
    async def stream(
        self,
        base_url: str,
        api_key: str,
        payload: Dict[str, Any],
        http: httpx.AsyncClient,
    ) -> AsyncGenerator[str, None]:
        """Streaming chat completion. Yields raw SSE data lines (without 'data: ' prefix)."""
