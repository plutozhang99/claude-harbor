## Project: Claudegram

## Spec Files
- docs/PRD.md

## Current Phase: Phase 2B + 3B (parallel)

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

Teams: available (not used — parallel Agent calls preferred for independent workspaces)

## Active Task
Phase 2B — Channel server HTTP relay (POST decision → long-poll → verdict, daemon retry/timeout, MCP send-back) [parallel with 3B]
Phase 3B — Bot subscribes to DecisionQueue events; callback_query → queue.answer; daemon wires startBot at boot [parallel with 2B]
Sub-task progress: not yet started; about to launch parallel agents
Relevant files: channel-server/src/permission.ts (relay impl), channel-server/src/index.ts (verdict send-back), bot/src/index.ts (queue subscription), daemon/src/index.ts (bot integration)

## Completed Tasks
- [x] Phase 1A: Bun workspace scaffolding + shared TypeScript types — commit: 0066cde — code ✅ sec ✅ func ✅ type ✅ err ✅
- [x] Phase 1B: Daemon HTTP server + PID lock + health check + session registry — commit: 35728e4 — code ✅ sec ✅ func ✅ type ✅ err ✅
- [x] Phase 1C: Decision queue with TTL + long-polling endpoint — commit: 3433d51 — code ✅ sec ✅ func ✅ type ✅ err ✅
- [x] Phase 1D: Cross-component contracts + typed events + AbortSignal cleanup — commit: ecfb9d8 — code ✅ sec ✅ func ✅ type ✅ err ✅
- [x] Phase 1E: bot/ workspace + zod-validated env config + URL/integer security guards — commit: 159e8df — code ✅ sec ✅ func ✅ type ✅ err ✅
- [x] Phase 2A: Channel Server MCP stdio + claude/channel/permission + session-scoped yes_all allowlist — commit: 61c7f20 — code ✅ sec ✅ func 🟡 type 🟡 err 🟡 (see Round 2 partial review note)
- [x] Phase 3A: grammy bot rendering + allowlist middleware + 3-button keyboard + 4096-byte guard — commit: 6d9627f — code ✅ sec ✅ func 🟡 type 🟡 err 🟡 (see Round 2 partial review note)

## Pending Tasks (prioritized)
- [ ] Phase 2B: Channel server HTTP relay → daemon POST/long-poll → verdict + MCP send-back [IN PROGRESS — parallel with 3B]
- [ ] Phase 3B: Bot subscribes to DecisionQueue events; callback_query → queue.answer; daemon wires bot at boot [IN PROGRESS — parallel with 2B]
- [ ] Phase 2C: Auto-register via CLAUDEGRAM_SESSION_NAME, auto-deregister on shutdown
- [ ] Phase 3C: Bot commands (/sessions, /pending, /cancel, /cancel_all)
- [ ] Phase 2D: Unit tests for queue + registry (clears LOW risk before E2E)
- [ ] Phase 4A: E2E test with real Claude Code sessions
- [ ] Phase 4C: Graceful shutdown + error recovery (cancel pendings → notify Telegram → deregister → release PID)
- [ ] Phase 4D: launchd plist + CLI (start/stop/status/configure)

## Deferred to v0.2
- [ ] Phase 4B: Atomic JSON state persistence

## Review Log
| Task | Code Review | Security | Functional | Type | Error | Rounds | Result |
|------|------------|---------|------------|------|-------|--------|--------|
| Phase 1A | PASS | PASS | PASS | PASS | PASS | 2 | ✅ COMPLETE |
| Phase 1B | PASS | PASS | PASS | PASS | PASS | 2 | ✅ COMPLETE |
| Phase 1C | PASS | PASS | PASS | PASS | PASS | 2 | ✅ COMPLETE |
| Phase 1D | NITS→PASS | FINDINGS→PASS | PASS | TIGHTEN→STRONG | FINDINGS→PASS | 2 | ✅ COMPLETE |
| Phase 1E | NITS→PASS | FINDINGS→PASS | PARTIAL→PASS | TIGHTEN→STRONG | FINDINGS→PASS | 2+fixup | ✅ COMPLETE |
| Phase 2A | NITS→PASS | FINDINGS→PASS | R1 PASS, R2 partial (rate-limited) | R1 NEEDS-TIGHTEN→fixed, R2 partial | R1 FINDINGS→fixed, R2 partial | 2 | ✅ COMPLETE (partial R2) |
| Phase 3A | NITS→PASS | FINDINGS→PASS | R1 PASS, R2 partial | R1 NEEDS-TIGHTEN→fixed, R2 partial | R1 FINDINGS→fixed, R2 partial | 2 | ✅ COMPLETE (partial R2) |

