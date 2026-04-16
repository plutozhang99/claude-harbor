import type { Decision, RequestId, Result, ErrorResponse } from '@claudegram/shared'

// ─── Port types ───────────────────────────────────────────────────────────────

/**
 * The subset of DecisionQueue event names the bot subscribes to.
 * Matches daemon/src/queue.ts `DecisionEventMap` keys exactly, but is defined
 * here as a structural interface so bot/ never imports from daemon/ — keeping
 * the dependency direction clean (daemon → bot, not vice versa).
 */
export type DecisionEventName = 'created' | 'answered' | 'expired' | 'cancelled'

/**
 * Every decision event carries the full Decision snapshot at the time of
 * emission (pending, answered, expired, or cancelled).
 */
export type DecisionEventListener = (decision: Decision) => void

/**
 * Structural port — the bot's view of a DecisionQueue.
 *
 * This intentionally mirrors DecisionQueue's public `on`, `off`, and `answer`
 * methods using the same signatures, but does NOT import DecisionQueue from
 * daemon/. That keeps the package dependency graph acyclic:
 *   shared ← bot ← daemon     (daemon depends on bot, not vice-versa)
 *
 * The daemon passes its concrete `DecisionQueue` instance here; TypeScript
 * verifies structural compatibility at the call site.
 */
export interface DecisionQueuePort {
  on(event: DecisionEventName, listener: DecisionEventListener): unknown
  off(event: DecisionEventName, listener: DecisionEventListener): unknown
  /**
   * Answer a pending decision. Returns `ok: false` when the decision is not
   * found or is no longer pending (already answered, expired, or cancelled).
   * On `ok: true` the queue emits an 'answered' event — the bot's event
   * handler (not this return value) is responsible for editing the Telegram
   * message.
   */
  answer(requestId: RequestId, optionId: string): Result<Decision, ErrorResponse>
}

/**
 * Structural port — the bot's view of a SessionRegistry.
 *
 * Phase 3B needs only a minimal slice (reserved for future /sessions command).
 * Phase 3C will add more methods once the bot implements session browsing.
 */
export interface SessionRegistryPort {
  /**
   * Returns a read-only snapshot of all active sessions (name + id only).
   * Phase 3C /sessions command will call this; Phase 3B does not use it but
   * the field is part of BotDeps to future-proof the daemon wiring.
   */
  getActiveSessions(): readonly { readonly sessionId: string; readonly sessionName: string }[]
}
