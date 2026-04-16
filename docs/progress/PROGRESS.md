## Project: Claudegram

## Spec Files
- docs/PRD.md

## Current Phase: Phase 2A + 3A (parallel)

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

Teams: available (not used for 2A/3A — independent workspaces, no coordination needed)

## Active Task
Phase 2A — Channel Server MCP stdio + claude/channel/permission + session-scoped allowlist (parallel with 3A)
Phase 3A — grammy bot rendering + 3-button keyboard + permission formatting (parallel with 2A)
Sub-task progress: not yet started; both agents launched in parallel
Relevant files: channel-server/src/* (NEW for 2A), bot/src/* (extending Phase 1E stub for 3A)

## Completed Tasks
- [x] Phase 1A: Bun workspace scaffolding + shared TypeScript types — commit: 0066cde — code ✅ sec ✅ func ✅ type ✅ err ✅
- [x] Phase 1B: Daemon HTTP server + PID lock + health check + session registry — commit: 35728e4 — code ✅ sec ✅ func ✅ type ✅ err ✅
- [x] Phase 1C: Decision queue with TTL + long-polling endpoint — commit: 3433d51 — code ✅ sec ✅ func ✅ type ✅ err ✅
- [x] Phase 1D: Cross-component contracts + typed events + AbortSignal cleanup — commit: ecfb9d8 — code ✅ sec ✅ func ✅ type ✅ err ✅
- [x] Phase 1E: bot/ workspace + zod-validated env config + URL/integer security guards — commit: 159e8df — code ✅ sec ✅ func ✅ type ✅ err ✅

## Pending Tasks (prioritized)
- [ ] Phase 2A: Channel Server MCP stdio + claude/channel/permission + session-scoped yes_all allowlist [IN PROGRESS — parallel with 3A]
- [ ] Phase 3A: grammy bot in bot/ workspace + 3-button inline keyboard + permission message formatting [IN PROGRESS — parallel with 2A]
- [ ] Phase 2B: Permission relay (notification receive → daemon POST → long-poll → verdict) [parallel with 3B]
- [ ] Phase 3B: callback_query handling (queue.answer + edit message to "Answered: X") [parallel with 2B]
- [ ] Phase 2C: Auto-register via CLAUDEGRAM_SESSION_NAME, auto-deregister on shutdown
- [ ] Phase 3C: Bot commands (/sessions, /pending, /cancel, /cancel_all)
- [ ] Phase 2D: Unit tests for queue + registry (clears LOW risk before E2E)
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
| Phase 1D | NITS→PASS | FINDINGS→PASS | PASS | TIGHTEN→STRONG | FINDINGS→PASS | 2 | ✅ COMPLETE |
| Phase 1E | NITS→PASS | FINDINGS→PASS | PARTIAL→PASS | TIGHTEN→STRONG | FINDINGS→PASS | 2+fixup | ✅ COMPLETE |

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
- 2026-04-16 Decision (architect): Phase 4B atomic persistence moved from v0.1 to v0.2.
- 2026-04-16 Decision (architect): F2 three buttons restored via session-scoped allowlist in Channel Server (Set<PermissionCategory>). Yes_all answered → category cached → subsequent same-category permissions auto-allow without daemon round-trip.
- 2026-04-16 Decision (architect): Phase 1D added shared/protocol.ts with PERMISSION_OPTION_IDS, PERMISSION_CATEGORIES, CALLBACK_DATA_PREFIX, encode/parseCallbackData (Result-returning; UTF-8 byte budget; UUID-validated requestId).
- 2026-04-16 Decision (architect): DecisionQueue exposes typed EventEmitter (created/answered/expired/cancelled); _emit wraps emit in try/catch so listener throws never crash daemon.
- 2026-04-16 Decision (architect): Long-poll route wires AbortSignal with leak-free cleanup (settled flag + detachAbort across all resolution paths).
- 2026-04-16 Decision (architect): Phase 1E promoted bot to its own workspace `bot/`; daemon zod-validated config with parseConfig (testable) + loadConfig (boot fail-fast). Security: URL refined to http|https; user IDs guarded against MAX_SAFE_INTEGER overflow alias attack.
- 2026-04-16 Decision (architect): Phase 2D adds queue+registry unit tests before Phase 4A E2E.
- 2026-04-16 Decision: env var names — TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWLIST (comma-separated user IDs), CLAUDEGRAM_PORT (default 3582), CLAUDEGRAM_DAEMON_URL (default http://localhost:3582). User configures via .env.example template.
- 2026-04-16 Decision: bot ↔ daemon coupling — in-process EventEmitter on DecisionQueue (not HTTP, not polling). Bot subscribes to 'created' to send Telegram messages, holds Map<RequestId, {chatId, messageId}> for callback_query lookup.
- 2026-04-16 Decision: Phase 3B grammy middleware order — (1) allowlist filter → (2) idempotency dedup (60s in-memory cache of callback_query.id) → (3) decision-state check via queue.answer() returning VALIDATION_ERROR.
- 2026-04-16 Decision: Phase 4C graceful shutdown order — close HTTP server → cancel all pendings (emits 'cancelled' event → bot edits messages) → wait ≤2s for Telegram edits → bot.stop() → queue.destroy() → release PID lock → exit(0).
- 2026-04-16 Decision (Phase 1D Round 1): MutableDecision is now a discriminated union mirroring Decision; state transitions use explicit field construction (not spread) to satisfy variant narrowing.
- 2026-04-16 Decision (Phase 1D Round 1): MAX_TTL_SECONDS=3600 clamp inside queue.create() as defense-in-depth.
- 2026-04-16 Decision (Phase 1D Round 1): @claudegram/shared package is Bun-only — no compiled dist/index.js. package.json exports has 'bun' condition pointing at source TS.
- 2026-04-16 Decision (Phase 1E): Telegram user IDs stored as `number` (JavaScript safe integer); MAX_SAFE_INTEGER guard catches overflow alias. Migrate to bigint/string only if Telegram ships >2^53 IDs.
- 2026-04-16 Decision (Phase 1E): bot/tsconfig.json uses skipLibCheck:true — grammy 1.42 transitive dep node-fetch@2 has no bundled types. Remove when grammy moves to fetch-based version.
- 2026-04-16 Decision (Phase 1E): BotDeps<Q,R> is generic to allow Phase 3A to type queue/registry without casts at use sites.
- 2026-04-16 Decision (Phase 1E): config.ts uses preprocess(emptyString → undefined, schema.default(...)) so .env.example values like `CLAUDEGRAM_PORT=` correctly fall back to defaults.

## Next Agent Prompt
Two parallel agents running. See per-agent prompts below.

### Phase 2A prompt (channel-server)
See agent launch — covers: channel-server/src/* MCP stdio server, claude/channel/permission capability, session-scoped Set<PermissionCategory> allowlist, skeleton handler signature; HTTP relay deferred to 2B.

### Phase 3A prompt (bot rendering)
See agent launch — covers: bot/src/* extends Phase 1E stub, allowlist middleware, 3-button keyboard renderer for PRD F2, permission message formatter, bot lifecycle (start polling/stop). callback_query handling deferred to 3B.
