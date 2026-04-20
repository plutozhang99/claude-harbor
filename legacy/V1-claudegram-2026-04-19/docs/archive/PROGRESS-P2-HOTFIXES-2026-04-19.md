## Project: claudegram v1 — Post-P2 Hotfixes & Polish (2026-04-19)

> P2 (fakechat reverse WebSocket + user replies) was archived 2026-04-18 in `PROGRESS-P2-2026-04-18.md`. The following day, hands-on user testing surfaced a batch of UX gaps and architectural omissions that the P2 review fleet hadn't caught (because reviews focused on protocol correctness, not end-to-end user experience). This doc archives everything done between P2 archive and the next planned phase (P3 Notifications).

## Spec Files
- docs/request_v1.md (the original spec)
- docs/archive/PROGRESS-P0-2026-04-18.md
- docs/archive/PROGRESS-P1-2026-04-18.md
- docs/archive/PROGRESS-P2-2026-04-18.md
- current/claudegram/DESIGN.md (Mistral.ai design system fetched via `npx getdesign@latest add mistral.ai`)

## Status: ALL SHIPPED (2026-04-19)
- claudegram suite: **355 pass / 0 fail / 1 skip** (up from 327 — 28 new tests across Batches 6–8)
- fakechat suite: **48 pass / 0 fail**
- `bun tsc --noEmit`: clean in both packages
- Batches 6–8 currently uncommitted — pending user-driven smoke test

## Commit history (chronological — P2 archive was a1bfe15)

| Commit | Summary |
|--------|---------|
| `33f221b` | fix: P2-hotfix2 bundle — persist PWA msgs, connected state, delete |
| `59177e6` | feat: Mistral.ai-inspired warm design refresh |
| `99deb78` | feat: replace conn-pill with three-state header status bar |
| `b8fa604` | feat: rename sessions + per-session status dot + chrono order |
| `2024ea3` | docs: archive post-P2 hotfix + design + status-bar + rename batch |
| `200008c` | feat: move connection-state indicator to session row left bar |
| `5ba162a` | docs: append Batch 5 (bar relocation) to post-P2 hotfix archive |
| _(pending)_ | feat: live Claude Code statusline bridge + unread read-pointer fix (Batch 6) |
| _(pending)_ | feat: markdown in replies, typing indicator, "Claude" label (Batch 7) |
| _(pending)_ | fix: name-clobber on upsert + SW cache bump + cwd-scoped fakechat ULID (Batch 8) |

---

## Why this exists (gap analysis vs P2)

P2's six review slots (code, security, functional, DB, type-design, silent-failure) all passed for the protocol layer. But the user's first real-world test session uncovered **seven categories of gaps** that nobody caught:

1. **Install docs were incomplete** — README mentioned the architecture but not the actual fork-install flow (`mv` + `ln -s` to override the upstream marketplace fakechat) or the entry-point command (`bun run dev` not `bun run src/server.ts`).
2. **PWA send button was a P1 stub** — `web/js/render.js` had `// TODO(P2): send reply via POST /api/messages` and a no-op submit handler. The functional-coverage review checked "server can route a reply" via raw WebSocket clients but never tested "user clicks the actual send button".
3. **PWA-originated messages disappeared on refresh** — Q1=a (origin-tag echo dedup) prevented double-broadcasts but also meant the user's own messages were never persisted. The architect approved Q1=a knowing this tradeoff but the user-facing implication was never spelled out.
4. **No per-session "is fakechat live?" indicator** — sessions stay in the SQLite `sessions` table forever after a fakechat dies, so the sidebar showed "ghost" sessions the user couldn't actually message. The send button was happy to accept input that would silently fail at the server boundary with `session_not_connected`.
5. **The single `conn-pill` conflated three signals** — PWA→server WS state was the only thing it showed, but users intuitively expect a status indicator to mean "is the system working end-to-end?"
6. **No way to delete or rename sessions** — DB rows accumulated indefinitely.
7. **Visual treatment** — the dark slate theme worked but felt generic. User asked for the Mistral.ai aesthetic.

Each batch below addresses a tranche of these.

---

## Batch 1 — P2-hotfix2 bundle (commit `33f221b`)

**Scope**: 7 fixes addressing #1–#6 from the gap analysis. Single coder dispatch (sonnet), single review pass.

### FIX 1 — README install docs
- `current/claudegram/README.md` gained a "Running the bridge locally" 4-step section covering:
  1. Replace upstream fakechat with fork via `mv` + `ln -s` under `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/fakechat`
  2. Enable the plugin in `~/.claude/settings.json` under `enabledPlugins`
  3. `export CLAUDEGRAM_URL=http://localhost:8788` in the shell that launches Claude Code
  4. `cd current/claudegram && bun run dev` to start the server, then `claude --channels plugin:fakechat@claude-plugins-official` to spawn fakechat

