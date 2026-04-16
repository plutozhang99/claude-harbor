## Project: Claudegram

## Spec Files
- docs/PRD.md

## Current Phase: Phase 1D — Contract lockdown (blocks 2A/3A)

## Interruption Reason


## Rate Limit State


## Review Roster (set in Phase 0, do not change mid-project)
固定:
- Slot 1 Code Review: typescript-reviewer agent
- Slot 2 Security Review: security-review skill
- Slot 3 Functional Coverage: functional-coverage skill
条件性 (激活的才列出):
- Slot 6 Type Review: type-design-analyzer agent (TypeScript project)
- Slot 7 Error Review: silent-failure-hunter agent (activated by default)

Teams: available

## Active Task
Phase 1D — Lock contracts in @claudegram/shared + DecisionQueue typed events + AbortSignal wiring
Sub-task progress: not yet started
Relevant files: shared/protocol.ts (NEW), shared/index.ts, daemon/src/queue.ts, daemon/src/routes/decisions.ts

## Completed Tasks
- [x] Phase 1A: Bun workspace scaffolding + shared TypeScript types — commit: 0066cde — code ✅ sec ✅ func ✅ type ✅ err ✅
- [x] Phase 1B: Daemon HTTP server + PID lock + health check + session registry — commit: 35728e4 — code ✅ sec ✅ func ✅ type ✅ err ✅
- [x] Phase 1C: Decision queue with TTL + long-polling endpoint — commit: 3433d51 — code ✅ sec ✅ func ✅ type ✅ err ✅

## Pending Tasks (prioritized)
- [ ] Phase 1D: Lock cross-component contracts (PERMISSION_OPTION_IDS, callback data codec, queue events, AbortSignal) [BLOCKING for 2A/3A]
- [ ] Phase 1E: Promote bot/ workspace; move grammy dep; daemon zod-validated config from .env [BLOCKING for 2A/3A]
- [ ] Phase 2A: Channel Server MCP stdio + claude/channel/permission + session-scoped yes_all allowlist [READY after 1D+1E — parallel with 3A]
- [ ] Phase 3A: grammy bot in bot/ workspace + 3-button inline keyboard + permission message formatting [READY after 1D+1E — parallel with 2A]
- [ ] Phase 2B: Permission relay (notification receive → daemon POST → long-poll → verdict) [parallel with 3B]
- [ ] Phase 3B: callback_query handling (queue.answer + edit message to "Answered: X") [parallel with 2B]
- [ ] Phase 2C: Auto-register via CLAUDEGRAM_SESSION_NAME, auto-deregister on shutdown
- [ ] Phase 3C: Bot commands (/sessions, /pending, /cancel, /cancel_all)
- [ ] Phase 2D: Unit tests for queue + registry (clears LOW risk before E2E) [NEW from architect review]
- [ ] Phase 4A: E2E test with real Claude Code sessions
- [ ] Phase 4C: Graceful shutdown + error recovery (cancel pendings → notify Telegram → deregister → release PID)
- [ ] Phase 4D: launchd plist + CLI (start/stop/status/configure)

## Deferred to v0.2
- [ ] Phase 4B: Atomic JSON state persistence (architect review: pending decisions cannot survive restart due to TTL state loss; sessions reference dead processes — moved out of v0.1)

## Review Log
| Task | Code Review | Security | Functional | Type | Error | Rounds | Result |
|------|------------|---------|------------|------|-------|--------|--------|
| Phase 1A | PASS | PASS | PASS | PASS | PASS | 2 | ✅ COMPLETE |
| Phase 1B | PASS | PASS | PASS | PASS | PASS | 2 | ✅ COMPLETE |
| Phase 1C | PASS | PASS | PASS | PASS | PASS | 2 | ✅ COMPLETE |