## Key Decisions & Accepted Risks
- 2026-04-16 Decision: Two-component split (Daemon + Channel Server). Daemon is singleton holding grammy bot; Channel Server is per-session MCP stdio. Rationale: Telegram Bot API only allows one getUpdates consumer per token.
- 2026-04-16 Decision: Session registration via CLAUDEGRAM_SESSION_NAME env var (auto on startup), not MCP tool.
- 2026-04-16 Decision: HTTP long-polling for GET /api/decisions/:id (blocks until answered or 30s timeout).
- 2026-04-16 Decision: Separate TTL — unanswered expiry (5min), answered result retention (+30s).
- 2026-04-16 Decision: Atomic JSON writes (write temp → rename).
- 2026-04-16 Decision: Daemon includes PID lock — atomic O_EXCL open, EPERM/ESRCH/NaN handling.
- 2026-04-16 Decision: F3 (custom decisions) deferred to v0.2; keep `type: DecisionType` discriminator in API.
- 2026-04-16 Decision: Phases 2 and 3 run in parallel after Phase 1D+1E complete.
- 2026-04-16 Decision: moduleResolution: Bundler + module: Preserve.
- 2026-04-16 Decision: Session idle state derived at query time from lastActiveAt.
- 2026-04-16 Risk accepted (MEDIUM): acquirePidLock recursion no depth limit. Localhost-only.
- 2026-04-16 Decision: MAX_POLLERS_PER_REQUEST=5 cap.
- 2026-04-16 Decision (architect): Phase 4B atomic persistence moved to v0.2.
- 2026-04-16 Decision (architect): F2 three buttons restored via session-scoped allowlist in Channel Server.
- 2026-04-16 Decision (architect): Phase 1D added shared/protocol.ts with PERMISSION_OPTION_IDS, PERMISSION_CATEGORIES, CALLBACK_DATA_PREFIX, encode/parseCallbackData.
- 2026-04-16 Decision (architect): DecisionQueue exposes typed EventEmitter; _emit wraps emit in try/catch.
- 2026-04-16 Decision (architect): Long-poll route wires AbortSignal with leak-free cleanup.
- 2026-04-16 Decision (architect): Phase 1E promoted bot to its own workspace; daemon zod-validated config; URL refined to http|https; user IDs MAX_SAFE_INTEGER guard.
- 2026-04-16 Decision (architect): Phase 2D adds queue+registry unit tests before Phase 4A.
- 2026-04-16 Decision: env vars — TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWLIST, CLAUDEGRAM_PORT (3582), CLAUDEGRAM_DAEMON_URL.
- 2026-04-16 Decision: bot ↔ daemon coupling — in-process EventEmitter; bot subscribes to 'created' to send messages, holds Map<RequestId, {chatId, messageId}> for callback_query lookup.
- 2026-04-16 Decision: Phase 3B grammy middleware order — allowlist filter → idempotency dedup → decision-state check.
- 2026-04-16 Decision: Phase 4C graceful shutdown order — close HTTP → cancel pendings → wait Telegram edits ≤2s → bot.stop() → queue.destroy() → release PID → exit(0).
- 2026-04-16 Decision (Phase 1D Round 1): MutableDecision discriminated union; explicit field construction.
- 2026-04-16 Decision (Phase 1D Round 1): MAX_TTL_SECONDS=3600 internal clamp.
- 2026-04-16 Decision (Phase 1D Round 1): @claudegram/shared package is Bun-only.
- 2026-04-16 Decision (Phase 1E): Telegram user IDs as `number`; MAX_SAFE_INTEGER guard.
- 2026-04-16 Decision (Phase 1E): bot/tsconfig.json uses skipLibCheck:true (grammy → node-fetch@2 typing gap).
- 2026-04-16 Decision (Phase 1E): BotDeps<Q,R> generic for Phase 3B typing.
- 2026-04-16 Decision (Phase 1E): config.ts preprocess(emptyString → undefined, schema.default(...)).
- 2026-04-16 Decision (Phase 2A): PermissionNotification interface lives in shared/protocol.ts (cross-package contract).
- 2026-04-16 Decision (Phase 2A): SessionPermissionAllowlist implements ISessionPermissionAllowlist for Phase 2D mock injection.
- 2026-04-16 Decision (Phase 2A): channel-server uses fallbackNotificationHandler instead of setNotificationHandler (TS2589 deep instantiation with SDK schema generics).
- 2026-04-16 Decision (Phase 2A): handlePermission contract — ALWAYS return PermissionVerdict, never throw. Try/catch in caller maps internal errors to deny.
- 2026-04-16 Decision (Phase 2A Round 1): zod schema string field-length budgets — title 256, description 4096, toolName/sessionId 128 — DoS guard. Schema is .strict() (rejects unknown fields).
- 2026-04-16 Decision (Phase 3A): bot allowlist middleware acks unauthorized callback_query with empty answerCallbackQuery() to remove Telegram loading spinner without leaking allowlist signal.
- 2026-04-16 Decision (Phase 3A): TELEGRAM_MAX_MESSAGE_BYTES=4096 UTF-8 byte check in renderPermissionMessage; returns Result with 'message_too_long' before encode loop.
- 2026-04-16 Risk accepted (Phase 2A+3A Round 2): 3 of 5 review slots (Functional, Type, Error) hit Anthropic 5h rate limit during Round 2. Reasoning for accepting partial review: (a) Slot 1 TS+Slot 2 Security passed Round 2 fully; (b) Round 1 reviewers covered all changed surfaces and recommended the exact fixes that Round 1 implementer agents executed; (c) implementer self-tests verified all 9 fix contracts (max-length reject, .strict() reject, message_too_long, allowlist callback ack, etc.); (d) `bunx tsc -b` passes cross-workspace. If issues surface in Phase 2B integration, attribute first to these unverified Round 2 surfaces and re-review.