### FIX 2/3/4 — Per-session `connected` state (the biggest piece)
- `src/ws/session-registry.ts`: `has(session_id: string): boolean` added to interface + impl (O(1) Map lookup)
- `src/repo/types.ts`: `SessionListItem.connected: boolean` field added (populated at API layer, not stored)
- `src/routes/api/sessions.ts`: gained `sessionRegistry` dep; annotates each row with `connected: sessionRegistry.has(s.id)` before returning
- `src/routes/session-socket.ts`: register branch broadcasts `{type:'session_update', session: {...connected: true}}` post-tryRegister; close handler captures session_id, then after dispose broadcasts `{...connected: false}`. Both broadcasts wrapped in their own try/catch.
- `src/ws/hub.ts`: `BroadcastPayload` extended with `connected?: boolean` and `deleted?: boolean` on `session_update.session`
- `src/server.ts`: passes `hub` and `sessRepo` into `sessionSocketDeps` and the close handler; ctx now includes `sessionRegistry`
- PWA: `store.applySessionUpdate` merges the new field; `render.js` disables send when `activeSession.connected === false` and shows `(offline)` text in sidebar (later replaced by status dot in batch 4)
- `web/js/index.js` / `ws.js`: subscribed to `session_update` events; existing wiring sufficient

### FIX 5 — Persist PWA-originated messages
- `src/routes/user-socket.ts` `handleReplyFrame`:
  - BEFORE forwarding to fakechat, calls `messageRepo.insert({id: client_msg_id, session_id, direction: 'user', content: text, ts: Date.now()})`
  - Idempotent via `ON CONFLICT DO NOTHING` (client_msg_id is unique enough; reuses the existing PK `(session_id, id)`)
  - Broadcasts `{type:'message', session_id, message}` via `hub.broadcast` to ALL PWAs (including sender)
  - Persist + broadcast happen even on the `session_not_connected` path so the user's attempt is in history with the failure marker
- The fakechat-side echo-skip from P2.4 (`origin: 'pwa'` flag) still prevents double-broadcast from the fakechat round-trip

### FIX 6 — Optimistic-echo dedup correctness
- `web/js/index.js`: optimistic message uses `id: client_msg_id` directly (was previously `pending-${client_msg_id}`)
- `web/js/store.js` `applyLiveMessage`: when an incoming message id matches an existing pending message in the same session, REPLACE rather than append. The pending flag is cleared in the replacement.
- The `'failed'` state path now actually fires because the error frame's `client_msg_id` correlates back to the optimistic entry. Visible as red border + `delivery failed: <reason>` inline marker.

### FIX 7 — Delete session
- `src/repo/types.ts`: `SessionRepo.delete(id): boolean` (returns false on no-rows) + `MessageRepo.deleteBySession(session_id)` added
- `src/repo/sqlite.ts`: implementations. Order: messages first, session second. SQLite auto-commits each statement; if msgs delete but session delete fails, orphaned rows simply don't appear in the list (sessions table is the source of truth for what to display).
- `src/http.ts` + `src/routes/api/sessions.ts`: `DELETE /api/sessions/:id` route with 404 on missing, `{ok:true}` on success. Unregisters any active socket via `sessionRegistry.unregister` and broadcasts `{type:'session_deleted', session_id}`.
- PWA: `web/js/render.js` adds an opacity-faded `×` button per session; visible on hover; click shows `confirm()` then PATCHes; relies on the broadcast for state cleanup (`store.applySessionDeleted`).
- `web/js/ws.js`: dispatches the new `session_deleted` event type.
- `web/js/store.js`: `applySessionDeleted(sessionId)` removes from state map and clears `activeId` if deleted session was active.

### Tests
- 24 new tests across `repo/sqlite.test.ts`, `routes/api/sessions.test.ts`, `routes/session-socket.test.ts`, `routes/user-socket.test.ts`, `routes/ingest.test.ts`, `http.test.ts`, `integration-p2-relay.test.ts`
- All 314 → 314 pass + 24 new = expected; total stayed at 314 because some E2E tests had to be updated for the new persist-and-broadcast behavior (they previously asserted no broadcast happened on PWA reply, which is no longer true)

### Architectural notes locked in this batch
- Q1=a (origin-tag echo dedup) is preserved BUT augmented: claudegram now performs its own direct persist+broadcast on receipt of the reply frame, so the fakechat echo-skip only prevents double-INSERT, not double-broadcast (broadcast is now sender-driven, not fakechat-driven). End-to-end: exactly one `{type:'message'}` broadcast per PWA reply.
- `connected: boolean` on SessionListItem is intentionally NOT stored in DB — it's a runtime view of `sessionRegistry.has(id)`. Avoids stale rows during fakechat crashes.
- Session row `status` column is NOT touched on close (predates this work; no-op until P3+ adds explicit lifecycle).

---

## Batch 2 — Mistral.ai design refresh (commit `59177e6`)

**Trigger**: user ran `npx getdesign@latest add mistral.ai` from the claudegram dir, which dropped a `DESIGN.md` (~15KB) describing Mistral's warm-amber palette, sharp geometry, golden multi-layer shadow, and "single weight 400" typography principles.

### Files touched
- NEW: `current/claudegram/DESIGN.md` (the spec — kept as the design reference)
- MODIFIED: `current/claudegram/web/style.css` — full rewrite. Same selectors, same IDs, same semantic structure; only design tokens swapped.
- MODIFIED: `current/claudegram/web/index.html` — `meta[name=theme-color]` flipped to `#fa520f` (Mistral Orange) so iOS PWA status bar tints correctly.
- MODIFIED: `current/claudegram/web/manifest.webmanifest` — `background_color` to `#fffaeb` (Warm Ivory), `theme_color` to `#fa520f`.
- MODIFIED: `current/claudegram/web/sw.js` — cache version bump to invalidate the old shell.

