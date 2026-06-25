"""
adapters/__init__.py — adapter registry.
get_adapter(provider_id) returns the correct adapter instance.
All current providers use the OpenAI-compatible protocol.
"""
from app.providers.adapters.base import BaseAdapter
from app.providers.adapters.openai_compat import openai_adapter, OpenAICompatAdapter

# All supported providers currently use OpenAI-compatible API.
# Add provider-specific adapters here when a provider deviates from the standard.
_REGISTRY: dict[str, BaseAdapter] = {}


def get_adapter(provider_id: str) -> BaseAdapter:
    """Return adapter for provider_id. Falls back to openai_compat for all known providers."""
    return _REGISTRY.get(provider_id, openai_adapter)


__all__ = ["get_adapter", "BaseAdapter", "OpenAICompatAdapter", "openai_adapter"]
