# KurdBox — Project Structure (v2.0 — Single Backend)

## Repository Layout

```
KurdBox/                          ← Root workspace
├── backend/                      ← SINGLE backend source (Python/FastAPI)
│   ├── app/
│   │   ├── analytics/            ← RankingsService — provider intelligence (read-only)
│   │   │   └── rankings_service.py
│   │   ├── auth/                 ← JWT auth service + router + schemas + dependencies
│   │   ├── chat/                 ← ChatService + router + schemas
│   │   ├── economy/              ← Context economy engine (pure stateless)
│   │   │   ├── budget_manager.py     ← BudgetManager — daily spend tracking (singleton)
│   │   │   ├── context_classifier.py
│   │   │   ├── context_compressor.py
│   │   │   └── economy_middleware.py
│   │   ├── infrastructure/       ← System reliability layer
│   │   │   └── health_monitor.py     ← HealthMonitor — background provider probing
│   │   ├── providers/            ← ProviderRouter, PoolKey, adapters, aliases, config
│   │   │   ├── adapters/             ← OpenAI-compat adapter (covers all providers)
│   │   │   ├── aliases.py
│   │   │   ├── config.py             ← SUPPORTED_PROVIDERS, estimate_cost
│   │   │   ├── key_pool.py           ← PoolKey dataclass + health state machine
│   │   │   ├── provider_orchestrator.py ← canonical import point → router_service
│   │   │   ├── router_service.py     ← ProviderRouter (in-memory state, routing)
│   │   │   ├── router.py             ← FastAPI routes for /providers
│   │   │   └── schemas.py
│   │   ├── security/
│   │   │   └── key_vault.py          ← Fernet encrypt/decrypt + JWT helpers (pure)
│   │   ├── storage/
│   │   │   ├── database.py           ← SQLAlchemy engine + session factory
│   │   │   └── models.py             ← ORM models (DBProvider, DBUser, DBUsageRecord…)
│   │   ├── web/
│   │   │   └── dashboard.html
│   │   └── main.py               ← FastAPI app factory + lifespan (wires all services)
│   ├── desktop/
│   │   └── kurdost_key_store.py  ← GUI key manager (Python + tkinter)
│   ├── tests/
│   │   └── test_api.py           ← 29 integration tests (in-memory SQLite, no HTTP)
│   ├── .env                      ← Runtime secrets (not committed)
│   ├── .env.example
│   ├── .kurdost_enc_key          ← Fernet key file (auto-generated)
│   ├── kurdbox.db                ← SQLite DB (dev)
│   ├── requirements.txt
│   └── run_server.py
│
├── extension/                    ← VSCode extension (TypeScript)
│   └── src/
│       ├── agent/                ← AgentController, agentLoop, tools/, pathSecurity
│       ├── api/                  ← ApiClient, kurdostClient, types
│       ├── chat/                 ← ChatController, ModelSelector
│       ├── completion/           ← InlineCompletionProvider
│       ├── security/             ← PathSecurity
│       ├── ui/                   ← UiBridge, panels/, html/, assets/
│       ├── workspace/            ← WorkspaceContext collector
│       └── extension.ts
│
├── electron/                     ← Electron desktop app (planned)
├── _archive/                     ← Read-only archive (do not import from here)
│   ├── KurdBox_legacy/           ← Old monolith (router.py 900+ lines)
│   ├── kurdbox-backend/          ← server.log artifact
│   └── legacy/                   ← Deprecated code
│
├── API_REFERENCE.md
├── ARCHITECTURE_REPORT.md
└── DEPLOYMENT_GUIDE.md
```

## Service Dependency Graph

```
FastAPI app (main.py — lifespan)
    │
    ├── app.state.http_client       (httpx.AsyncClient — shared)
    ├── app.state.chat_service      (ChatService)
    │       └── ProviderRouter      ← routing + key pool
    │       └── economy_middleware  ← compress before send
    │       └── OpenAICompatAdapter ← HTTP to provider
    │       └── key_vault.decrypt() ← plaintext only at call time
    ├── app.state.budget            (BudgetManager — singleton)
    │       └── called by ProviderRouter.record_success()
    ├── app.state.rankings          (RankingsService — read-only view of ProviderRouter)
    └── app.state.health_monitor    (HealthMonitor — background task)
            └── calls ProviderRouter.restore_provider() on recovery
```

## Architectural Rules (Enforced)

1. `backend/app/` is the **only** source of truth — `_archive/` is read-only
2. Each service owns one responsibility — no God Objects
3. `ProviderRouter` = routing + state only; budget/analytics/health are separate services
4. Plaintext API keys never touch logs, DB, or API responses
5. Economy engine and key-vault are pure functions — zero I/O
6. All DB writes are async fire-and-forget via `loop.run_in_executor`
7. `BudgetManager` has its own `threading.Lock` — never shares lock with router
8. `HealthMonitor` only probes COOLDOWN providers — no unnecessary traffic
