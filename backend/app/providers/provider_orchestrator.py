"""
provider_orchestrator.py — canonical import point for ProviderRouter.
router_service.py is kept for backward compatibility during migration.
"""
from app.providers.router_service import ProviderRouter, provider_router

__all__ = ["ProviderRouter", "provider_router"]
