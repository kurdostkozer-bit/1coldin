"""
backend/tests/test_api.py — Integration tests for KurdBox v2.0 backend.
Uses in-memory SQLite + mocked HTTP client.
"""
import os
import sys
import time
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, StaticPool
from sqlalchemy.orm import sessionmaker

# Must set env vars before importing app
os.environ.setdefault("KURDOST_SECRET_KEY", "test-secret-key-for-unit-tests-only")
os.environ.setdefault("KURDOST_ENCRYPTION_KEY", "")
os.environ["DEMO_MODE"] = "true"  # required for demo-token endpoint in tests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.main import create_app
from app.storage.database import Base, get_db
from app.storage.models import DBUser, DBProvider, DBProviderKey, DBBudget
from app.providers.provider_orchestrator import provider_router
from app.providers.key_pool import PoolKey
from app.providers.schemas import Provider, ProviderStatus

# ── Test DB ───────────────────────────────────────────────────────────────────

TEST_DB_URL = "sqlite://"  # in-memory
engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False},
                       poolclass=StaticPool)
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(bind=engine)


def override_get_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


app = create_app()
app.dependency_overrides[get_db] = override_get_db

# Mock HTTP client — no real network calls in tests
_mock_http = MagicMock()
_mock_http.post = AsyncMock(side_effect=Exception("no real http in tests"))
app.state.http_client = _mock_http

# Wire app.state manually (lifespan not triggered by plain TestClient)
from app.economy.budget_manager import BudgetManager
from app.analytics.rankings_service import RankingsService
app.state.budget   = BudgetManager()
app.state.rankings = RankingsService(provider_router)

from app.chat.service import ChatService
app.state.chat_service = ChatService(provider_router, _mock_http)

client = TestClient(app, raise_server_exceptions=False)


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def clean_state():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    provider_router._providers.clear()
    provider_router._key_pools.clear()
    yield
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    provider_router._providers.clear()
    provider_router._key_pools.clear()


@pytest.fixture
def token():
    resp = client.post("/api/v1/auth/demo-token")
    assert resp.status_code == 200
    return resp.json()["access_token"]


@pytest.fixture
def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def groq(auth):
    resp = client.post("/api/v1/providers", json={
        "provider_type": "groq",
        "api_key": "gsk_testkey_abcdefgh12345678",
    }, headers=auth)
    assert resp.status_code == 200
    return resp.json()


# ══ 1. Auth ═══════════════════════════════════════════════════════════════════

def test_demo_token():
    resp = client.post("/api/v1/auth/demo-token")
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["access_token"].count(".") == 2


def test_protected_endpoint_requires_auth():
    resp = client.get("/api/v1/providers")
    assert resp.status_code in (401, 403)


def test_invalid_token_rejected():
    resp = client.get("/api/v1/providers",
                      headers={"Authorization": "Bearer invalid.token.here"})
    assert resp.status_code in (401, 403)


def test_health_endpoint():
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# ══ 2. Providers ══════════════════════════════════════════════════════════════

def test_list_providers_empty(auth):
    resp = client.get("/api/v1/providers", headers=auth)
    assert resp.status_code == 200
    assert resp.json() == []


