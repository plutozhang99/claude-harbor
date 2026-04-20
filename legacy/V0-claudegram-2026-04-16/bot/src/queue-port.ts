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
  // `void` (not `unknown`) — bot never chains on the return value, and `void`
  // is more honest about that. Concrete impls (DecisionQueue) may still return
  // `this` for fluent chaining; `void` accepts any return type at the call site.
  on(event: DecisionEventName, listener: DecisionEventListener): void
  off(event: DecisionEventName, listener: DecisionEventListener): void
  /**
   * Answer a pending decision. Returns `ok: false` when the decision is not
   * found or is no longer pending (already answered, expired, or cancelled).
   * On `ok: true` the queue emits an 'answered' event — the bot's event
   * handler (not this return value) is responsible for editing the Telegram
   * message.
   */
  answer(requestId: RequestId, optionId: string): Result<Decision, ErrorResponse>
  /**
   * Return all decisions currently in 'pending' status as read-only snapshots.
   * Used by the /pending and /cancel commands to list or match pending decisions.
   */
  getPending(): readonly Decision[]
  /**
   * Cancel a pending decision. Returns the cancelled Decision snapshot on success
   * so the /cancel command can display sessionName + title in its reply.
   * Returns `ok: false` when the decision is not found.
   */
  cancel(requestId: RequestId): Result<Decision, ErrorResponse>
}

/**
 * The subset of SessionRegistry event names the bot subscribes to.
 * Matches daemon/src/registry.ts `SessionEventMap` keys exactly, but is defined
 * here as a structural interface so bot/ never imports from daemon/ — keeping
 * the dependency direction clean (daemon → bot, not vice versa).
 */
export type SessionEventName = 'registered' | 'deregistered'

/**
 * Minimal session descriptor carried by registry events.
 * Mirrors the relevant fields of the shared Session type without importing it
 * from the daemon package.
 */
export interface SessionInfo {
  /**
   * Plain `string` (not branded `SessionId`) intentionally — using the brand
   * would couple bot/ to shared/'s `Brand` utility.  The bot only echoes this
   * value back in log messages and never constructs new ones, so the looser
   * type is sufficient.
   */
  readonly sessionId: string
  readonly sessionName: string
}

/**
 * Listener type for session lifecycle events.
 */
export type SessionEventListener = (session: SessionInfo) => void

/**
 * Structural port — the bot's view of a SessionRegistry.
 *
 * Phase 3B needs only a minimal slice.  Phase 2C adds session lifecycle events
 * so the bot can send Telegram notifications on register/deregister.
 * Phase 3C will call getActiveSessions() for the /sessions command.
 */
export interface SessionRegistryPort {
  /**
   * Returns a read-only snapshot of all active sessions (name + id only).
   * Phase 3C /sessions command will call this; Phase 3B does not use it but
   * the field is part of BotDeps to future-proof the daemon wiring.
   */
  getActiveSessions(): readonly SessionInfo[]

  /**
   * Subscribe to a session lifecycle event.
   * Mirrors SessionRegistry.on() — see daemon/src/registry.ts for emit ordering.
   * Returns `void` — bot never chains on the return value (see DecisionQueuePort).
   */
  on(event: SessionEventName, listener: SessionEventListener): void

  /**
   * Unsubscribe from a session lifecycle event.
   * Mirrors SessionRegistry.off().
   */
  off(event: SessionEventName, listener: SessionEventListener): void
}