### Design choices documented in `DESIGN.md`, applied as
- `--bg: #fffaeb` (Warm Ivory) — page bg
- `--surface: #fff0c2` (Cream) — sidebar, header, compose
- `--surface2: #ffe295` (Block Gold) — hover/active
- `--ink: #1f1f1f` (Mistral Black) — primary text + dark surfaces
- `--accent: #fa520f` (Mistral Orange) — primary signal (failed states, focus rings, brand)
- `--radius: 0` — sharp corners everywhere except status pills + unread badges
- Single font weight 400 throughout — hierarchy via size + color, never weight
- Five-layer golden shadow (`rgba(127, 99, 21, 0.12) -8px 16px 39px, ...`) on header, message bubbles, sidebar (mobile), CTA — the signature Mistral "golden hour" elevation
- User bubbles: dark on warm (Mistral Black bg, ivory text). Assistant bubbles: cream + golden shadow (the "floating in golden light" effect).
- Status pill colors flipped warm-only: open = black + bright yellow, closed = Mistral Orange + white, connecting = Sunshine 300

### What was preserved
- Full layout contract (selectors, IDs, semantic HTML structure)
- All P2-hotfix2 functionality (status indicators, delete affordances, optimistic echo states)
- Accessibility (skip-link, focus-visible, prefers-reduced-motion, aria roles)
- Mobile responsiveness with sidebar drawer

### Tests
- No JS / no test changes. 314 pass / 0 fail unchanged.

---

## Batch 3 — Header status bar (commit `99deb78`)

**Trigger**: the single `conn-pill` only conveyed PWA→server WS state. User wanted to see system health, fakechat aggregate health, and active session reachability all at a glance.

### Replaced
- `<span id="conn-pill">connecting</span>` → `<div class="status-bar">` containing 3 `<span class="status-pill">` elements

### Three pills

| Pill | id | Source | States |
|------|----|--------|--------|
| SYS | `system-pill` | `ws.js` connect lifecycle (legacy `setPill`, just renamed PILL_ID) | open / closed / connecting |
| FAKECHAT | `fakechat-pill` | computed from `store.state.sessions` (count `connected:true` vs total) | empty (0/0), all (n/n), partial (m/n), all-offline (0/n) |
| SESSION | `session-pill` | `store.state.activeId` + that session's `connected` field | none (no selection), online, offline (also when `connected` field is absent — conservative default) |

### Pill structure
- Each pill is `[label | value]` — the label is fixed Cream/dim-ink (identifies the metric), the value carries the signal color (the actual state)
- Label: uppercase, monospace, letter-spaced — "sys" / "fakechat" / "session"
- Value: same typography but variable background per `data-state`

### Color variants (warm-only, per DESIGN.md)
- Healthy → Mistral Black bg, Bright Yellow text
- Partial → Sunshine 700 bg, Black text
- Failed/missing → Mistral Orange bg, white text
- Inactive → Cream bg, dim-ink text

### Files touched
- `web/index.html`: replaced single `<span class="conn-pill">` with the 3-pill `<div class="status-bar" role="status" aria-live="polite">`
- `web/style.css`: `.conn-pill` rules removed; added `.status-bar`, `.status-pill`, `.status-label`, `.status-value`, plus per-id `[data-state="..."]` color variants
- `web/js/ws.js`: `PILL_ID` rebound to `'system-pill'`; `setPill` now updates the `.status-value` child node (not raw `textContent`) so the label survives state changes
- `web/js/index.js`: `updateStatusPills()` function reads store + active session + computes states/text; wired to `store.on('change', ...)` and called once at boot
- `web/sw.js`: cache version bumped to `v1-mistral-statusbar`

### Tests
- Unchanged. 314 pass / 0 fail.

---

## Batch 4 — Rename + per-session status dot + message order fix (commit `b8fa604`)

**Trigger**: more user testing revealed three more issues:
1. Messages appeared reverse-chronological after refresh
2. No way to rename sessions (the auto-generated name was the session_id, ugly)
3. The sidebar `(offline)` text was less scannable than a status dot would be

### FIX A — Message order
- **Root cause**: `MessageRepo.findBySession*` use `ORDER BY ts DESC` for cursor-friendly pagination. PWA `applyMessages` stored the batch as-returned, so display ended up newest-first while live appends came at the bottom. Visual: history top→bottom = newest→oldest, then live messages = older→newer, total chaos.
- **Fix**: `web/js/store.js` `applyMessages` now reverses the server batch to chronological order (oldest at top, newest at bottom). Server contract unchanged; live `applyLiveMessage` already appends to the end.

### FIX B — Rename session
- **Server**:
  - `SessionRepo.rename(id: string, name: string): boolean` (returns false if no row matched) — added to interface + sqlite impl
  - `PATCH /api/sessions/:id` route with Zod-validated `{name: string min 1 max 200}`; 404 on unknown id
  - Fetches refreshed session, attaches `connected: sessionRegistry.has(id)`, broadcasts `{type:'session_update', session}` via hub so all PWAs refresh without reloading
- **Client**:
  - PWA sidebar: `✎` pencil button next to the `×` delete button. Both fade in on hover at `opacity 0.7`. `click` → `prompt()` for new name → PATCH → relies on `session_update` broadcast (no local mutation).
  - `web/js/index.js`: `onRenameSession(id)` async function, threaded through `createRenderer({..., onRenameSession})`

