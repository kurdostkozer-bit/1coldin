"""
chat/service.py — Routes chat requests to LLM providers via adapters.
Handles: alias resolution, retry/failover (MAX_RETRIES=3), streaming.
Stateless per request. Keys are decrypted ONCE at call time, never stored.
Usage recording is fire-and-forget via asyncio.ensure_future.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import AsyncGenerator, List, Optional, Tuple

import httpx

from app.chat.schemas import ChatRequest
from app.providers.provider_orchestrator import ProviderRouter
from app.providers.schemas import Provider, ProviderStatus
from app.providers.aliases import resolve_alias
from app.providers.config import estimate_cost
from app.providers.key_pool import PoolKey
from app.providers.adapters import get_adapter
from app.security.key_vault import decrypt
from app.storage.database import get_db_session
from app.storage.models import DBUsageRecord
from app.economy.economy_middleware import process as economy_process

logger = logging.getLogger("kurdbox.chat")

MAX_RETRIES = 3


class ChatService:

    def __init__(self, router: ProviderRouter, http_client: httpx.AsyncClient) -> None:
        self._router = router
        self._http = http_client

    # ── Public API ────────────────────────────────────────────────────────────

    async def process_chat(self, request: ChatRequest) -> dict:
        provider_id, latency_ms, data = await self._do_chat(request)
        return {"provider_used": provider_id, "latency_ms": round(latency_ms, 2), "result": data}

    async def stream_chat(self, request: ChatRequest) -> AsyncGenerator[str, None]:
        async for chunk in self._do_stream(request):
            yield chunk

    # ── Core (non-streaming) ──────────────────────────────────────────────────

    async def _do_chat(self, request: ChatRequest) -> Tuple[str, float, dict]:
        tried: List[str] = []
        last_error = ""

        model_candidates = resolve_alias(request.model)
        if model_candidates:
            for candidate in model_candidates:
                provider = (self._router.find_provider_for_model(candidate)
                            or self._router.pick_provider(strategy="smart"))
                if not provider or provider.id in tried:
                    continue
                tried.append(provider.id)
                result, err = await self._try_provider(request, provider, candidate)
                if result:
                    return result
                last_error = err or last_error
            logger.warning(f"All providers failed for alias '{request.model}': {last_error}")
            raise Exception("Service temporarily unavailable. Please try again later.")

        # Direct model (no alias)
        for attempt in range(MAX_RETRIES):
            provider = self._router.pick_provider(
                model=request.model,
                strategy=request.strategy or "smart",
                hint=request.provider_hint if attempt == 0 else None,
            ) or self._router.pick_provider(strategy="smart")

            if not provider or provider.id in tried:
                break
            tried.append(provider.id)
            result, err = await self._try_provider(request, provider, request.model)
            if result:
                return result
            last_error = err or last_error

        logger.warning(f"All providers failed: tried={tried}, last={last_error}")
        raise Exception("Service temporarily unavailable. Please try again later.")

    async def _try_provider(
        self, request: ChatRequest, provider: Provider, model: str
    ) -> Tuple[Optional[Tuple], Optional[str]]:
        encrypted_key, pool_key = self._router.pick_key_for_provider(provider)
        plain_key = decrypt(encrypted_key)

        payload = self._build_payload(request, model)
        adapter = get_adapter(provider.id)
        t0 = time.time()

        try:
            data = await adapter.chat(provider.base_url, plain_key, payload, self._http)
        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code
            err_body = e.response.text[:200]
            logger.warning(f"Provider {provider.id} HTTP {status_code}: {err_body}")
            if status_code == 429:
                self._router.mark_limited(provider.id)
                self._router.record_failure(provider.id, model, "rate_limited")
                self._router.record_key_failure(provider.id, pool_key)
                return None, "rate_limited"
            # 4xx or 5xx — record failure and try next provider
            self._router.record_failure(provider.id, model, f"http_{status_code}")
            self._router.record_key_failure(provider.id, pool_key)
            return None, f"http_{status_code}: {err_body}"
        except Exception as e:
            self._router.record_failure(provider.id, model, str(e))
            self._router.record_key_failure(provider.id, pool_key)
            return None, str(e)
        finally:
            plain_key = ""  # ensure plaintext doesn't linger

        latency_ms = (time.time() - t0) * 1000
        usage = data.get("usage", {})
        pt, ct = usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0)
        cost = estimate_cost(provider.id, pt, ct)

        self._router.record_success(provider.id, latency_ms, model,
                                    cost_usd=cost, tokens=usage.get("total_tokens", 0),
                                    prompt_tokens=pt, completion_tokens=ct)
        self._router.record_key_success(provider.id, pool_key, latency_ms)

        # Fire-and-forget usage recording — never blocks the response
        asyncio.ensure_future(
            self._record_usage(provider.id, model, pt, ct, latency_ms, cost, True)
        )

        return (provider.id, latency_ms, data), ""

    # ── Streaming ─────────────────────────────────────────────────────────────

    async def _do_stream(self, request: ChatRequest) -> AsyncGenerator[str, None]:
        tried: List[str] = []
        candidates = resolve_alias(request.model)
        effective_model = candidates[0] if candidates else request.model

        for attempt in range(MAX_RETRIES):
            provider = self._router.pick_provider(
                model=effective_model,
                strategy=request.strategy or "smart",
                hint=request.provider_hint if attempt == 0 else None,
            )
            if not provider or provider.id in tried:
                break
            tried.append(provider.id)

            encrypted_key, pool_key = self._router.pick_key_for_provider(provider)
            plain_key = decrypt(encrypted_key)
            adapter = get_adapter(provider.id)
            t0 = time.time()

            try:
                yield f"data: {json.dumps({'type': 'start', 'provider': provider.id})}\n\n"
                payload = self._build_payload(request, effective_model)
                async for raw in adapter.stream(provider.base_url, plain_key, payload, self._http):
                    yield f"data: {raw}\n\n"

                latency_ms = (time.time() - t0) * 1000
                self._router.record_success(provider.id, latency_ms, effective_model)
                self._router.record_key_success(provider.id, pool_key, latency_ms)

                # Estimate token usage from message content (4 chars ≈ 1 token for Latin; 2 chars ≈ 1 for Arabic)
                all_text = " ".join(
                    str(m.get("content", "") or "") for m in payload.get("messages", [])
                )
                est_prompt = max(len(all_text) // 3, 1)
                est_completion = payload.get("max_tokens", 512) // 2
                est_cost = estimate_cost(provider.id, est_prompt, est_completion)

                asyncio.ensure_future(
                    self._record_usage(provider.id, effective_model, est_prompt, est_completion, latency_ms, est_cost, True)
                )

                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                return
            except Exception as e:
                self._router.record_failure(provider.id, effective_model, str(e))
                self._router.record_key_failure(provider.id, pool_key)
            finally:
                plain_key = ""

        yield f"data: {json.dumps({'error': 'All providers failed'})}\n\n"

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    async def _record_usage(
        provider_id: str, model: str,
        prompt_tokens: int, completion_tokens: int,
        latency_ms: float, cost_usd: float, success: bool,
    ) -> None:
        """Persist usage to DB asynchronously — never blocks the chat response."""
        try:
            loop = asyncio.get_event_loop()
            def _write():
                with get_db_session() as db:
                    db.add(DBUsageRecord(
                        provider_id=provider_id, model=model,
                        tokens_used=prompt_tokens + completion_tokens,
                        prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                        latency_ms=round(latency_ms, 2),
                        success=success, estimated_cost_usd=cost_usd,
                    ))
            await loop.run_in_executor(None, _write)
        except Exception as e:
            logger.warning(f"Usage recording failed (non-critical): {e}")

    @staticmethod
    def _build_payload(request: ChatRequest, model: str) -> dict:
        messages = [m.model_dump() for m in request.messages]
        # Apply economy middleware — compress context + cap max_tokens
        compressed, max_tokens, _ = economy_process(messages, request.max_tokens or 1024)
        payload: dict = {
            "model": model,
            "messages": compressed,
            "temperature": request.temperature,
            "max_tokens": max_tokens,
        }
        if request.tools:
            payload["tools"] = request.tools
            payload["tool_choice"] = request.tool_choice or "auto"
        return payload
