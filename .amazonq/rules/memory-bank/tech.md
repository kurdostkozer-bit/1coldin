# KurdBox — Technology Stack

## Programming Languages

| Layer | Language | Version |
|-------|----------|---------|
| Backend gateway | Python | 3.8+ (3.10+ recommended) |
| VSCode extension | TypeScript | ^5.3.0 |
| Electron desktop | JavaScript (Node.js) | LTS |
| Desktop key store | Python | 3.8+ |
| Web dashboard | HTML / Vanilla JS | — |

## Backend — Python Stack

### Core Framework
- **FastAPI** `0.138.0` — async HTTP framework, OpenAPI auto-docs, dependency injection
- **Uvicorn** `0.49.0` — ASGI server
- **Starlette** `1.3.1` — underlying ASGI toolkit (SSE, middleware)

### Database & ORM
- **SQLAlchemy** `2.0.51` — async-compatible ORM
- **Alembic** `1.18.4` — DB schema migrations
- **SQLite** (dev) / **PostgreSQL** (prod via `psycopg2-binary 2.9.12`)

### Authentication & Security
- **python-jose** `3.5.0` — JWT creation and verification (HS256)
- **bcrypt** `5.0.0` — password hashing
- **cryptography** `49.0.0` — Fernet AES-128 key encryption (key vault)
- **ecdsa** `0.19.2` — elliptic curve support

### HTTP Client
- **httpx** `0.28.1` — async HTTP client for provider API calls
- **httpcore** `1.0.9` — underlying transport

### Validation
- **Pydantic** `2.13.4` — request/response schema validation, settings management
- **pydantic_core** `2.46.4`
- **email-validator** `2.3.0`

### Utilities
- **colorama** `0.4.6` — colored terminal output
- **anyio** `4.14.0` — async concurrency primitives

## VSCode Extension — TypeScript Stack

### Runtime
- **VSCode API** `^1.85.0` — extension host APIs (WebviewView, commands, configuration)
- **Node.js** — extension host runtime

### Build System
- **TypeScript compiler** (`tsc`) — compiles to `out/` directory
- `tsconfig.json` — strict mode, ES2020 target
- Output: `./out/extension.js`

### Testing
- **Mocha** `^11.7.6` — test runner
- **ts-node** `^10.9.2` — TypeScript execution for tests
- **fast-check** `^4.8.0` — property-based testing
- `@types/mocha`, `@types/node`, `@types/vscode`

### Packaging
- **@vscode/vsce** `^2.22.0` — produces `.vsix` package (`kurdbox-1.0.0.vsix`)

### No Runtime Dependencies
The extension has zero production npm dependencies — all logic is in TypeScript compiled to plain JS, communicating with the backend over HTTP/SSE.

## Electron Desktop App

### Stack
- **Electron** — main + renderer process separation
- **contextBridge** — secure IPC (no nodeIntegration in renderer)
- **electron-updater** — auto-update support
- `preload.js` — exposes safe IPC channels to renderer

### Files
- `KurdBox/electron-app/main.js` — Electron main process
- `KurdBox/electron-app/package.json` — Electron app manifest
- `KurdBox/electron-app/preload.js` — contextBridge setup

## Desktop Key Store (Python GUI)

- **tkinter** — built-in Python GUI toolkit
- **PyYAML** — `config.yaml` read/write for key storage
- **cryptography** — optional Fernet encryption for stored keys
- **threading** — background operations (non-blocking GUI)
- File lock (`.config.lock`) + audit log (`kurdost_audit.log`) + auto backups

## Development Commands

### Backend (KurdBox/ legacy)
```bash
pip install -r requirements.txt
python main.py                    # starts uvicorn on default port
```

### Backend (backend/ new)
```bash
cd backend
pip install -r requirements.txt
python run_server.py              # or uvicorn app.main:app --reload
# Windows scripts also available:
start_dev.ps1                     # PowerShell dev start
start.bat                         # CMD start
```

### VSCode Extension
```bash
cd extension
npm install
npm run compile                   # tsc -p ./
npm run watch                     # tsc --watch (dev)
npm test                          # mocha via ts-node
npm run package                   # vsce package → .vsix
```

### Desktop Key Store
```bash
cd KurdBox/desktop
pip install pyyaml cryptography
python kurdost_key_store.py
# Or build standalone executable:
build_app.bat                     # PyInstaller via spec file
```

## Configuration & Environment

### Backend Environment Variables (`.env`)
```
DATABASE_URL=sqlite:///./kurdbox.db  # or postgresql://...
JWT_SECRET=<secret>
ENCRYPTION_KEY_FILE=.kurdost_enc_key
# Provider API keys stored encrypted in DB, not in env
```

### VSCode Extension Settings (`kurdbox.*`)
| Setting | Default | Description |
|---------|---------|-------------|
| `serverUrl` | `http://localhost:5001` | Backend gateway URL |
| `defaultProvider` | `""` (auto) | Override provider selection |
| `defaultModel` | `best-70b` | Default model alias |
| `inlineCompletions` | `true` | Enable inline code completions |
| `agent.requireCommandConfirmation` | `false` | Require approval before shell commands |

### Keyboard Shortcuts (VSCode)
| Command | Windows/Linux | macOS |
|---------|--------------|-------|
| Open Chat | `Ctrl+Shift+K` | `Cmd+Shift+K` |
| Open Agent | `Ctrl+Shift+A` | `Cmd+Shift+A` |
| Debug Error | `Ctrl+Shift+D` | `Cmd+Shift+D` |

## Supported LLM Providers

Configured via `providers_config.py` / `backend/config/providers.py`:
- Groq
- Google Gemini
- Mistral
- SambaNova
- Additional providers via adapter pattern (`backend/app/providers/adapters/`)

Model aliases (e.g. `best-70b`, `best-small`) resolve to concrete model names per provider, configurable in `aliases.py`.