### FIX C — Per-session status dot
- Sidebar `<li>` gets a small `<span class="session-status-dot" data-state="online|offline|unknown">` BEFORE the `.session-name`
- States: `online` = Mistral Black, `offline` = Mistral Orange, `unknown` = Sunshine 300 (neutral). Border `1px solid var(--ink)` for crisp definition on Cream bg.
- The redundant inline `(offline)` text was removed
- Dot's `aria-label` carries `online` / `offline` / `unknown` for screen readers
- On selected (dark-bg) items the dot color flips to Sunshine Yellow for contrast against Mistral Black bg

### Tests
- 13 new tests: 3 for `SessionRepo.rename` (existing → true + name updated; unknown → false; idempotent same-name → true), 8 PATCH route tests (200 happy path, 404 unknown, 400 invalid bodies, 400 empty name, 400 too long, 400 missing field, broadcast verification, connected field in response), plus stub-method alignment in 4 other test files.
- 314 → 327 pass.

---

## Batch 5 — Connection-state bar relocation (commit `200008c`)

**Trigger**: user feedback that the inline status dot (Batch 4) was redundant with the row's existing left border. The pre-existing 3px transparent border on `<li>` was already showing hover/selected highlights — user wanted that bar repurposed to carry the connection-state signal, slightly thicker, never overwritten by hover/selected.

### Changes
- **render.js**: removed the `.session-status-dot` `<span>`. Now sets `li.dataset.connected = "online" | "offline" | "unknown"` and writes a hover-tooltip via `li.title`. Accessibility kept via a trailing `<span class="sr-only">(online)</span>` for screen readers.
- **style.css**:
  - Bumped `border-left` from 3px to **5px** on `#session-list li`.
  - Added `[data-connected="online"|"offline"|"unknown"]` selectors that drive `border-left-color` directly:
    - `online` → Mistral Black (`var(--ink)`)
    - `offline` → Mistral Orange (`var(--accent)`)
    - `unknown` → Sunshine 300 (`var(--surface3)`)
  - **Removed** the `border-left-color` overrides on `:hover` and `[aria-selected="true"]` so the live connection state stays visible regardless of interaction state.
  - Added a single targeted exception: `[aria-selected="true"][data-connected="online"]` flips the bar to Bright Yellow (`var(--yellow)`) — the dark bar would otherwise melt into the Mistral Black selected-row background. Offline/unknown bar colors already pop on the dark bg.
  - Padding-left bumped from 0.85rem → 0.95rem to keep `.session-name` x-position constant despite the thicker bar.
  - `border-left-color` transition extended to 180ms (vs 120ms on bg/color) so live `connected` toggles animate gently.
  - Removed ~17 lines of orphaned `.session-status-dot` rules.
- **sw.js**: cache version `v1-mistral-status-bar`.

### Why this design
- **Single source of truth for connection state across the entire UI**: the same `session.connected` field now drives (a) header `[FAKECHAT]` + `[SESSION]` pills, (b) sidebar row left bar, and (c) compose send-button enable/disable. No state can drift.
- **No double signal redundancy**: removing the dot avoids the user having to scan two indicators per row.
- **Hover/selected legibility preserved via background only**: Mistral palette has enough chroma in surface2 (Block Gold) and ink (Mistral Black) to make hover/selected unambiguous without needing the bar.

### Tests
- Unchanged: 327 pass / 0 fail / 1 skip. `bun tsc --noEmit` clean.

---

## Batch 6 — Live Claude Code statusline bridge + unread read-pointer fix (pending commit)

**Scope**: surface Claude Code's statusline (model, ctx %, 5h + 7d quota bars) inside the PWA compose row, plus fix the persistent-unread-on-refresh bug that surfaced during the same session. One coder pass, no multi-agent fleet — same rationale as Batches 1–5 (tight scope, extensive tests, user actively smoke-testing each change).

### Gap that triggered this batch
User asked: "can we show the per-session statusline data under the input field on the PWA, including mobile?" Claude Code's statusline is the only surface that gets `model`, `context_window.used_percentage`, and `rate_limits.{five_hour,seven_day}.used_percentage` — none of which are exposed via any public API, only piped as stdin JSON to `~/.claude/statusline-command.sh`. Separately, during the same session the user observed that unread badges resurrect after a page refresh — server-side `last_read_at` was never being advanced because the PWA did not emit `mark_read` frames.

### Session-id namespace problem (why cwd bridges it)
Investigation surfaced that **fakechat's session_id and Claude Code's statusline `.session_id` live in unrelated namespaces**: `ls ~/.claude/channels/fakechat/` showed only `pid-XXXXX` directories, meaning Claude Code does NOT pass `CLAUDE_SESSION_ID` env var to MCP server subprocesses. Fakechat's fallback persists a ULID per STATE_DIR; CC's statusline UUID is never seen by fakechat. The only field both sides agree on is **cwd** (fakechat runs in the project dir; statusline JSON has `.cwd` and `.workspace.current_dir`). Bridging via cwd was chosen over the alternate SessionStart-hook-writes-file-then-fakechat-watches path because (a) MCP servers start BEFORE SessionStart hooks fire, so fakechat would need to re-register mid-life, and (b) cwd matching is one extra field in the existing register frame.

