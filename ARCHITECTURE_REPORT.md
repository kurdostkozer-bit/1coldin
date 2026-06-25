# KurdBox — Architecture Report
**Last updated:** 2026-06-24
**Version:** 2.0.0

---

## System Overview

KurdBox is an AI gateway platform that provides unified access to multiple LLM providers. It consists of three main components:

1. **Backend Gateway** (`backend/`) — FastAPI server, provider routing, key vault, streaming
2. **VSCode Extension** (`extension/`) — Chat panel, Agent panel, inline completions
3. **Desktop Key Store** (`KurdBox/desktop/`) — Python/tkinter GUI for managing API keys

---

## Backend Architecture

### Layer Diagram
```
HTTP Clients (VSCode ext, browser, API)
        |
    FastAPI (CORS + JWT auth middleware)
        |
   ┌────┴────────────────┐
   |                     |
auth/router.py     providers/router.py
chat/router.py
        |
   ChatService
        |
   ┌────┴──────────────────┐
   |                       |
ProviderRouter          adapters/
(router_service.py)     openai_compat.py
        |
   key_vault.py (Fernet AES-128)
        |
   storage/database.py (SQLAlchemy + SQLite/PostgreSQL)
```

### Key Components

| Component | File | Responsibility |
|-----------|------|----------------|
| App factory | `app/main.py` | FastAPI setup, lifespan, startup DB load |
| Provider orchestration | `app/providers/router_service.py` | In-memory registry, routing strategies, health tracking |
| Provider orchestrator entry | `app/providers/provider_orchestrator.py` | Canonical import point |
| Key pool | `app/providers/key_pool.py` | Per-key health: active → degraded → disabled |
| Adapter layer | `app/providers/adapters/` | OpenAI-compat HTTP adapter for all providers |
| Key vault | `app/security/key_vault.py` | Fernet encrypt/decrypt + JWT create/verify |
| Chat service | `app/chat/service.py` | Alias resolution, failover, streaming, usage recording |
| DB models | `app/storage/models.py` | Single source of truth for all ORM models |
| DB engine | `app/storage/database.py` | StaticPool + WAL mode for SQLite |

### Routing Strategies
- `smart` (default) — weighted score: latency × 0.4 + priority × 0.6 − failures × 0.2
- `priority` — lowest priority number wins
- `lowest_latency` — exponential moving average (α=0.2)
- `round_robin` — sequential cycling

### Provider Key States
```
active → degraded (3 consecutive failures) → disabled (6 failures, 30min cooldown)
                                          ↑_____________auto-recovery________________|
```

### Supported Providers
Groq, SambaNova, Google Gemini, Cerebras, Mistral, OpenRouter, NVIDIA NIM, GitHub Models, Perplexity, Fireworks

---

## VSCode Extension Architecture

### Component Tree
```
extension.ts (activate)
    ├── ApiClient (singleton) ← all HTTP to backend
    ├── ChatPanel (WebviewViewProvider)
    │       └── ChatController ← chat history, streaming
    │               └── UiBridge ← typed postMessage
    ├── AgentPanel (WebviewViewProvider)
    │       ├── AgentController ← tool-calling loop
    │       │       └── AgentLoop ← 20-iteration loop, message trimming
    │       └── ChatController
    ├── InlineCompletionProvider ← 600ms debounce
    └── HtmlBuilder ← shared HTML/CSS/JS injector
```

### UI Asset Structure
```
src/ui/
├── assets/
│   ├── shared.css    ← single CSS source for all panels
│   └── shared.js     ← shared utilities (providers, model selector, rendering)
├── html/
│   ├── chatView.html ← chat panel template
│   └── agentView.html ← agent panel template (no embedded CSS)
├── panels/
│   ├── ChatPanel.ts  ← WebviewViewProvider, zero business logic
│   └── AgentPanel.ts ← WebviewViewProvider, zero business logic
├── HtmlBuilder.ts    ← shared HTML builder (inline CSS+JS into template)
└── UiBridge.ts       ← typed postMessage abstraction
```

---

## Database Schema

### Tables

**providers** — owned by provider-service
- provider_id (unique), name, base_url, api_key (encrypted enc:...), models (JSON), priority, weight, status, requests_today, total_requests, failures, avg_latency_ms, cooldown_until

**provider_keys** — owned by provider-service
- provider_id, api_key (encrypted), label, is_active, status, weight, requests_used, consecutive_failures, failures, avg_latency_ms, disabled_until

**users** — owned by auth-service
- username (unique), email, hashed_password (bcrypt), is_active, is_admin

**usage_records** — owned by usage-recorder (write-only, fire-and-forget)
- provider_id, model, tokens_used, prompt_tokens, completion_tokens, latency_ms, success, estimated_cost_usd, timestamp

**budget** — owned by economy-service
- daily_limit_usd, spent_today_usd, cheap_threshold_pct, last_reset

### Connection
- Development: SQLite (`kurdbox.db`) with StaticPool + WAL mode
- Production: PostgreSQL via `DATABASE_URL` env var

---

## Security Model

| Concern | Implementation |
|---------|----------------|
| API key storage | Fernet AES-128, prefix `enc:`, never plaintext in DB |
| API key in memory | Decrypted at call time, cleared after request (`plain_key = ""`) |
| API key in API responses | Always masked (`****` or `key[:8]…key[-4:]`) |
| JWT tokens | HS256, 8-hour expiry, secret from `KURDOST_SECRET_KEY` env var |
| Demo token | Disabled by default, requires `DEMO_MODE=true` env var |
| .env file | Read-only permissions (icacls, owner-only) |
| Input validation | Regex on all ID params (`^[a-z0-9_-]{1,64}$`) |
| Error responses | Generic 503 to client, full details logged internally |
| Path traversal | PathSecurity sandbox in VSCode extension |

---

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Max failover retries | 3 |
| Max agent iterations | 20 |
| Agent message history | system + first user + last 20 messages |
| Key pool cooldown | 30 minutes (auto-recovery) |
| Provider cooldown | 60 seconds after 3 failures |
| Latency EMA alpha | 0.2 (new) / 0.8 (history) |
| Daily reset | UTC midnight (automatic, no cron needed) |
| Usage recording | Async fire-and-forget via `run_in_executor` |
| SQLite pool | StaticPool + WAL + NORMAL sync |

---

## Configuration

### Environment Variables (`backend/.env`)
| Variable | Required | Description |
|----------|----------|-------------|
| `KURDOST_SECRET_KEY` | Yes | JWT signing secret (hex 32 bytes) |
| `KURDOST_ENCRYPTION_KEY` | No | Fernet key (falls back to `.kurdost_enc_key` file) |
| `DATABASE_URL` | No | Default: `sqlite:///./kurdbox.db` |
| `DEMO_MODE` | No | Enable `/auth/demo-token` (default: false) |
| `HOST` | No | Default: `127.0.0.1` |
| `PORT` | No | Default: `5001` |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |

### VSCode Extension Settings (`kurdbox.*`)
| Setting | Default | Description |
|---------|---------|-------------|
| `serverUrl` | `http://localhost:5001` | Backend URL |
| `defaultModel` | `best-70b` | Default model alias |
| `inlineCompletions` | `true` | Enable inline completions |
| `agent.requireCommandConfirmation` | `false` | Approval gate for shell commands |
