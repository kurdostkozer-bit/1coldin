"""
openai_compat.py — Adapter for all OpenAI-compatible providers.
Covers: Groq, Gemini (OpenAI mode), Mistral, SambaNova, Cerebras,
        OpenRouter, NVIDIA NIM, GitHub Models, Perplexity, Fireworks.
"""
from __future__ import annotations

import logging
from typing import Any, AsyncGenerator, Dict

import httpx

from app.providers.adapters.base import BaseAdapter

logger = logging.getLogger("kurdbox.adapter.openai")


class OpenAICompatAdapter(BaseAdapter):

    async def chat(
        self,
        base_url: str,
        api_key: str,
        payload: Dict[str, Any],
        http: httpx.AsyncClient,
    ) -> Dict[str, Any]:
        resp = await http.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}",
                     "Content-Type": "application/json"},
            json=payload,
            timeout=60.0,
        )
        resp.raise_for_status()
        return resp.json()

    async def stream(
        self,
        base_url: str,
        api_key: str,
        payload: Dict[str, Any],
        http: httpx.AsyncClient,
    ) -> AsyncGenerator[str, None]:
        async with http.stream(
            "POST",
            f"{base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}",
                     "Content-Type": "application/json"},
            json={**payload, "stream": True},
            timeout=60.0,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[6:]
                if raw == "[DONE]":
                    return
                yield raw


# Singleton — shared across all OpenAI-compat providers
openai_adapter = OpenAICompatAdapter()