## Next Agent Prompt
Two parallel agents launching for Phase 2B + 3B. See per-agent prompts in agent launch.

### Phase 2B prompt summary (channel-server)
Implement HTTP relay in handlePermission: build CreateDecisionRequest with 3 options (yes/yes_all/no with category-specific labels), POST to daemon /api/decisions, long-poll GET /api/decisions/:requestId until terminal, map answer→verdict (yes/yes_all → allow; no/expired/cancelled → deny). On yes_all: allowlist.add(category) before returning allow. Send verdict back to Claude Code via MCP send-back path. Daemon unreachable / timeout → deny with reason. Idempotent retry on transient HTTP errors (network blips), bounded.

### Phase 3B prompt summary (bot + daemon integration)
Define DecisionQueue + SessionRegistry structural interfaces in bot/src for typed BotDeps. Subscribe to queue events on startBot: 'created' → renderPermissionMessage → bot.api.sendMessage to ALL allowlist users (single chat_id model: just the first user, or broadcast — verify PRD), store Map<RequestId, {chat_id, message_id}>. On 'answered'/'expired'/'cancelled' → editMessageText with formatAnsweredText + remove inline_keyboard. callback_query handler: lookup decision options for label resolution, call deps.queue.answer(requestId, optionId), update Telegram message via the 'answered' event handler (not directly). daemon/src/index.ts: instantiate startBot with deps, await handle.start(); add to graceful-shutdown ordering.
