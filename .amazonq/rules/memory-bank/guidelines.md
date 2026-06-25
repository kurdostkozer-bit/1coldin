# KurdBox — Development Guidelines

## Code Quality Standards

### Python
- Files start with a module-level docstring describing version, responsibilities, and key features
- `from __future__ import annotations` used in files that need forward references
- All imports grouped: stdlib → third-party → local, with a blank line between groups
- Type annotations used throughout — `Optional[str]`, `List[Provider]`, `Dict[str, Any]`, `Tuple[bool, str]`
- Dataclasses (`@dataclass`) for plain data structures (PoolKey, KeyRecord, UpdateResult)
- Named loggers per module: `logger = logging.getLogger("kurdost.<module>")`
- Module-level constants in UPPER_SNAKE_CASE with inline comments

### TypeScript
- Files start with a JSDoc block listing responsibilities and requirement references
- `private _fieldName` prefix for private instance fields
- `// -----------------------------------------------------------------------` section separators used within classes
- Interface imports grouped at top, implementation imports separate
- `const` for all immutable references; `Set` and `Map` preferred over arrays for lookups
- Optional chaining `?.` and nullish coalescing `??` used consistently

---

## Security Patterns (Critical — Never Violate)

### API Key Handling
```python
# ALWAYS decrypt at use time — never store plaintext in DB
plain_api_key = decrypt_key(api_key)
headers = {"Authorization": f"Bearer {plain_api_key}"}
# plain_api_key goes out of scope after use — never log it

# ALWAYS encrypt on save
db.add(DBProviderKey(api_key=encrypt_key(api_key_plain), ...))

# Key preview for UI — never expose full key
key_preview = api_key[:8] + "…" + api_key[-4:] if len(api_key) > 12 else "****"
```

### Input Validation
```python
# Validate all path/ID parameters with regex before DB lookup
_PROVIDER_ID_RE = re.compile(r"^[a-z0-9_-]{1,64}$")

if not _PROVIDER_ID_RE.match(provider_id):
    raise HTTPException(status_code=400, detail="Invalid provider_id format.")
```

### Error Responses
- Never expose internal details (tried providers, full error messages) to API clients
- Log full details internally, return generic message to client:
```python
logger.warning(f"All providers failed: tried={tried}, last_error={last_error}")
raise HTTPException(status_code=503, detail="Service temporarily unavailable. Please try again later.")
```

---

## Structural Conventions

### FastAPI Route Organization
- Routes grouped by domain with `# ══ DOMAIN ══` section banners
- Each route handler is thin: validates → delegates to orchestrator/service → returns
- All write operations: validate → add to in-memory state first → then persist to DB (rollback if DB fails)
- Rate limiting applied via `Depends(rate_limit_*)` on every public endpoint
- Auth applied via `Depends(get_current_user)` on all non-public endpoints
- `response_model=` specified on all GET and POST endpoints

```python
@router.post("/providers", response_model=Provider, tags=["providers"])
async def add_provider(body: ProviderAdd, db: Session = Depends(get_db),
                       current_user: dict = Depends(get_current_user)):
    # 1. validate
    # 2. add to orchestrator (in-memory)
    # 3. persist to DB (rollback orchestrator if DB fails)
    # 4. return
```

### Class Design
- OrchestratorState: `threading.RLock` wraps ALL reads and writes to shared state
- Background DB writes dispatched to thread pool via `loop.run_in_executor(None, fn)`
- Callbacks injected via `set_*_callback()` to decouple state from I/O:
```python
orchestrator.set_stats_callback(_sync_provider_stats_bg)
```

### Config/Desktop (Python GUI)
- All user-visible strings in `TRANSLATIONS` dict, keyed by `"en"`, `"ar"`, `"ku"`
- `ConfigManager` class owns all YAML read/write with file-lock, backup, atomic write, and rollback
- Write pattern: `lock → backup → validate → atomic_write → verify → log → return` (rollback on any exception)
- All background operations in `daemon=True` threads to keep GUI responsive

---

## Naming Conventions

### Python
- Classes: PascalCase (`OrchestratorState`, `BudgetManager`, `PoolKey`)
- Functions: snake_case; private helpers prefixed with `_` (`_do_chat`, `_sync_budget_to_db`)
- Module-level singletons: lowercase (`orchestrator`, `_backend_sync`)
- Constants: UPPER_SNAKE_CASE (`MAX_RETRIES`, `COOLDOWN_SECONDS`, `KEY_DEGRADED_FAILURES`)
- DB models: `DB` prefix (`DBProvider`, `DBUser`, `DBProviderKey`)
- Pydantic/domain models: plain name (`Provider`, `PoolKey`, `UsageRecord`)

### TypeScript
- Classes: PascalCase (`AgentLoop`, `ApiClient`, `ChatController`)
- Private fields: `_camelCase` with underscore prefix (`_messages`, `_status`, `_stopRequested`)
- Constants: UPPER_SNAKE_CASE (`DEFAULT_MAX_ITERATIONS`, `APPROVAL_REQUIRED_TOOLS`)
- Sets used for O(1) membership checks: `new Set(['write_file', 'delete_file', 'run_command'])`

---

## Error Handling Patterns