## Key Decisions & Accepted Risks
- 2026-04-16 Decision: Two-component split (Daemon + Channel Server). Daemon is singleton holding grammy bot; Channel Server is per-session MCP stdio. Rationale: Telegram Bot API only allows one getUpdates consumer per token.
- 2026-04-16 Decision: Session registration via CLAUDEGRAM_SESSION_NAME env var (auto on startup), not MCP tool.
- 2026-04-16 Decision: HTTP long-polling for GET /api/decisions/:id (blocks until answered or 30s timeout).
- 2026-04-16 Decision: Separate TTL — unanswered expiry (5min), answered result retention (+30s). Rationale: prevents race between Telegram callback and channel server poll.
- 2026-04-16 Decision: Atomic JSON writes (write temp → rename).
- 2026-04-16 Decision: Daemon includes PID lock — atomic O_EXCL open, EPERM/ESRCH/NaN handling.
- 2026-04-16 Decision: F3 (custom decisions) deferred to v0.2; keep `type: DecisionType` discriminator in API for forward compat.
- 2026-04-16 Decision: Phases 2 and 3 run in parallel after Phase 1D+1E complete.
- 2026-04-16 Decision: moduleResolution: Bundler + module: Preserve (Bun-compatible).
- 2026-04-16 Decision: Session idle state derived at query time from lastActiveAt (not stored as status field).
- 2026-04-16 Risk accepted (MEDIUM): acquirePidLock uses recursion with no depth limit. Accepted: localhost-only daemon on user's own filesystem; adversarial filesystem scenario out of scope for v1.
- 2026-04-16 Decision: touch() must be wired in Phase 1C (on decision create/poll) to update session lastActiveAt. ✅ done.
- 2026-04-16 Risk closed: No unit tests for Phase 1C queue/routes — addressed by Phase 2D (NEW).
- 2026-04-16 Decision: MAX_POLLERS_PER_REQUEST=5 cap on concurrent long-poll connections per requestId. Returns current state immediately when cap reached.
- 2026-04-16 Decision (architect): Phase 4B atomic persistence moved from v0.1 to v0.2. Rationale: pending decisions cannot survive restart (TTL timer state lost), sessions reference dead Claude processes (stale entries cause name conflicts).
- 2026-04-16 Decision (architect): F2 three buttons restored (PRD compliance) via session-scoped allowlist in Channel Server (Set<PermissionCategory>). 'yes_all' answered → category cached → subsequent same-category permissions auto-allow without daemon round-trip.
- 2026-04-16 Decision (architect): Phase 1D adds shared/protocol.ts with PERMISSION_OPTION_IDS=['yes','yes_all','no'], PERMISSION_CATEGORIES=['file_edit','bash','mcp_tool'], CALLBACK_DATA_PREFIX='cg:', encode/parseCallbackData (64-byte Telegram limit).
- 2026-04-16 Decision (architect): DecisionQueue exposes typed EventEmitter (created/answered/expired/cancelled) — bot subscribes in-process; no HTTP from bot to daemon, no polling.
- 2026-04-16 Decision (architect): Long-poll route wires AbortSignal so client disconnect removes poller from queue immediately.
- 2026-04-16 Decision (architect): Phase 1E promotes bot to its own workspace `bot/`; grammy dep moves out of daemon/package.json. Daemon adds zod-validated config from Bun's built-in .env loader (fail-fast at boot).
- 2026-04-16 Decision (architect): Phase 2D adds queue+registry unit tests before Phase 4A E2E.
- 2026-04-16 Decision: env var names — TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWLIST (comma-separated user IDs), CLAUDEGRAM_PORT (default 3582), CLAUDEGRAM_DAEMON_URL (default http://localhost:3582). env.example will be created in Phase 1E.
- 2026-04-16 Decision: bot ↔ daemon coupling — in-process EventEmitter on DecisionQueue (not HTTP, not polling). Bot subscribes to 'created' to send Telegram messages, holds Map<RequestId, {chatId, messageId}> for callback_query lookup.
- 2026-04-16 Decision: Phase 3B grammy middleware order — (1) allowlist filter → (2) idempotency dedup (60s in-memory cache of callback_query.id) → (3) decision-state check via queue.answer() returning VALIDATION_ERROR.
- 2026-04-16 Decision: Phase 4C graceful shutdown order — close HTTP server → cancel all pendings (emits 'cancelled' event → bot edits messages) → wait ≤2s for Telegram edits → bot.stop() → queue.destroy() → release PID lock → exit(0).

## Next Agent Prompt
Project: Claudegram at /Users/plutozhang/Documents/claudegram
Language: TypeScript, Bun runtime
Task: Phase 1D — Lock cross-component contracts in @claudegram/shared and add typed events to DecisionQueue. Blocking prerequisite for Phase 2A/3A parallel work.

Files to create/modify:
1. CREATE shared/protocol.ts:
   - PERMISSION_OPTION_IDS = ['yes', 'yes_all', 'no'] as const
   - type PermissionOptionId = (typeof PERMISSION_OPTION_IDS)[number]
   - PERMISSION_CATEGORIES = ['file_edit', 'bash', 'mcp_tool'] as const
   - type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number]
   - CALLBACK_DATA_PREFIX = 'cg:'
   - encodeCallbackData(requestId: RequestId, optionId: string): string — returns 'cg:<requestId>:<optionId>', throws if encoded length > 64 bytes (Telegram hard limit)
   - parseCallbackData(data: string): Result<{requestId: RequestId, optionId: string}, 'invalid_format' | 'wrong_prefix'>
2. UPDATE shared/index.ts (or whichever barrel exists; if none, ensure shared/types.ts re-exports from protocol.ts) so all new symbols are importable as `from '@claudegram/shared'`.
3. UPDATE daemon/src/queue.ts:
   - Add typed EventEmitter (Node's built-in) to DecisionQueue class
   - Define DecisionEventMap type with keys: 'created' | 'answered' | 'expired' | 'cancelled', each value (decision: Decision) => void
   - Emit on transitions in create() / answer() / TTL expiry / cancel()
   - Listener type-safety: queue.on<K extends keyof DecisionEventMap>(event: K, listener: DecisionEventMap[K]): void
4. UPDATE daemon/src/routes/decisions.ts:
   - Wire c.req.raw.signal.addEventListener('abort', ...) on the long-poll GET handler
   - When abort fires, remove the poller from the queue immediately (do not wait for 30s timeout)
   - Add removePoller(requestId, pollerToken) method to queue OR change poll() to accept AbortSignal — pick the cleanest API and document the choice
5. RUN: bun install (no new deps expected — EventEmitter is built-in to Node/Bun)
6. RUN: bunx tsc --noEmit across all workspaces (must pass)

Constraints:
- No any types; use Result<T> pattern; immutable updates
- EventEmitter event names must be type-checked via keyof DecisionEventMap
- callback_data encoder must throw on >64 bytes (Telegram limit)
- Don't break Phase 1A/B/C — existing routes/registry/PID lock must still work
- Decision, RequestId, Result, ErrorResponse, etc. already exist in shared/types.ts — import, don't duplicate

After implementation, summarize:
- New symbols added to @claudegram/shared
- DecisionQueue event API signature (showing typed on/off/emit)
- AbortSignal wiring approach (which method changed, why)
- tsc result (pass/fail with any errors)

Do NOT commit. The orchestrator will run reviews and commit.