### FIX A — cwd propagation (fakechat → claudegram)
- `current/fakechat/src/claudegram-client.ts`: `ClaudegramClientConfig` gains `cwd?: string`; the `register` frame now carries it alongside `session_id` / `session_name`
- `current/fakechat/server.ts`: passes `process.cwd()` to the client at construction

### FIX B — CwdRegistry (claudegram)
- `current/claudegram/src/ws/cwd-registry.ts` (new): `InMemoryCwdRegistry` — `Map<cwd, session_id>` with `set`, `lookup`, `clearBySession`, `size`. Separate from `SessionRegistry` on purpose — different lifecycle (cwd map survives across session eviction/rebind), different consumer (only the statusline route).
- `current/claudegram/src/ws/cwd-registry.test.ts` (new): 6 unit tests covering set / lookup / last-writer-wins / clearBySession (including the multi-cwd → same session edge case) / unknown-session no-op / size tracking.
- `current/claudegram/src/routes/session-socket.ts`: register schema accepts optional `cwd`; on successful `tryRegister` the cwd is recorded; on `close`, `cwdRegistry.clearBySession(session_id)` runs so a fakechat restart won't leave a dangling mapping.
- `current/claudegram/src/server.ts` + `src/http.ts`: wire `cwdRegistry` through `ServerDeps`, `RouterCtx`, and `SessionSocketDeps`. Both are **optional** in the interface types with a runtime `InMemoryCwdRegistry()` fallback — a deliberate choice to avoid touching ~20 existing test harnesses that build deps manually.

### FIX C — `POST /internal/statusline` route (claudegram)
- `current/claudegram/src/routes/statusline.ts` (new): accepts the raw Claude Code statusline stdin JSON; extracts `model.display_name`, `context_window.used_percentage`, `rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.{used_percentage,reset_at}`; resolves session via `cwdRegistry.lookup(cwd ?? workspace.current_dir ?? workspace.project_dir)`; broadcasts `{type:'statusline', session_id, statusline: {...}}` via `hub.broadcast`. Returns `{ok:true, matched:false}` on unknown cwd (not an error — statusline fires before fakechat may be connected).
- **Loopback gate**: route rejects any request whose URL hostname isn't `127.0.0.1` / `::1` / `localhost` with 403. Same-host posture is sufficient pre-P4 because the statusline script runs on the user's laptop.
- `current/claudegram/src/routes/statusline.test.ts` (new): 8 route tests covering wrong-method, non-loopback rejection, invalid JSON, missing cwd, unknown cwd, happy path with all fields, `workspace.current_dir` fallback, and defensive null-filling when `rate_limits` / `context_window` are omitted.
- `current/claudegram/src/ws/hub.ts`: `BroadcastPayload` gains a `statusline` variant with a `StatuslineSnapshot` type (`model | null`, `ctx_pct | null`, `five_h_pct | null`, `seven_d_pct | null`, `seven_d_reset_at | null`). All fields nullable because Claude Code's JSON shape is undocumented and may omit fields across versions.
- `current/claudegram/src/http.ts`: `/internal/statusline` wired before the `/api/*` fallback; no schema changes to DB.

### FIX D — Frontend statusline render
- `current/claudegram/web/js/store.js`: new `statuslineBySession: Map<sessionId, snapshot>`; `applyStatusline(sessionId, snapshot)` replaces prior value (latest-wins), updates `updated_at` timestamp, emits `change`.
- `current/claudegram/web/js/ws.js`: dispatches `statusline` events alongside existing `message` / `session_update` / `session_deleted` / `error`.
- `current/claudegram/web/js/index.js`: subscribes, forwards to `store.applyStatusline`.
- `current/claudegram/web/js/render.js`: new `renderStatusline()` + `buildBar()`. Active session's snapshot → `[model] [ctx bar] [5h bar] [7d bar]` inside `.compose-row`. Bars colour-code: `ok` (<70%) green, `warn` (70–89%) amber, `crit` (≥90%) red. Null percentages render as a greyed-out `—` with an empty track. 7d reset timestamp surfaces in the bar's `title` tooltip.
- `current/claudegram/web/index.html`: new `<div class="statusline" id="statusline" aria-live="polite" aria-label="Claude Code statusline">` child of `.compose-row`, rendered between the textarea and the send button.
- `current/claudegram/web/style.css`: statusline styles (flex layout, mini 4.5rem track, `transition: width 0.3s ease` on the fill); mobile `@media (max-width: 640px)` forces the statusline onto its own row above the send button with narrower tracks; `@media (max-width: 380px)` shrinks further.

### FIX E — `~/.claude/statusline-command.sh` bridge hook (global)
The script is append-only modified: after reading stdin, it does a fire-and-forget `curl` (500 ms timeout, stderr silenced) to `$CLAUDEGRAM_STATUSLINE_URL` if that env var is set. Default stdout output (what Claude Code renders in its own statusline) is unchanged. Users opt in by exporting `CLAUDEGRAM_STATUSLINE_URL=http://127.0.0.1:8788/internal/statusline` in the shell that launches `claude`. This is the only change outside the claudegram / fakechat repos.

### FIX F — `mark_read` from PWA (unread-on-refresh bug)
Root cause: `web/js/store.js:setActive` cleared unread locally but the PWA never sent a `mark_read` WS frame. Server-side `user-socket.ts:handleMarkReadFrame` + `sessionRepo.updateLastReadAt` were already wired; nobody called them. On refresh, `GET /api/sessions` recomputed `unread_count` from the DB `last_read_at=0` and the badge came back.

