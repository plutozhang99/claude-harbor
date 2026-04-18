# claudegram

P0 MVP: HTTP ingest + SQLite store + optional fakechat fork webhook. No auth, localhost only.

---

## Quick start

1. Install [Bun](https://bun.sh) >= 1.1.0.
2. Install dependencies:
   ```bash
   cd current/claudegram && bun install
   ```
3. Start the server:
   ```bash
   bun run src/main.ts
   ```
   Default port: **8788**. The server logs `server_ready { port: 8788 }` to stderr when ready.
4. Verify:
   ```bash
   curl http://localhost:8788/health
   # {"ok":true}
   ```

---

## Env vars

| Variable | Default | Description |
|---|---|---|
| `CLAUDEGRAM_PORT` | `8788` | HTTP listen port (1–65535) |
| `CLAUDEGRAM_DB_PATH` | `./data/claudegram.db` | SQLite file path. Directory is auto-created; `..` segments are rejected. |
| `CLAUDEGRAM_LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error` |

---

## HTTP API

| Method | Path | Status codes | Notes |
|---|---|---|---|
| `GET` | `/health` | 200 / 503 | `SELECT 1` health probe; 503 if SQLite unreachable |
| `POST` | `/ingest` | 200 / 400 / 413 / 500 | 1 MiB body cap, streaming enforced |
| `*` | `/api/*` | 404 | Reserved for P1 (sessions + messages API) |
| `*` | `/web/*` | 404 | Reserved for P1 (PWA static assets) |

---

## `/ingest` contract

### Request body (JSON)

```json
{
  "session_id": "...",
  "session_name": "...(optional)",
  "message": {
    "id": "...",
    "direction": "user",
    "ts": 1234567890000,
    "content": "..."
  }
}
```

`direction` is `"user"` or `"assistant"`. `ts` is epoch milliseconds. `session_name` defaults to `session_id` when omitted.

### Response shapes

| Status | Body |
|---|---|
| 200 | `{"ok":true,"message_id":"..."}` |
| 400 | `{"ok":false,"error":"invalid json"}` or `{"ok":false,"error":"invalid payload","issues":[...]}` |
| 413 | `{"ok":false,"error":"payload too large"}` |
| 500 | `{"ok":false,"error":"internal error"}` |

---

## Architecture — "bridge killed" trade-off matrix

Trade-offs P0 accepts. Source: spec §5 + PROGRESS.md Key Decisions.

| Feature | P0 stance | Rationale |
|---|---|---|
| Webhook retry queue | Not implemented; fire-and-forget with structured stderr log | P2 concern. Adds complexity; P0 is localhost + trusted client. |
| Auth (CF Access) | Not in server; headers consumed by client only | Localhost-only in P0 (spec §8.5 pt 6). CF Access wired in P4. |
| Schema versioning | Skipped; `IF NOT EXISTS` silently hides column drift | `TODO(P1)` in `migrate.ts`. |
| Partial-ingest rollback | No transaction around session upsert + message insert | Orphan session possible on insert failure; documented as known gap. |
| Integration test isolation | In-process `createServer` factory (not subprocess) | Subprocess variant is `.skip` (flaky in CI); run manually. Q3 in PROGRESS.md. |
| JSON depth-bomb hardening | `JSON.parse` is unhardened | Acceptable for localhost + trusted client. P1 concern. |
| Messages lost when claudegram crashes | In-flight messages during crash may drop | launchd restarts within seconds; fakechat retries webhook. |
| Messages lost when claudegram machine is offline | fakechat webhooks fail and drop (P0) | P2 adds bounded retry queue in fakechat. |

---

## P0 scope boundary

In scope:
- HTTP ingest endpoint (`POST /ingest`)
- SQLite persistence (sessions + messages)
- fakechat fork: optional `CLAUDEGRAM_URL` webhook, stable `session_id`, multi-session via `CLAUDE_SESSION_ID`

Out of scope (not yet built):
- Web UI / PWA (P1)
- Auth via CF Access (P4)
- Webhook retry queue (P2)
- Schema migrations beyond idempotent `CREATE IF NOT EXISTS` (P1)
- cloudflared tunnel / launchd CLI (P4)
- Web Push / VAPID (P5)

---

## Known gaps (P1 follow-ups)

- `schema_version` table — column drift is silently hidden by `IF NOT EXISTS`
- Partial-ingest transaction — session upsert and message insert are not atomic; orphan session possible
- Webhook retry queue — messages drop if claudegram is unreachable when fakechat POSTs
- `JSON.parse` depth limit — no protection against depth-bomb payloads (acceptable at P0 scope)
- Subprocess-based SIGTERM integration test — currently `.skip` due to CI flakiness; run manually
- Web UI reading `/api/*` routes — reserved with 404, not yet scaffolded

---

## Local development

```bash
bun test              # run all tests
bunx tsc --noEmit     # type check
bun test --coverage   # coverage report
```

---

## Observability

Logs are JSONL written to **stderr**. Every line includes `level`, `msg`, `time` (ISO-8601 UTC), plus arbitrary fields.

Named error events to watch:
- `ingest_failed` — repo error during session upsert or message insert (includes `session_id`, `message_id`, `err`)
- `shutdown_error` — error during graceful shutdown

---

## Manual multi-session verification (spec §8.5 pt 6 equivalent)

To confirm that two fakechat processes with distinct sessions both land in claudegram with correct attribution:

1. Start claudegram:
   ```bash
   cd current/claudegram && bun run src/main.ts
   # Observes: server_ready { port: 8788 }
   ```

2. In two separate terminals, start two fakechat instances:
   ```bash
   # Terminal A
   cd current/fakechat && CLAUDE_SESSION_ID=alice CLAUDEGRAM_URL=http://localhost:8788 bun server.ts

   # Terminal B
   cd current/fakechat && CLAUDE_SESSION_ID=bob CLAUDEGRAM_URL=http://localhost:8788 bun server.ts
   ```

   (Note: fakechat auto-picks port 8788/8789 because claudegram is on 8788.)

3. Open each fakechat UI in a separate browser tab (URLs printed to stderr on startup).

4. Type a message in each. Verify claudegram log shows two ingest events with distinct `session_id`s.

5. Inspect the SQLite DB:
   ```bash
   sqlite3 current/claudegram/data/claudegram.db "SELECT id, name FROM sessions;"
   sqlite3 current/claudegram/data/claudegram.db "SELECT session_id, id, direction, content FROM messages ORDER BY ts;"
   ```

   Expected: two session rows (`alice`, `bob`); each message correctly attributed to its session.
