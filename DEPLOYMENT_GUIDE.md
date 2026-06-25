# KurdBox — Deployment Guide

---

## 1. Requirements

| Component | Requirement |
|-----------|-------------|
| Python | 3.10+ |
| Node.js | 18+ LTS |
| Database | SQLite (dev) or PostgreSQL 14+ (prod) |
| OS | Linux / macOS / Windows |

---

## 2. Backend — First-Time Setup

### 2.1 Clone and install
```bash
cd backend
pip install -r requirements.txt
```

### 2.2 Generate secrets
```bash
# JWT secret
python -c "import secrets; print(secrets.token_hex(32))"

# Fernet encryption key
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 2.3 Create `.env`
```bash
cp .env.example .env
```
Fill in the values:
```
KURDOST_SECRET_KEY=<generated_jwt_secret>
KURDOST_ENCRYPTION_KEY=<generated_fernet_key>
DATABASE_URL=sqlite:///./kurdbox.db    # or postgresql://user:pass@host/dbname
DEMO_MODE=false
HOST=127.0.0.1
PORT=5001
CORS_ORIGINS=http://localhost:5000,http://localhost:5001
```

### 2.4 Restrict `.env` permissions
```bash
# Linux / macOS
chmod 600 .env

# Windows
icacls .env /inheritance:r /grant:r "%USERNAME%:R"
```

### 2.5 Initialize the database
```bash
python -c "from app.storage.database import init_db; from app.storage import models; init_db()"
```

### 2.6 Migrate from legacy kurdost.db (if applicable)
```bash
python database_migration.py --old ../KurdBox/kurdost.db --new ./kurdbox.db --dry-run
python database_migration.py --old ../KurdBox/kurdost.db --new ./kurdbox.db
```

### 2.7 Start the server
```bash
# Development
python -m uvicorn app.main:app --host 127.0.0.1 --port 5001 --reload

# Windows scripts
start.bat
start_dev.ps1

# Production (behind nginx/caddy)
python -m uvicorn app.main:app --host 0.0.0.0 --port 5001 --workers 2
```

---

## 3. Backend — Production Checklist

- [ ] `DEMO_MODE=false` in `.env`
- [ ] `DATABASE_URL` points to PostgreSQL (not SQLite)
- [ ] `.env` file permissions restricted (owner read-only)
- [ ] Running behind a reverse proxy (nginx / caddy) with TLS
- [ ] `CORS_ORIGINS` contains only trusted domains
- [ ] `KURDOST_SECRET_KEY` is at least 32 random bytes
- [ ] `.kurdost_enc_key` file backed up securely (losing it = losing all encrypted keys)
- [ ] Log rotation configured for `server.log`

---

## 4. VSCode Extension — Build and Install

### 4.1 Build
```bash
cd extension
npm install
npm run compile       # development
npm run package       # produces kurdbox-1.0.0.vsix
```

### 4.2 Install
```bash
code --install-extension kurdbox-1.0.0.vsix
```

Or via VSCode UI: Extensions → "..." → Install from VSIX

### 4.3 Configure
Open VSCode Settings (`Ctrl+,`) and set:
```
kurdbox.serverUrl = http://localhost:5001   (or your production URL)
kurdbox.defaultModel = best-70b
kurdbox.inlineCompletions = true
```

---

## 5. Adding API Keys (After Deployment)

### Via API
```bash
# Get a token first
TOKEN=$(curl -s -X POST http://localhost:5001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<pass"}' | jq -r .access_token)

# Add a provider
curl -X POST http://localhost:5001/api/v1/providers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider_type": "groq", "api_key": "gsk_..."}'
```

### Via VSCode Extension
Open Chat panel → Settings → Add Provider

---

## 6. Health Check
```bash
curl http://localhost:5001/api/v1/health
# {"status":"ok","version":"2.0.0","providers_active":3}
```

---

## 7. Upgrading

```bash
cd backend
git pull
pip install -r requirements.txt
# DB migrations are additive — no manual migration needed for minor updates
python -m uvicorn app.main:app --host 127.0.0.1 --port 5001 --reload
```

---

## 8. Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `KURDOST_SECRET_KEY not set` | Missing env var | Add to `.env` |
| `Cannot decrypt API key` | Wrong encryption key | Restore `.kurdost_enc_key` from backup |
| `503 Service temporarily unavailable` | All providers failed/limited | Check provider status via `GET /api/v1/providers` |
| `401 Invalid or expired token` | JWT expired (8h) | Re-login or use demo token (dev only) |
| Extension not connecting | Wrong `serverUrl` | Update `kurdbox.serverUrl` in settings |