### Python — Try/Except
- HTTP status codes handled explicitly: 429 → mark_limited, 5xx → record_failure, 4xx → raise to client
- Exception re-raises preserve original with `from ex`
- All background tasks have try/except that log warnings but never raise

```python
try:
    # operation
except HTTPException:
    raise  # let FastAPI handle it
except Exception as e:
    logger.warning(f"Operation failed: {e}")
    # return None or fallback
```

### TypeScript — Never Abort Loop on Tool Error
```typescript
try {
    result = await executeTool(...)
} catch (err) {
    // Requirement 6.6: never abort loop on tool error
    const msg = err instanceof Error ? err.message : String(err);
    result = { tool_call_id: toolCallId, role: 'tool', content: `Error: ${msg}`, isError: true };
}
```

---

## Testing Patterns

### Python Test Structure
- Test file sets up in-memory SQLite DB and overrides `get_db` dependency
- `app.dependency_overrides[get_db] = override_get_db` pattern
- Fixtures scoped to `"function"` — clean DB state per test
- Fixture hierarchy: `clean_db` → `auth_headers` → `groq_provider`
- External services mocked via `AsyncMock` — no real HTTP in tests:
```python
_mock_http_client.post = AsyncMock(side_effect=Exception("no real http in tests"))
app.state.http_client = _mock_http_client
```
- Test headless environments: mock `tkinter` before importing GUI modules
- Test names describe behavior: `test_add_provider_duplicate_rejected`, `test_budget_tight_when_over_threshold`
- Test assertions check both success conditions AND error status codes (`assert resp.status_code in [401, 403]`)

### TypeScript Tests
- `fast-check` for property-based testing
- Tests co-located with source: `agentLoop.test.ts` next to `agentLoop.ts`

---

## Async Patterns

### Python
- `async def` route handlers with `await` for all I/O
- Blocking DB writes offloaded with `loop.run_in_executor(None, sync_fn)` — never `await` sync SQLAlchemy in async context
- SSE streaming via `StreamingResponse(event_gen(), media_type="text/event-stream")`
- `async with http_client.stream(...)` for streaming provider responses

### TypeScript Agent Loop
- `while` loop with `this._stopRequested` flag checked at top of each iteration AND before each tool call
- All tool executors are `async` and awaited individually
- Callbacks (`onStepUpdate`, `onToolCall`, `onToolResult`, `onFinalAnswer`, `onError`) injected as options — never directly referenced
- `stop()` sets a flag; the loop checks it cooperatively (not forced termination)

---

## Architectural Rules (From Codebase)

1. In-memory state is always modified first; DB is a durable mirror (never the source of truth at runtime)
2. Budget tracking is in-memory with async DB sync — `BudgetManager` uses its own `threading.Lock`
3. Provider routing uses an exponential moving average for latency: `avg * 0.8 + new * 0.2`
4. Pool keys have three states: `active → degraded (3 failures) → disabled (6 failures)` with 30-minute auto-recovery
5. Max failover retries = 3 (`MAX_RETRIES = 3`); max agent iterations = 20 (`DEFAULT_MAX_ITERATIONS = 20`)
6. Economy middleware is always applied before sending to provider — never bypass context compression
7. All file writes use atomic write (temp file + `os.replace`) — never write directly to target path
8. `FileLock` used for any concurrent file access in the desktop app

---

## Common Code Idioms

### Weighted Random Selection (Python)
```python
r = random.random() * total
cumulative = 0.0
for key, w in zip(active, weights):
    cumulative += w
    if r < cumulative:
        return key.api_key, key
return active[-1].api_key, active[-1]  # fallback
```

### Exponential Moving Average (Python)
```python
self.avg_latency_ms = (
    latency_ms if self.avg_latency_ms == 0
    else self.avg_latency_ms * 0.8 + latency_ms * 0.2
)
```

### Atomic YAML Write (Python)
```python
fd, tmp_name = tempfile.mkstemp(prefix="kurdost_", suffix=".tmp", dir=str(target.parent))
os.close(fd)
tmp_path = Path(tmp_name)
try:
    with tmp_path.open("w", encoding="utf-8", newline="\n") as f:
        yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False)
    os.replace(str(tmp_path), str(target))
finally:
    if tmp_path.exists():
        tmp_path.unlink(missing_ok=True)
```

### Status Callback Pattern (TypeScript)
```typescript
private _setStatus(status: LoopStatus): void {
    this._status = status;
    this.options.onStatusChange?.(status);
}
```

### Tool Args Parsing (TypeScript)
```typescript
let args: Record<string, unknown>;
try {
    args = JSON.parse(toolCall.function.arguments);
} catch {
    return { tool_call_id: toolCallId, role: 'tool',
             content: `Error: Could not parse tool arguments as JSON`, isError: true };
}
```

---

## Multilingual Support

- Detect language from user input before displaying any UI string
- `detect_language(text)` returns `"ku"` (Kurdish Sorani), `"ar"` (Arabic), or `"en"` (English)
- Kurdish detected by presence of unique Sorani chars; Arabic by Unicode range `[\u0600-\u06FF]`
- Always use `TRANSLATIONS[detect_language(text)]["key"]` — never hardcode display strings
- YAML files written with `allow_unicode=True` to support Arabic/Kurdish content
