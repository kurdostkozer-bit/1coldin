# KurdBox — API Reference
**Base URL:** `http://localhost:5001/api/v1`
**Auth:** `Authorization: Bearer <jwt_token>` on all endpoints except `/auth/login` and `/providers/supported`

---

## Authentication

### POST /auth/login
Get a JWT token.
```json
// Request
{ "username": "string", "password": "string" }

// Response 200
{ "access_token": "eyJ..." }

// Response 401
{ "detail": "Invalid credentials" }
```

### POST /auth/demo-token
Get a demo token (requires `DEMO_MODE=true` in server env).
```json
// Response 200
{ "access_token": "eyJ..." }

// Response 403 (DEMO_MODE=false)
{ "detail": "Demo mode is disabled." }
```

### GET /auth/me
Get current user info.
```json
// Response 200
{
  "id": 1,
  "username": "admin",
  "email": "admin@example.com",
  "is_active": true,
  "created_at": "2026-01-01 00:00:00"
}
```

---

## Providers

### GET /providers
List all active providers (auth required).
```json
// Response 200 — array of Provider objects
[
  {
    "id": "groq",
    "name": "Groq Cloud",
    "base_url": "https://api.groq.com/openai/v1",
    "api_key": "****",
    "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    "priority": 1,
    "weight": 2.0,
    "status": "active",
    "requests_today": 42,
    "total_requests": 1024,
    "avg_latency_ms": 320.5
  }
]
```

### GET /providers/supported
List all supported provider types (no auth required).
```json
// Response 200
[
  {
    "id": "groq",
    "name": "Groq Cloud",
    "key_hint": "Starts with: gsk_",
    "pricing": { "input": 0.05, "output": 0.10 }
  }
]
```

### POST /providers
Add a provider (auth required).
```json
// Request
{ "provider_type": "groq", "api_key": "gsk_..." }
// provider_type can be "auto" to auto-detect from key prefix

// Response 200 — Provider object (api_key masked)
// Response 400 — Invalid key / unknown provider
// Response 409 — Provider already added
```

### GET /providers/{provider_id}
Get one provider (auth required).
```
// Response 200 — Provider object
// Response 404 — Not found
```

### DELETE /providers/{provider_id}
Remove a provider and all its keys (auth required).
```json
// Response 200
{ "detail": "Provider 'groq' removed" }
```

### POST /providers/{provider_id}/enable
Re-enable a provider (auth required).
```json
// Response 200
{ "detail": "enabled" }
```

### POST /providers/{provider_id}/disable
Disable a provider (auth required).
```json
// Response 200
{ "detail": "disabled" }
```

---

## Provider Keys (Pool)

### GET /providers/{provider_id}/keys
List pool keys for a provider (auth required). Keys are never returned in full.
```json
// Response 200
[
  {
    "id": 1,
    "provider_id": "groq",
    "label": "main key",
    "is_active": true,
    "status": "active",
    "weight": 10.0,
    "requests_used": 200,
    "failures": 0,
    "consecutive_failures": 0,
    "avg_latency_ms": 310.2,
    "key_preview": "gsk_paiE…nJUI"
  }
]
```

### POST /providers/{provider_id}/keys
Add a key to a provider's pool (auth required).
```json
// Request
{ "api_key": "gsk_...", "label": "backup key", "weight": 5.0 }

// Response 200 — ProviderKeyInfo object
// Response 400 — Empty key
// Response 404 — Provider not found
```

### DELETE /providers/{provider_id}/keys/{key_id}
Remove a pool key (auth required).
```json
// Response 200
{ "detail": "Key 1 removed" }
```

---

## Chat

### POST /chat
Send a chat message. Set `stream: true` for streaming SSE response.
```json
// Request
{
  "model": "best-70b",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 2048,
  "provider_hint": "groq",
  "strategy": "smart"
}

// Response 200 (stream: false)
{
  "provider_used": "groq",
  "latency_ms": 312.5,
  "result": {
    "choices": [{ "message": { "role": "assistant", "content": "Hello! How can I help?" } }],
    "usage": { "prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18 }
  }
}

// Response 200 (stream: true) — text/event-stream
data: {"type":"start","provider":"groq"}
data: {"choices":[{"delta":{"content":"Hello"}}]}
data: {"choices":[{"delta":{"content":"!"}}]}
data: {"type":"done"}

// Response 503
{ "detail": "Service temporarily unavailable. Please try again later." }
```

### POST /chat/stream
Same as `POST /chat` with `stream: true` — always returns SSE.

---

## System

### GET /health
```json
// Response 200
{ "status": "ok", "version": "2.0.0", "providers_active": 3 }
```

---

## Model Aliases

| Alias | Resolves to |
|-------|-------------|
| `best-70b` | llama-3.3-70b-versatile, Meta-Llama-3.3-70B-Instruct, ... |
| `best-8b` | llama-3.1-8b-instant, Meta-Llama-3.1-8B-Instruct, ... |
| `best-flash` | gemini-2.5-flash, gemini-1.5-flash, llama-3.1-8b-instant |
| `best-large` | Meta-Llama-3.1-405B-Instruct, llama-3.3-70b-versatile |
| `best-coder` | codestral-latest, llama-3.3-70b-versatile |
| `best-free` | google/gemini-flash-1.5-free, meta-llama/llama-3-8b-instruct:free |
| `best-cheap` | llama-3.1-8b-instant, llama3.1-8b, gemini-1.5-flash |
| `best-reasoning` | sonar-reasoning, gemini-2.5-pro, mistral-large-latest |

---

## Error Codes

| Status | Meaning |
|--------|---------|
| 400 | Invalid input (bad format, empty field) |
| 401 | Missing or invalid JWT token |
| 403 | Forbidden (demo mode disabled, account inactive) |
| 404 | Resource not found |
| 409 | Conflict (provider already exists) |
| 503 | All providers failed or unavailable |