def test_add_groq_provider(auth):
    resp = client.post("/api/v1/providers", json={
        "provider_type": "groq",
        "api_key": "gsk_testkey_abcdefgh12345678",
    }, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "groq"
    assert data["name"] == "Groq Cloud"
    assert data["status"] == "active"
    assert data["api_key"] == "****"   # never expose plaintext


def test_add_provider_duplicate_rejected(auth, groq):
    resp = client.post("/api/v1/providers", json={
        "provider_type": "groq",
        "api_key": "gsk_another_12345678",
    }, headers=auth)
    assert resp.status_code == 409


def test_add_provider_empty_key_rejected(auth):
    resp = client.post("/api/v1/providers", json={
        "provider_type": "groq", "api_key": "",
    }, headers=auth)
    assert resp.status_code == 400


def test_add_unknown_provider_rejected(auth):
    resp = client.post("/api/v1/providers", json={
        "provider_type": "nonexistent", "api_key": "some-key-12345",
    }, headers=auth)
    assert resp.status_code == 400


def test_get_provider(auth, groq):
    resp = client.get("/api/v1/providers/groq", headers=auth)
    assert resp.status_code == 200
    assert resp.json()["id"] == "groq"


def test_get_missing_provider_404(auth):
    resp = client.get("/api/v1/providers/nonexistent", headers=auth)
    assert resp.status_code == 404


def test_disable_enable_provider(auth, groq):
    resp = client.post("/api/v1/providers/groq/disable", headers=auth)
    assert resp.status_code == 200
    assert provider_router.get_provider("groq").status == ProviderStatus.INACTIVE

    resp = client.post("/api/v1/providers/groq/enable", headers=auth)
    assert resp.status_code == 200
    assert provider_router.get_provider("groq").status == ProviderStatus.ACTIVE


def test_delete_provider(auth, groq):
    resp = client.delete("/api/v1/providers/groq", headers=auth)
    assert resp.status_code == 200
    assert provider_router.get_provider("groq") is None


def test_list_supported_providers():
    resp = client.get("/api/v1/providers/supported")
    assert resp.status_code == 200
    ids = [p["id"] for p in resp.json()]
    assert "groq" in ids
    assert "sambanova" in ids


# ══ 3. Key Pool ═══════════════════════════════════════════════════════════════

def test_add_pool_key(auth, groq):
    resp = client.post("/api/v1/providers/groq/keys", json={
        "api_key": "gsk_pool_key_abcdefgh12345678",
        "label": "Account A",
        "weight": 15.0,
    }, headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["provider_id"] == "groq"
    assert data["label"] == "Account A"
    assert data["weight"] == 15.0
    assert data["status"] == "active"


def test_pool_key_empty_rejected(auth, groq):
    resp = client.post("/api/v1/providers/groq/keys",
                       json={"api_key": ""}, headers=auth)
    assert resp.status_code == 400


def test_list_pool_keys(auth, groq):
    client.post("/api/v1/providers/groq/keys",
                json={"api_key": "gsk_key2_abcdefgh12345678"}, headers=auth)
    resp = client.get("/api/v1/providers/groq/keys", headers=auth)
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


def test_delete_pool_key(auth, groq):
    add = client.post("/api/v1/providers/groq/keys",
                      json={"api_key": "gsk_todel_abcdefgh12345678"}, headers=auth)
    key_id = add.json()["id"]
    resp = client.delete(f"/api/v1/providers/groq/keys/{key_id}", headers=auth)
    assert resp.status_code == 200
    assert all(k.db_id != key_id for k in provider_router.get_pool_keys("groq"))


# ══ 4. PoolKey health state machine ══════════════════════════════════════════

def test_pool_key_health_transitions():
    pk = PoolKey(api_key="gsk_test_key_12345678901", db_id=999)
    assert pk.status == "active"

    for _ in range(3):
        pk.record_failure()
    assert pk.status == "degraded"
    assert pk.effective_weight() < pk.weight

    for _ in range(3):
        pk.record_failure()
    assert pk.status == "disabled"
    assert pk.effective_weight() == 0.0

    pk.disabled_until = 0.0
    assert pk.try_recover() is True
    assert pk.status == "active"

    pk.status = "degraded"
    pk.consecutive_failures = 2
    pk.record_success(100.0)
    assert pk.status == "active"
    assert pk.consecutive_failures == 0


# ══ 5. BudgetManager ═════════════════════════════════════════════════════════

def test_budget_manager_logic():
    from app.economy.budget_manager import BudgetManager
    bm = BudgetManager()

    assert not bm.is_enabled()
    assert not bm.is_tight()
    assert not bm.is_exceeded()

    bm.configure(daily_limit_usd=10.0, cheap_threshold_pct=0.8)
    bm.add_cost(7.0)
    assert not bm.is_tight()

    bm.add_cost(1.5)   # 8.5 ≥ 80% of 10
    assert bm.is_tight()
    assert not bm.is_exceeded()

    bm.add_cost(2.0)   # 10.5 > 10
    assert bm.is_exceeded()

    bm.reset()
    assert bm.spent_today_usd == 0.0


# ══ 6. RankingsService ═══════════════════════════════════════════════════════

def test_rankings_service(auth, groq):
    from app.analytics.rankings_service import RankingsService
    svc = RankingsService(provider_router)
    rankings = svc.get_rankings()
    assert isinstance(rankings, list)
    assert any(r["provider_id"] == "groq" for r in rankings)


def test_rankings_stats(auth, groq):
    from app.analytics.rankings_service import RankingsService
    svc = RankingsService(provider_router)
    stats = svc.get_stats()
    assert "total_providers" in stats
    assert "providers" in stats
    assert stats["total_providers"] >= 1


# ══ 7. Router failover logic ══════════════════════════════════════════════════

def test_record_failure_increments_counter():
    p = Provider(id="test-p", name="Test", base_url="https://api.test.com",
                 api_key="key-12345678")
    provider_router.add_provider(p)
    provider_router.record_failure("test-p", error="timeout")
    assert provider_router.get_provider("test-p").failures == 1
    provider_router.remove_provider("test-p")


def test_cooldown_after_failure_threshold():
    p = Provider(id="test-cd", name="Cooldown", base_url="https://api.test.com",
                 api_key="key-12345678")
    provider_router.add_provider(p)
    for _ in range(3):
        provider_router.record_failure("test-cd", error="err")
    assert provider_router.get_provider("test-cd").status in (
        ProviderStatus.COOLDOWN, ProviderStatus.INACTIVE
    )
    provider_router.remove_provider("test-cd")


def test_pick_provider_skips_cooldown():
    active  = Provider(id="active-p",   name="A", base_url="https://a.com", api_key="k1-12345678")
    cooling = Provider(id="cooling-p",  name="C", base_url="https://c.com", api_key="k2-12345678",
                       status=ProviderStatus.COOLDOWN, cooldown_until=time.time() + 9999)
    provider_router.add_provider(active)
    provider_router.add_provider(cooling)
    picked = provider_router.pick_provider(strategy="smart")
    assert picked is not None
    assert picked.id == "active-p"
    provider_router.remove_provider("active-p")
    provider_router.remove_provider("cooling-p")


def test_restore_provider(auth):
    p = Provider(id="restore-p", name="R", base_url="https://r.com", api_key="k-12345678",
                 status=ProviderStatus.COOLDOWN)
    provider_router.add_provider(p)
    provider_router.restore_provider("restore-p")
    assert provider_router.get_provider("restore-p").status == ProviderStatus.ACTIVE
    provider_router.remove_provider("restore-p")


# ══ 8. Chat — no providers returns 503 ═══════════════════════════════════════

def test_chat_no_providers_503(auth):
    resp = client.post("/api/v1/chat", json={
        "model": "llama-3.3-70b-versatile",
        "messages": [{"role": "user", "content": "Hello"}],
    }, headers=auth)
    assert resp.status_code in (500, 503)


# ══ 9. Economy ════════════════════════════════════════════════════════════════

def test_economy_classifier():
    from app.economy.context_classifier import classifier, RequestType
    msgs = [{"role": "user", "content": "اكتب كود Python لفرز قائمة"}]
    result = classifier.classify(msgs)
    assert result.request_type == RequestType.CODING
    assert result.token_budget > 0


def test_economy_process():
    from app.economy.economy_middleware import process
    msgs = [{"role": "user", "content": "مرحبا"}]
    compressed, budget, result = process(msgs, max_tokens=2000)
    assert isinstance(compressed, list)
    assert budget > 0
    assert result.economy_enabled


# ══ 10. Budget endpoints ═════════════════════════════════════════════════════

def test_get_budget(auth):
    resp = client.get("/api/v1/budget", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert "daily_limit_usd" in data
    assert "spent_today_usd" in data


def test_set_budget(auth):
    resp = client.post("/api/v1/budget",
                       json={"daily_limit_usd": 20.0, "cheap_threshold_pct": 0.75},
                       headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["daily_limit_usd"] == 20.0
    assert data["cheap_threshold_pct"] == 0.75


def test_reset_budget(auth):
    client.post("/api/v1/budget", json={"daily_limit_usd": 10.0}, headers=auth)
    resp = client.post("/api/v1/budget/reset", headers=auth)
    assert resp.status_code == 200
    assert resp.json()["spent_today_usd"] == 0.0


# ══ 11. Rankings & Stats endpoints ═══════════════════════════════════════════

def test_get_rankings(auth, groq):
    resp = client.get("/api/v1/rankings", headers=auth)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_get_stats(auth, groq):
    resp = client.get("/api/v1/stats", headers=auth)
    assert resp.status_code == 200
    data = resp.json()
    assert "total_providers" in data
    assert "providers" in data


def test_get_aliases():
    resp = client.get("/api/v1/aliases")
    assert resp.status_code == 200
    data = resp.json()
    assert "best-70b" in data
    assert isinstance(data["best-70b"], list)


# ══ 12. Key recovery endpoint ════════════════════════════════════════════════

def test_key_recovery(auth, groq):
    add = client.post("/api/v1/providers/groq/keys",
                      json={"api_key": "gsk_recovery_abcdefgh12345678"}, headers=auth)
    key_id = add.json()["id"]

    # force disable
    pool = provider_router.get_pool_keys("groq")
    for pk in pool:
        if pk.db_id == key_id:
            for _ in range(6):
                pk.record_failure()
            assert pk.status == "disabled"
            break

    resp = client.post(f"/api/v1/providers/groq/keys/{key_id}/recover", headers=auth)
    assert resp.status_code == 200

    pool = provider_router.get_pool_keys("groq")
    for pk in pool:
        if pk.db_id == key_id:
            assert pk.status == "active"
            break


# ══ 13. OpenAI-compat endpoint ════════════════════════════════════════════════

def test_openai_compat_endpoint(auth):
    resp = client.post("/api/v1/v1/chat/completions", json={
        "model": "llama-3.3-70b-versatile",
        "messages": [{"role": "user", "content": "Hello"}],
    }, headers=auth)
    assert resp.status_code in (200, 503)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])


# ══ 14. Auth — register ═══════════════════════════════════════════════════════

def test_register_new_user():
    resp = client.post("/api/v1/auth/register", json={
        "username": "testuser", "password": "securepass123"
    })
    assert resp.status_code == 201
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_register_duplicate_rejected():
    client.post("/api/v1/auth/register", json={"username": "dupuser", "password": "pass123"})
    resp = client.post("/api/v1/auth/register", json={"username": "dupuser", "password": "pass456"})
    assert resp.status_code == 409


def test_register_invalid_username():
    resp = client.post("/api/v1/auth/register", json={
        "username": "bad user!", "password": "pass123"
    })
    assert resp.status_code == 400


def test_register_then_login():
    client.post("/api/v1/auth/register", json={"username": "loginuser", "password": "mypassword"})
    resp = client.post("/api/v1/auth/login", json={"username": "loginuser", "password": "mypassword"})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


def test_register_with_email():
    resp = client.post("/api/v1/auth/register", json={
        "username": "emailuser", "password": "pass123", "email": "user@example.com"
    })
    assert resp.status_code == 201


def test_budget_persists_via_callback():
    """Budget persist callback is wired — configure should call it without error."""
    from app.economy.budget_manager import BudgetManager
    calls = []
    bm = BudgetManager()
    bm.set_persist_callback(lambda: calls.append(1))
    bm.configure(5.0, 0.8)
    assert len(calls) == 1
    bm.add_cost(1.0)
    assert len(calls) == 2
    bm.reset()
    assert len(calls) == 3
