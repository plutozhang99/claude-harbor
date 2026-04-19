## Project: claudegram v1 — Post-P2 Hotfixes & Polish (2026-04-19)

> P2 (fakechat reverse WebSocket + user replies) was archived 2026-04-18 in `PROGRESS-P2-2026-04-18.md`. The following day, hands-on user testing surfaced a batch of UX gaps and architectural omissions that the P2 review fleet hadn't caught (because reviews focused on protocol correctness, not end-to-end user experience). This doc archives everything done between P2 archive and the next planned phase (P3 Notifications).

## Spec Files
- docs/request_v1.md (the original spec)
- docs/archive/PROGRESS-P0-2026-04-18.md
- docs/archive/PROGRESS-P1-2026-04-18.md
- docs/archive/PROGRESS-P2-2026-04-18.md
- current/claudegram/DESIGN.md (Mistral.ai design system fetched via `npx getdesign@latest add mistral.ai`)

## Status: ALL SHIPPED (2026-04-19)
- claudegram suite: **327 pass / 0 fail / 1 skip**
- fakechat suite: **48 pass / 0 fail** (untouched in this batch)
- `bun tsc --noEmit`: clean in both packages
- Branch is 12 commits ahead of origin/main

## Commit history (chronological — P2 archive was a1bfe15)

| Commit | Summary |
|--------|---------|
| `33f221b` | fix: P2-hotfix2 bundle — persist PWA msgs, connected state, delete |
| `59177e6` | feat: Mistral.ai-inspired warm design refresh |
| `99deb78` | feat: replace conn-pill with three-state header status bar |
| `b8fa604` | feat: rename sessions + per-session status dot + chrono order |
| `2024ea3` | docs: archive post-P2 hotfix + design + status-bar + rename batch |
| `200008c` | feat: move connection-state indicator to session row left bar |

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
