## Project: claudegram pre-P3 issue fixes

## Spec Files
- docs/progress/issue_fix_before_p3.md

## Current Phase: Phase A — Bug Fixes (COMPLETE)

## Interruption Reason


## Rate Limit State


## Review Roster (Phase 0 设定，项目中途不变)
固定:
- Slot 1 Code Review: typescript-reviewer
- Slot 2 Security Review: security-review skill
- Slot 3 Functional Coverage: functional-coverage skill
条件性 (仅列出已激活的):
- Slot 4 DB Review: database-reviewer
- Slot 5 A11y Review: N/A
- Slot 6 Type Review: type-design-analyzer
- Slot 7 Error Review: silent-failure-hunter
- Slot 8 Perf Review: N/A
- Slot 9 Clinical Review: N/A

## Active Task
None — all tasks complete.

## Completed Tasks
- [x] T3: WS close on session delete — `closeBySession()` in InMemorySessionRegistry (map-delete-first invariant)
- [x] T1: Stale online fix — app-level JSON ping/pong heartbeat (20s/45s) + full state sync on new PWA connect
- [x] T2: Lazy fakechat client start — `ensureClientStarted()` on first `deliver()` or `reply` (retry-safe ordering)
- [x] T4+T5: Header cleanup + compose bottom status strip — removed session pill; session badge + statusline now beside compose input
- [x] T6: Mobile CSS — fixed `.sidebar--open` class mismatch; replaced 100vh+calc with flex+dvh; iOS safe-area insets; tighter mobile padding

## Pending Tasks
None.

## Review Log
| Task | Code Review | Security | Functional | Rounds | Result |
|------|------------|---------|------------|--------|--------|
| T3   | PASS       | PASS    | PASS       | 1      | ✅ COMPLETE |
| T1   | FAIL→PASS  | PASS    | FAIL→PASS  | 2      | ✅ COMPLETE |
| T2   | FAIL→PASS  | PASS    | FAIL→PASS  | 2      | ✅ COMPLETE |
| T4+T5| PASS       | PASS    | PASS       | 1      | ✅ COMPLETE |
| T6   | PASS       | PASS    | PASS       | 1      | ✅ COMPLETE |

## Key Decisions & Accepted Risks

### Architecture decisions (2026-04-19)

**T3 WS close race guard:**
`closeBySession` removes from map FIRST, then calls `ws.close()`. Subsequent close-event disposable path becomes a no-op (map already empty). Zero double-close risk.

**T1 state sync approach:**
On new PWA socket open: full state snapshot broadcast (all DB sessions with `connected` bool from registry). Ping/pong frames JSON-typed and NOT routed into session event stream. App-level ping: 20s interval / 45s timeout. On timeout: synthesize close cleanup (wrapped in try/catch) + ws.close(1001).

**T2 lazy fakechat start:**
Removed eager `client.start()`. `ensureClientStarted()` called on first `deliver()` (origin !== 'pwa') and first `reply` tool use. Flag is set AFTER both `onReply()` and `start()` succeed — a throw resets to unstarted so retry is possible. Accepted: sessions will not appear in claudegram before first interaction. This is intentional — statusline's cwdRegistry is also only populated post-register, so pre-interaction visibility was already impossible.

**T4+T5 design:**
Removed `session` pill from header (kept `sys` and `fakechat`). Compose bottom strip: `[● dot + session-name] [model] [ctx bar] [5h bar] [7d bar]`. Session badge uses same Mistral warm palette as header pills (online = ink bg + yellow dot glow; offline = accent-red dot; none = dashed outline dot). Bars already degrade gracefully when statusline data absent. No account info (not exposed by Claude Code API).

**T6 mobile CSS:**
Critical bug fix: sidebar toggle was broken because JS sets `.sidebar--open` but CSS targeted `.open`. Replaced fragile `height: calc(100vh - 65px)` with body flex-column + `.layout { flex: 1 }`. Adopted `dvh` via `@supports` feature query. Added iOS safe-area-inset padding for notch/home-indicator. Tightened mobile padding (header, compose, messages) for narrow widths. Bumped service worker to `v4-mobile-fix` for cache-bust.

### Review feedback addressed

**Round 1 review found:**
- CRITICAL: `ensureClientStarted` set flag before start() — throw would permanently disable retry
- HIGH: `isUnknownType` allowlist missed `'pong'` — malformed pongs would bump bad-frame counter
- HIGH: `handleSessionSocketClose()` in ping timer callback lacked try/catch wrap — throw would leak registry slot
- FAIL: pong frame handling had no test coverage
- FAIL: `handleUserSocketOpen` had no test coverage
- FAIL: DELETE `closeBySession` args never asserted in tests

**Round 2 fixes:**
- `ensureClientStarted` — flag set after both `onReply()` and `start()` succeed; wrapped in try/catch; error logged to stderr
- `isUnknownType` — now allowlists `['register', 'pong']` with sync-comment
- Ping timer — `handleSessionSocketClose` wrapped in its own try/catch, logs `session_socket_heartbeat_cleanup_failed`
- Added: pong frame test (no upsert / no broadcast / no error / no bad-frame bump)
- Added: 4 tests for `handleUserSocketOpen` (happy path, empty DB, findAll throws, send throws)
- Added: `closeBySession` call-args assertion in DELETE test

### Rejected
- Next.js migration: not justified — mobile issues were CSS, not architecture
- Account info in compose strip: not available via Claude Code API
- Startup "reset all to offline" broadcast: superseded by full sync on PWA connect

## Next Agent Prompt
Phase A complete. All 5 tasks done, 365 tests pass (was 359; +6 new), TypeScript clean on both claudegram and fakechat. Ready for commit + archive.