- `current/claudegram/web/js/index.js`:
  - Subscribes to the WS `message` event and, if the message is an assistant reply for the currently active session, sends `{type:'mark_read', session_id, up_to_message_id: message.id}` — advances the server-side pointer in real time.
  - `onSelectSession` now calls a new `maybeMarkRead(sessionId)` helper after hydration: walks back to the newest message in the session and sends a `mark_read`. Server's monotonic `MAX(last_read_at, ts)` guarantees safety even if the newest message is a user message.
  - On WS `connect` (including reconnects), re-sends `mark_read` for the active session. Handles the boot race where `onSelectSession` may fire before the socket is open.
- No server-side changes; the inbound handler has been wired since P2.

### Design decisions locked in Batch 6
- **cwd over UUID**: session-id namespaces don't align; same-cwd dual-fakechat is accepted as last-writer-wins (rare in practice).
- **statusline snapshots are ephemeral**: in-memory only, never persisted to SQLite. On claudegram restart, the next statusline POST (within ~2s) repopulates.
- **Loopback-only for `/internal/statusline`**: no auth header needed pre-P4 because the statusline script is co-located with claudegram. CF Access would add a second layer if the service ever goes remote.
- **Optional `cwdRegistry` in deps**: chosen over mass-editing ~20 test harnesses. Runtime always provides one via `createServer`; tests that don't exercise `/internal/statusline` get the no-op fallback.

### Tests added in Batch 6
- `src/ws/cwd-registry.test.ts` — 6 tests
- `src/routes/statusline.test.ts` — 8 tests
- Total: **340 pass / 1 skip / 0 fail** after Batch 6 (was 327).

---

## Batch 7 — Message UI niceties: markdown, typing indicator, assistant label (pending commit)

**Scope**: three visual upgrades to the message pane. One coder pass.

### Gap that triggered this batch
User asked for three things in one message after Batch 6: (1) render markdown in Claude's replies — currently every message is plain escaped text, so code blocks look cramped and lists don't indent; (2) show a "waiting for AI" affordance between the user's send and the next assistant message; (3) replace the "them" label in message bubbles with something branded.

