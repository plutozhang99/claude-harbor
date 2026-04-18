## Project: claudegram v1 — P0 (MVP foundation)

## Spec Files
- docs/request_v1.md

## Current Phase: Phase 0 — plan approved, awaiting go-ahead to start Phase 1

## Interruption Reason


## Rate Limit State


## Review Roster (Phase 0 设定，项目中途不变)
固定:
- Slot 1 Code Review: typescript-reviewer agent (no typescript-review skill installed)
- Slot 2 Security Review: security-review skill
- Slot 3 Functional Coverage: functional-coverage skill (always)
条件性 (仅列出已激活的):
- Slot 4 DB Review: database-reviewer agent (SQLite schema + repo layer)
- Slot 6 Type Review: type-design-analyzer agent (TypeScript strict + Zod schemas)
- Slot 7 Error Review: silent-failure-hunter agent (webhook fire-and-forget + ingest 400/500 paths are the silent-failure hotspots)

Not activated for P0:
- Slot 5 A11y: no UI in P0 (PWA is P1)
- Slot 8 Perf: no high-perf requirement
- Slot 9 Clinical: N/A

## Active Task
Plan approved. Holding before Phase 1.1 pending user green light to start coding.

## Completed Tasks
(none)

## Pending Tasks (prioritized)

### Phase 1 — Project scaffold
- [ ] **1.1** Initialize `current/claudegram/` package: `package.json` (`type: module`, `engines.bun`, scripts), `tsconfig.json` strict, `.gitignore`, `.bun-version`, empty `src/` tree. — depends on: none
- [ ] **1.2** `src/config.ts` — Zod-validated env (`CLAUDEGRAM_PORT` default 8788, `CLAUDEGRAM_DB_PATH` default `./data/claudegram.db`, `CLAUDEGRAM_LOG_LEVEL` default `info`). Tests first. — depends on: 1.1 — **parallel with 1.3**
- [ ] **1.3** `src/logger.ts` — stderr, UTC ISO timestamp (`new Date().toISOString()`), level filter. No `console.log`. Tests first. — depends on: 1.1 — **parallel with 1.2**
- [ ] **1.4** `src/db/client.ts` — opens `bun:sqlite` `Database`, sets `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. Exports singleton + idempotent `close()`. Tests first. — depends on: 1.2

### Phase 2 — Storage
- [ ] **2.1** `src/db/schema.ts` + `src/db/migrate.ts` — SQL embedded as string literal (no `readFileSync`). Runs synchronously before HTTP listen. Tests: fresh → tables exist; second run → no-op. — depends on: 1.4
- [ ] **2.2** `src/repo/types.ts` — `Message`, `Session`, `MessageRepo`, `SessionRepo`; `Readonly<>` on returns. — depends on: 1.1 — **parallel with 1.4, 2.1**
- [ ] **2.3** `src/repo/sqlite.ts` — `SqliteMessageRepo.insert` via `INSERT ... ON CONFLICT(session_id, id) DO NOTHING`, `findBySession(session_id, before?, limit)`. `SqliteSessionRepo.upsert` via `ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, name=excluded.name` (never touches `first_seen_at`). TDD. All tests use `new Database(':memory:')`. Coverage ≥90%. — depends on: 2.1, 2.2

### Phase 3 — HTTP
- [ ] **3.1** `src/http.ts` + `src/server.ts` — Bun.serve entry, route dispatcher, migrate runs synchronously BEFORE `Bun.serve`. Reserve `/api/*` + `/web/*` → return 404 (no scaffold routing). — depends on: 1.3, 1.4
- [ ] **3.2** `src/routes/health.ts` — `GET /health`: `SELECT 1` against SQLite → `{ ok: true }`; DB error → `503 { ok: false }`. Tests first. — depends on: 3.1
- [ ] **3.3** `src/routes/ingest.ts` — `POST /ingest`: (a) `Content-Length` cap 1MB → 413, (b) Zod schema for spec §8.3 wire format, (c) 400 with `{ ok: false, error, issues }` on invalid, (d) upsert session then insert message, (e) success → `200 { ok: true, message_id }`, (f) repo error → `500 { ok: false, error }`. TDD. Coverage ≥90%. — depends on: 2.3, 3.1
- [ ] **3.4** Graceful shutdown — SIGTERM/SIGINT → `server.stop(true)` drain → `db.close()` → exit 0. Spawn-child signal test. — depends on: 1.4, 3.1

### Phase 4 — Fakechat integration (real multi-session support)
- [ ] **4.0** Scope STATE_DIR per session: `~/.claude/channels/fakechat/<scope>/` where `<scope>` = `CLAUDE_SESSION_ID` if set, else `pid-${process.pid}`. INBOX_DIR + OUTBOX_DIR derive from scoped STATE_DIR → isolated automatically. — depends on: none
- [ ] **4.1** Fakechat env loading — optional `CLAUDEGRAM_URL`, `CLAUDEGRAM_SERVICE_TOKEN_ID`, `CLAUDEGRAM_SERVICE_TOKEN_SECRET`. If unset → identical to upstream. — depends on: none
- [ ] **4.2** Stable session_id — try `CLAUDE_SESSION_ID` → fallback ULID generated once at startup; persisted to scoped STATE_DIR via `writeFileSync(..., { flag: 'wx' })` on first create; `mkdirSync(..., { recursive: true })` on STATE_DIR itself before write. — depends on: 4.0, 4.1
- [ ] **4.2b** FAKECHAT_PORT auto-pick — if `FAKECHAT_PORT` unset AND default 8787 is busy, try 8788…8797 sequentially, bind first free, log `fakechat: http://localhost:${actualPort}` to stderr. If `FAKECHAT_PORT` explicitly set, use it as-is (no fallback). — depends on: 4.0
- [ ] **4.3a** `postIngest(payload)` helper in fakechat — `fetch` with `AbortSignal.timeout(5000)`, `res.ok` check, structured stderr log on `{ network, non-2xx, timeout }`, never throws. Includes `CF-Access-Client-Id/Secret` headers when configured. Wired into `reply` tool handler + `deliver()`. Mocked tests: 500 / timeout / `ECONNREFUSED` → deliver still returns, structured log emitted. — depends on: 4.1, 4.2
- [ ] **4.3b** Multi-session integration verification — launch two fakechat processes with distinct `CLAUDE_SESSION_ID`, both POST to same claudegram, verify two `sessions` rows + correctly attributed `messages` rows in SQLite. — depends on: 3.3, 4.3a, 4.2b

### Phase 5 — Finalization
- [ ] **5.1** `current/claudegram/README.md` — run, env vars, spec §5 "bridge killed" trade-off matrix, P0 scope boundary, known gaps (subprocess-based integration test deferred; webhook no-retry). — depends on: none — **parallel with Phase 3**
- [ ] **5.2** In-process integration test — export `createServer()` factory from `src/server.ts`, call it from `bun test` with ephemeral port + tmpdir SQLite file; POST valid `/ingest`; read row back. (Subprocess-based variant deferred post-MVP, tracked in README "Known gaps".) — depends on: 3.3
- [ ] **5.3** Manual verification against spec §8.5 checklist (1-6) + multi-session dual-fakechat run (4.3b). — depends on: 4.3b, 5.2
- [ ] **5.4** Final review sweep (all 6 review slots) + commit. — depends on: 5.3

## Review Log
| Task | Code | Security | Functional | DB | Type | Error | Rounds | Result |
|------|------|---------|------------|----|----|------|--------|--------|
(none yet)

## Key Decisions & Accepted Risks

### Architecture
- 2026-04-18 Repo interface pattern from day 1 (spec §4.3). Only SQLite impl in P0.
- 2026-04-18 Zod at boundaries; types inferred from schemas, not duplicated.
- 2026-04-18 Single `current/claudegram/package.json` independent of `current/fakechat/package.json`. No monorepo tooling.
- 2026-04-18 No CF Access in P0 (spec §8.5 pt 6). Plain localhost HTTP.

### Schema (supersedes spec §8.4 DDL where noted)
- 2026-04-18 `messages` PK: **composite `(session_id, id)`** — spec text said "UNIQUE globally by (session_id, id)" but DDL had `id TEXT PRIMARY KEY`. Composite PK is authoritative.
- 2026-04-18 Idempotency SQL: `INSERT ... ON CONFLICT(session_id, id) DO NOTHING` (not `INSERT OR IGNORE`, which swallows all constraint errors).
- 2026-04-18 Add `messages.ingested_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)` — server clock, independent of sender `ts`.
- 2026-04-18 Add `CHECK(direction IN ('assistant','user'))` on `messages`.
- 2026-04-18 `sessions.name NOT NULL`: ingest defaults missing `session_name` to `session_id`. Keeps schema strict, avoids nullable column.
- 2026-04-18 Session upsert: `ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, name=excluded.name` — never overwrites `first_seen_at`.
- 2026-04-18 SQLite PRAGMAs at open: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. Prevents `SQLITE_BUSY` from concurrent P1 reads.

### HTTP contract
- 2026-04-18 `/ingest` response: `200 { ok: true, message_id }` | `400 { ok: false, error, issues }` | `413 { ok: false, error: 'payload too large' }` | `500 { ok: false, error }`.
- 2026-04-18 `/ingest` max body: 1 MB.
- 2026-04-18 `/health` depth: SELECT 1 against SQLite, `503` on DB failure.
- 2026-04-18 Reserve `/api/*` + `/web/*` prefixes: return 404 in P0, no scaffold routing.
- 2026-04-18 Server boot order: `migrate()` synchronous → `Bun.serve()`. No race between listen and table creation.
- 2026-04-18 Graceful shutdown: SIGTERM/SIGINT → `server.stop(true)` → `db.close()` → exit.

### Fakechat extension
- 2026-04-18 Webhook is fire-and-forget in P0, but with **observability**: `AbortSignal.timeout(5000)`, explicit `res.ok` check, structured stderr log. No retry queue (deferred to P2).
- 2026-04-18 Known P0 boundary: fakechat `deliver()` does not await webhook success — messages dropped if claudegram down. Documented in README. (spec §10 Q3)
- 2026-04-18 **Multi-session actually supported in P0** (not just planned): STATE_DIR scoped by `CLAUDE_SESSION_ID → pid` fallback (task 4.0), FAKECHAT_PORT auto-picks 8787→8797 if busy (task 4.2b). claudegram's `session_id` column was already multi-session by design.
- 2026-04-18 `/ingest` response shape is claudegram's own design — verified via MCP spec (Context7): the endpoint is fakechat → claudegram HTTP, NOT an MCP endpoint, so no Claude Code `CallToolResult` convention applies. The MCP `reply` tool's own return is handled internally in fakechat at `server.ts:119`.

### Testing
- 2026-04-18 TDD applies to: 1.2, 1.3, 1.4, 2.1, 2.3, 3.2, 3.3, 3.4, 4.3a, plus automated integration (5.2).
- 2026-04-18 Coverage targets: repo 90%, ingest 90%, config/logger/db-client 80%.
- 2026-04-18 Test isolation: repo tests use `new Database(':memory:')` per test; no shared fixture.

### Tooling
- 2026-04-18 Bun version pinned via `.bun-version` + `engines.bun` in `package.json`.
- 2026-04-18 Logger timestamp: `new Date().toISOString()` (UTC).
- 2026-04-18 Teams available: will use Teams for Phase 2/3 parallel coding if 2+ independent tasks active simultaneously; otherwise single agents.

### Resolved user decisions (2026-04-18)
- Q1 STATE_DIR scoping → `CLAUDE_SESSION_ID` if set, else `pid-${PID}`.
- Q2 Multi-session support → **actually implemented** in P0 (not just planned). Added task 4.2b for FAKECHAT_PORT auto-pick.
- Q3 Integration test → **(b) in-process** via exported `createServer()` factory; subprocess-based variant deferred post-MVP and documented in README as known gap.
- Q4 `/ingest` response shape → approved. Confirmed via MCP spec (Context7) that no Claude Code convention applies.
- Q5 Webhook observability → fire-and-forget with structured stderr log only. No retry queue until P2.

## Next Agent Prompt
<!-- Populated when user confirms go-ahead to start Phase 1.1 -->

Task: Phase 1.1 — initialize `current/claudegram/` Bun/TypeScript project skeleton.

Project root: `/Users/plutozhang/Documents/claudegram`. Work in `current/claudegram/` (sibling to existing `current/fakechat/`). Do NOT touch `legacy/` or `current/fakechat/`.

Language/stack: Bun + TypeScript strict, ESM (`"type": "module"`), `bun:sqlite` (built-in, no dep), `zod` (runtime dep).

Create only these files:
- `current/claudegram/package.json`: `name: "claudegram"`, `type: "module"`, `engines.bun: ">=1.1.0"`, scripts `{ dev: "bun run src/server.ts", test: "bun test" }`, deps `{ zod: "^3.23.0" }`, devDeps `{ "@types/bun": "^1.3.10" }`. No other deps.
- `current/claudegram/tsconfig.json`: strict, `moduleResolution: "bundler"`, `target: "esnext"`, `types: ["bun"]`, no emit.
- `current/claudegram/.bun-version`: pin to the current installed `bun --version` output.
- `current/claudegram/.gitignore`: `node_modules/`, `data/`, `*.db`, `*.db-wal`, `*.db-shm`.
- `current/claudegram/src/` directory (empty — later tasks populate).

Rules:
- No console.log anywhere.
- No new top-level deps beyond `zod` (+ @types/bun dev).
- Do NOT write any code in `src/` yet — just the empty tree.

When done: report what was created + the pinned Bun version, then stop. No code review needed for this scaffold task (1.1 is pure config).
