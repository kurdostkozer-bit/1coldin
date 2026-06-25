# KurdBox — Product Overview

## Project Purpose & Value Proposition

KurdBox is an AI gateway and developer tooling platform that acts as a unified proxy for multiple LLM providers (Groq, Gemini, Mistral, SambaNova, etc.). It routes requests intelligently, manages API keys securely, enforces budgets, and exposes AI capabilities through multiple client interfaces: a VSCode extension, an Electron desktop app, and a web dashboard.

The platform solves the multi-provider fragmentation problem: developers get a single endpoint, single auth token, and smart routing — the gateway handles provider selection, failover, rate limiting, and cost optimization automatically.

## Key Features & Capabilities

### Backend Gateway
- **Smart Provider Routing**: Alias-based model resolution (e.g. `best-70b` → best available 70B model), round-robin and latency-based strategies, automatic failover with up to 3 retries
- **API Key Vault**: Fernet AES-128 encryption for stored keys, plaintext only in memory at call time, never in logs or DB
- **Budget Guard**: Daily spend tracking per provider, hard limits enforced before routing, midnight reset
- **Context Economy Engine**: Classifies task type (code/reasoning/chat), compresses messages to fit token budgets, caps max_tokens automatically — pure stateless functions
- **JWT Authentication**: HS256 tokens, bcrypt password hashing, demo token support, auto-refresh
- **Usage Recording**: Async fire-and-forget writes of tokens, cost, latency per request
- **Rate Limiting**: Per-IP and per-user request throttling at the gateway layer
- **SSE Streaming**: Streaming responses for chat and agent runs
- **Agent Orchestration**: Multi-step tool-calling loop (max 20 iterations), server-side session management, SSE event streaming, approval gate for destructive operations

### VSCode Extension (KurdBox AI)
- **AI Chat Panel**: Persistent chat history, streaming responses, model selector
- **Agent Panel**: Agentic code editing — reads workspace context, writes files, runs commands
- **Inline Completions**: Debounced (600ms) inline code completions powered by the gateway
- **Debug Error Command**: One-click error analysis via `Ctrl+Shift+D`
- **Workspace Context Collection**: File tree (max 3 levels), active file content (max 100KB), git diff
- **Path Security**: Sandboxed file access — prevents path traversal attacks

### Desktop Key Store (kurdost_key_store.py)
- GUI app for managing provider API keys
- Supports Arabic, Kurdish (Sorani), and English UI
- Encrypted storage with audit logging and automatic backups
- File-lock based concurrency safety

### Electron Desktop App
- Full desktop wrapper around the gateway
- Settings UI reads live provider list from backend API
- Auto-updater support

## Target Users & Use Cases

- **Individual developers**: Use the VSCode extension to get AI chat and inline completions across all major providers from a single subscription/key pool
- **Teams**: Self-host the backend gateway to share a pool of API keys across team members with budget controls
- **Kurdish/Arabic-speaking developers**: Multilingual UI support in the desktop key manager
- **Cost-conscious users**: Economy engine minimizes token usage; budget guard prevents runaway costs
- **Power users**: Direct API access via the gateway for scripting and SDK integration