### FIX A — Safe markdown renderer
- `current/claudegram/web/js/markdown.js` (new): zero-dependency, zero-build-step renderer. Hand-rolled to respect the project's "vanilla ES modules, no framework, no build step" constraint. Supported constructs: fenced code blocks (``` ``` ``` ``` with optional language label → `data-lang`), inline code, `**bold**` / `__bold__`, `*italic*` / `_italic_` with word-boundary anchors so `snake_case` isn't eaten, `[text](url)` links with strict URL allowlist (`http(s)://`, `mailto:`, same-origin `/`, `#anchor`, `./relative`), `-` / `*` / `+` unordered lists, `1.` ordered lists, `#`–`######` ATX headings, blank-line paragraph separation, soft line breaks as `<br>`.
- Safety contract: fenced code is extracted to placeholders BEFORE HTML escape; all other text is HTML-escaped, THEN inline transforms run, so the only HTML tags in the output are the ones we emit ourselves. `javascript:` / `data:` URLs are dropped (visible text is kept without the `<a>`).
- `current/claudegram/src/web/markdown.test.ts` (new): 14 unit tests covering empty / non-string inputs, XSS escape (`<script>`), bold/italic/inline-code together, code-block language attributes, code-block content escape, UL + OL, headings with level-specific classes, allowlisted links (rel/target/href), `javascript:` stripping, relative / fragment / `./` URLs, soft line breaks, paragraph separation, `snake_case` preservation, mixed inline code + bold.
- `current/claudegram/web/js/render.js`: assistant messages now run through `renderMarkdown(raw)`; user messages stay on `escapeHtml(raw)` (users type plaintext — we shouldn't auto-format their input).
- `current/claudegram/web/style.css`: `.md-p`, `.md-h*`, `.md-list`, `.md-inline-code`, `.md-code`, `.md-link` styles. Dark user bubbles get lighter-on-dark variants for `<code>` and `<a>` so they stay legible against Mistral Black.

### FIX B — "Claude is thinking" typing indicator
- `current/claudegram/web/js/store.js`: new `waitingBySession: Map<sessionId, boolean>` field on state.
  - `applyPendingMessage(sessionId, message)` sets `waiting=true` when the optimistic-echo message has `direction === 'user'`.
  - `applyLiveMessage(sessionId, message)` clears the flag when an assistant message arrives for that session.
  - `markPendingFailed(clientMsgId, reason)` clears the flag on failed sends — no perpetual bubble behind a delivery failure.
  - `applySessionDeleted(sessionId)` also clears it.
- `current/claudegram/web/js/render.js`: `renderMessages()` appends a `<li class="msg-waiting" data-from="assistant" data-state="waiting">` at the tail of the active session's message list when `waitingBySession.get(activeId) === true`. The indicator contains three `<span class="dot">` children animating via `@keyframes typing-bounce` (0.15s stagger).
- `current/claudegram/web/style.css`: `.typing-dots` layout + `@keyframes typing-bounce` (1.15s ease-in-out loop, translateY(-0.3em) + opacity pulse). Honours `@media (prefers-reduced-motion: reduce)` — animation disabled; dots stay visible at 0.6 opacity so the indicator is still legible.
- Ephemeral by design: waiting state lives in the browser tab only. A page refresh clears it; user can re-send if needed. Rejected alternative: server-side "pending assistant reply" state would need a timeout, a cleanup path, and its own broadcast type — too much surface for a cosmetic indicator.

### FIX C — Assistant label rename
- `current/claudegram/web/js/render.js`: new `ASSISTANT_LABEL = 'Claude'` module constant; used in both regular message bubbles and the typing indicator. Replaces the former inline `'them'` literal at line 159. No CSS changes required — the label was text-only.

### Design decisions locked in Batch 7
- **Markdown only for assistant messages**: rendering user-typed markdown would surprise the user (asterisks in a quoted snippet suddenly turning bold). Asymmetric by design.
- **URL allowlist over sanitiser library**: same reason as the markdown impl itself — no build step, and the threat model (Claude emitting `javascript:alert(1)`) is small enough for a hand-rolled check.
- **"Claude" not "Claude Code" / "them" / a nickname**: short, on-brand, unambiguous.
- **Waiting state is client-only**: matches the ephemeral-indicator convention used for `pending` / `failed` opacity already.

### Tests added in Batch 7
- `src/web/markdown.test.ts` — 14 tests (imports the `.js` module directly; Bun resolves).
- Total: **354 pass / 1 skip / 0 fail** after Batch 7.

### README changes (both batches)
`current/claudegram/README.md` gained two new sections inserted before "Quick start":
- **Live statusline in the compose row (optional)** — explains the bridge chain, setup via `CLAUDEGRAM_STATUSLINE_URL`, multi-session behaviour, and edge cases.
- **Message UI niceties** — describes markdown scope + safety posture, the typing indicator's ephemeral semantics, and the assistant label.
Plus a standalone section **Unread count now clears across refreshes** explaining the root cause + fix for future readers.

---

## Batch 8 — Three regressions surfaced during user smoke test (pending commit)

**Scope**: three bugs the user reported immediately after Batches 6–7 landed. One diagnostic pass, three independent fixes, one archive update.

### Reports from the user (verbatim):
1. "为什么我的 session 突然多了两个不应该存在的东西：01KPJE8JFWTN2GPEMFCTB9FB7C、01KPJE7M8N223G8WG41RJP0K2Y"
2. "更新 session 名称后，无法保持么？我之前更新了一个 session name 但是不知道为啥它没了"
3. "'模型名 + ctx + 5h + 7d 四件套一行紧凑显示'这个完全没有显示，而且移动端的优化也完全没有出现效果"

### Diagnosis

**Report 1 (ghost sessions)** — each ULID traced back to a distinct `~/.claude/channels/fakechat/pid-<N>/session_id` file:
```
pid-6744/session_id : 01KPJE7M8N223G8WG41RJP0K2Y
pid-6837/session_id : 01KPJE8JFWTN2GPEMFCTB9FB7C
```
Root cause: `fakechat/server.ts` scopes STATE_DIR by `CLAUDE_SESSION_ID ?? pid-${pid}`. Claude Code does not propagate `CLAUDE_SESSION_ID` to MCP subprocesses (verified in Batch 6), so every fakechat restart = new pid = new STATE_DIR = new ULID = new claudegram session row. Two restarts during the testing window = two ghost sessions.

**Report 2 (rename lost)** — DB inspection showed one renamed session (`"hi"`) survived only because its fakechat hadn't re-registered since the rename. Read of `stmtUpsert` in `sqlite.ts:165–171` confirmed `ON CONFLICT(id) DO UPDATE SET … name = excluded.name` — every fakechat reconnect overwrites the user's PATCH rename with `session_name ?? session_id` (and fakechat never sends session_name, so the fallback is the ULID itself).

**Report 3 (statusline + mobile CSS missing)** — `web/sw.js:1` read `const VERSION = 'v1-mistral-status-bar'` (unchanged since Batch 3). The service worker cache holds the pre-Batch-6 shell; new index.html (with `.statusline` div), new style.css (with mobile breakpoints), new render.js (with markdown + statusline render), and the entirely new `markdown.js` module were all invisible behind the stale cache. Additionally `markdown.js` was not listed in `SHELL`, so even a version bump would have left it uncached.

### FIX 1 — `stmtUpsert` no longer touches `name` on conflict
- `current/claudegram/src/repo/sqlite.ts` — `stmtUpsert` body is now `ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`. Comment captures the rationale (fakechat sends `session_name: undefined` → fallback clobbers renames). Names are set once at INSERT; changes go exclusively through `stmtRename`.
- `current/claudegram/src/repo/sqlite.test.ts`:
  - Test 15 rewritten: "second upsert updates last_seen_at but preserves original name" — asserts the new contract.
  - New Test 15b: `rename` → `upsert` (simulating fakechat reconnect) — asserts the renamed name survives. This is the exact user-reported scenario.

### FIX 2 — Service-worker cache version bump + markdown.js in shell
- `current/claudegram/web/sw.js`:
  - `VERSION: 'v1-mistral-status-bar'` → `'v2-statusline-md'`.
  - `SHELL` extended with `/web/js/markdown.js`.
  - Added a comment at the top stating the convention ("bump VERSION whenever any SHELL file changes") so the next dev doesn't repeat the omission.
- Activation behaviour was already correct: `activate` handler deletes all caches except `VERSION`, and `skipWaiting` + `clients.claim` make the next navigation pick up new assets. The bug was purely the stale version string.

### FIX 3 — Fakechat STATE_DIR scope now hashed by cwd
- `current/fakechat/server.ts`:
  - New helper `cwdSlug(cwd)` = first 16 hex chars of `sha256(cwd)`.
  - New `defaultSessionScope()` returns `cwd-<slug>`; falls back to `pid-${pid}` only if `process.cwd()` throws (shouldn't happen outside a destroyed working directory).
  - `SESSION_SCOPE = process.env.CLAUDE_SESSION_ID ?? defaultSessionScope()`.
- Result: one project directory → one stable ULID across Claude Code restarts. No more ghost accumulation. `CLAUDE_SESSION_ID` still takes priority for explicit overrides.
- Migration: existing `pid-*` STATE_DIRs continue to exist but are no longer consulted — a fresh `cwd-*` directory is created on first boot. Old ghost sessions in claudegram remain in DB until manually deleted via the UI.

### Validation
- claudegram: **355 pass / 1 skip / 0 fail** (was 354 — Test 15b added).
- fakechat: **48 pass / 0 fail**.
- `bun tsc --noEmit` clean in both packages.

### Design decisions locked in Batch 8
- **Upsert treats name as insert-only.** A dedicated rename path (`stmtRename` + PATCH endpoint) is the only legit way to change a session name. If fakechat ever needs to push a server-side name (e.g. "Claude in /my/project"), we'll add an explicit optional signal, not overload upsert.
- **SW version bump is a per-release ritual.** Added a comment at the top of `sw.js` so the convention is obvious. Future Batch-N changes touching any SHELL file must bump VERSION in the same commit.
- **cwd is the primary project-identity signal.** Batch 6 already used it for statusline bridging; now the fakechat session identity itself derives from it. `CLAUDE_SESSION_ID` remains the override for users who want to bind multiple cwds to one session or split one cwd into many.

### User-side follow-ups (NOT code changes)
After deploying these fixes the user needs to:
1. **Restart Claude Code** so fakechat picks up the new `cwd-<slug>` STATE_DIR and sends the register frame with `cwd`.
2. **Hard-refresh the PWA** (or close and reopen the tab) to pick up the new service worker. `v2-statusline-md` activates on the next navigation; existing tabs stay on v1 until reload.
3. **`export CLAUDEGRAM_STATUSLINE_URL=http://127.0.0.1:8788/internal/statusline`** in the shell that launches Claude Code — the bridge POST is opt-in (Batch 6).
4. **Manually delete the ghost sessions** via the × button in the sidebar.

---

## What was NOT done (deferred to P3+)

These came up during this period but were not in scope:
- **Server-side rate limiting** on `/user-socket` and `/api/*` (waiting for P4 CF Access posture)
- **`(last_read_ts, last_read_message_id)` tie-breaker** on mark_read (architect deferred to P3)
- **Browser Notification API** with per-session mute (P3 scope per original plan)
- **Web Push (VAPID)** for fully-killed PWA delivery (P5 scope)
- **`cli.ts install/uninstall` + launchd plist** (P4 scope)
- **`session_lifecycle` events for ended/closed sessions** (currently only `connected:bool` toggles; sessions are never explicitly "ended" in DB)
- **In-place inline edit of session name** (current `prompt()` is functional but ugly — could be replaced with a contenteditable span in P3)
- **Visual indication that a message is being sent** beyond the existing `pending` opacity (could add a spinner — P3)
- **Persisting drafts** in compose textarea across sessions or refreshes
- **Optimistic delete** (currently waits for server confirmation; could remove from sidebar immediately and roll back on failure)

## Architectural decisions locked in this period

- **Q1=a + sender-side persist**: claudegram persists PWA-originated messages directly (not via fakechat round-trip echo). Echo-skip from P2.4 (origin tag) still prevents double-INSERT but is no longer load-bearing for the broadcast path.
- **`connected` is a runtime view**: never stored in DB; computed from `SessionRegistry.has(id)` at every API call. Avoids stale state on fakechat crashes.
- **Mistral aesthetic is the locked design system**: `DESIGN.md` is the source of truth. Future UI work must use the warm palette, sharp corners, single weight 400, and golden multi-layer shadows.
- **Status pills use `[label | value]` shape**: extensible for future pills (e.g. unread total, queue depth). Server-side aggregate metrics may follow.
- **PATCH semantics for sessions**: only `name` is patchable today. Future writable fields (notes, tags, archived flag) follow the same pattern.

## Process notes

- **Single-agent dispatches** worked well for these batches. No multi-agent teams used.
- **No formal review fleet** for these hotfixes (vs. P2's 6-slot fleet per phase). Rationale: each batch was tightly scoped, tests were extensive, and the user was actively testing during/after each commit. Trade-off: future hotfix waves could still benefit from a quick code-review + silent-failure pass.
- **Auto mode + user driving testing** is a productive loop for catching real-world UX gaps. The 7 P2-hotfix2 issues collectively represented a category of problems (end-to-end UX vs protocol correctness) that the architect-approved review fleet structurally cannot catch — only real users can.

## Next steps

P3 Notifications + chaos hardening + the deferred items above. New `/start-project` with a P3 spec when ready.
