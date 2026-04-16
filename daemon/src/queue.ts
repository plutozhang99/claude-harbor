import type {
  Decision,
  DecisionStatus,
  DecisionOption,
  DecisionType,
  SessionId,
  RequestId,
  ISOTimestamp,
  CreateDecisionRequest,
  Result,
  ErrorResponse,
} from '@claudegram/shared'
import { DEFAULT_TTL_SECONDS, ANSWERED_RETENTION_MS } from '@claudegram/shared'

// Internal mutable representation (not exported — only Decision union is public)
type MutableDecision = {
  requestId: RequestId
  sessionId: SessionId
  sessionName: string
  type: DecisionType
  title: string
  description: string
  options: DecisionOption[]
  createdAt: ISOTimestamp
  expiresAt: ISOTimestamp
  status: DecisionStatus
  answer?: string
  answeredAt?: ISOTimestamp
}

type Poller = {
  resolve: (d: Decision) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

const TERMINAL_STATUSES = new Set<DecisionStatus>(['answered', 'expired', 'cancelled'])
const MAX_POLLERS_PER_REQUEST = 5

export class DecisionQueue {
  private decisions = new Map<RequestId, MutableDecision>()
  private pollers = new Map<RequestId, Poller[]>()
  private ttlTimers = new Map<RequestId, ReturnType<typeof setTimeout>>()
  private cleanupTimers = new Map<RequestId, ReturnType<typeof setTimeout>>()

  /** Create a new pending decision and start its TTL timer. */
  create(req: CreateDecisionRequest): Result<Decision> {
    if (req.options.length < 2 || req.options.length > 6) {
      const err: ErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: 'options must contain between 2 and 6 items.',
      }
      return { ok: false, error: err }
    }

    const requestId = crypto.randomUUID() as RequestId
    const now = new Date()
    const createdAt = now.toISOString() as ISOTimestamp
    const ttlSeconds = req.ttlSeconds ?? DEFAULT_TTL_SECONDS
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString() as ISOTimestamp

    const decision: MutableDecision = {
      requestId,
      sessionId: req.sessionId,
      sessionName: req.sessionName,
      type: req.type,
      title: req.title,
      description: req.description,
      options: req.options,
      createdAt,
      expiresAt,
      status: 'pending',
    }

    this.decisions.set(requestId, decision)

    const timer = setTimeout(() => {
      this._expire(requestId)
    }, ttlSeconds * 1000)
    this.ttlTimers.set(requestId, timer)

    return { ok: true, data: this._toDecision(decision) }
  }

  /** Get a decision by ID. */
  get(requestId: RequestId): Decision | undefined {
    const m = this.decisions.get(requestId)
    if (!m) return undefined
    return this._toDecision(m)
  }

  /** Return all non-deleted decisions (all statuses). */
  getAll(): Decision[] {
    return Array.from(this.decisions.values()).map((m) => this._toDecision(m))
  }

  /** Long-poll: resolves when decision is answered/expired/cancelled, or after timeoutMs. */
  async poll(requestId: RequestId, timeoutMs = 30_000): Promise<Decision | undefined> {
    const m = this.decisions.get(requestId)
    if (!m) return undefined

    if (TERMINAL_STATUSES.has(m.status)) {
      return this._toDecision(m)
    }

    // Cap concurrent pollers per request to prevent resource exhaustion
    const existingPollers = this.pollers.get(requestId) ?? []
    if (existingPollers.length >= MAX_POLLERS_PER_REQUEST) {
      return this._toDecision(m)
    }

    return new Promise<Decision>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        // Remove this poller from the list
        const currentPollers = this.pollers.get(requestId)
        if (currentPollers) {
          const filtered = currentPollers.filter((p) => p.timeoutHandle !== timeoutHandle)
          if (filtered.length === 0) {
            this.pollers.delete(requestId)
          } else {
            this.pollers.set(requestId, filtered)
          }
        }
        // Resolve with whatever the current state is
        const current = this.decisions.get(requestId)
        if (current) {
          resolve(this._toDecision(current))
        } else {
          // Decision was cleaned up; resolve with a synthetic expired view — shouldn't normally happen
          resolve(this._toDecision({ ...m, status: 'expired' }))
        }
      }, timeoutMs)

      const poller: Poller = { resolve, timeoutHandle }
      this.pollers.set(requestId, [...existingPollers, poller])
    })
  }

  /** Submit an answer (called by Telegram callback handler in Phase 3). */
  answer(requestId: RequestId, optionId: string): Result<Decision> {
    const m = this.decisions.get(requestId)
    if (!m) {
      const err: ErrorResponse = {
        error: 'DECISION_NOT_FOUND',
        message: `Decision "${requestId}" not found.`,
      }
      return { ok: false, error: err }
    }

    if (m.status !== 'pending') {
      const err: ErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: `Decision "${requestId}" is not pending (status: ${m.status}).`,
      }
      return { ok: false, error: err }
    }

    const validOption = m.options.find((o) => o.id === optionId)
    if (!validOption) {
      const err: ErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: `Option "${optionId}" is not valid for decision "${requestId}".`,
      }
      return { ok: false, error: err }
    }

    // Clear TTL timer
    const timer = this.ttlTimers.get(requestId)
    if (timer) {
      clearTimeout(timer)
      this.ttlTimers.delete(requestId)
    }

    const answeredAt = new Date().toISOString() as ISOTimestamp
    const updated: MutableDecision = {
      ...m,
      status: 'answered',
      answer: optionId,
      answeredAt,
    }
    this.decisions.set(requestId, updated)

    // Resolve all waiting pollers
    this._resolvePollers(requestId)

    // Schedule deletion after retention period
    this._scheduleCleanup(requestId)

    return { ok: true, data: this._toDecision(updated) }
  }

  /** Cancel a decision (DELETE /api/decisions/:requestId). */
  cancel(requestId: RequestId): Result<void> {
    const m = this.decisions.get(requestId)
    if (!m) {
      const err: ErrorResponse = {
        error: 'DECISION_NOT_FOUND',
        message: `Decision "${requestId}" not found.`,
      }
      return { ok: false, error: err }
    }

    // Idempotent — if already terminal, return ok
    if (TERMINAL_STATUSES.has(m.status)) {
      return { ok: true, data: undefined }
    }

    // Clear TTL timer
    const timer = this.ttlTimers.get(requestId)
    if (timer) {
      clearTimeout(timer)
      this.ttlTimers.delete(requestId)
    }

    const updated: MutableDecision = { ...m, status: 'cancelled' }
    this.decisions.set(requestId, updated)

    // Resolve all waiting pollers
    this._resolvePollers(requestId)

    // Schedule deletion after retention period
    this._scheduleCleanup(requestId)

    return { ok: true, data: undefined }
  }

  /** Count of decisions currently in 'pending' status. */
  pendingCount(): number {
    let count = 0
    for (const m of this.decisions.values()) {
      if (m.status === 'pending') count++
    }
    return count
  }

  // Private helpers

  private _expire(requestId: RequestId): void {
    const m = this.decisions.get(requestId)
    if (!m || m.status !== 'pending') return

    const updated: MutableDecision = { ...m, status: 'expired' }
    this.decisions.set(requestId, updated)
    this.ttlTimers.delete(requestId)

    this._resolvePollers(requestId)
    this._scheduleCleanup(requestId)
  }

  private _resolvePollers(requestId: RequestId): void {
    const waiters = this.pollers.get(requestId)
    if (!waiters) return

    const m = this.decisions.get(requestId)
    if (!m) return

    const decision = this._toDecision(m)
    for (const poller of waiters) {
      clearTimeout(poller.timeoutHandle)
      poller.resolve(decision)
    }

    this.pollers.delete(requestId)
  }

  private _scheduleCleanup(requestId: RequestId): void {
    const handle = setTimeout(() => {
      this.decisions.delete(requestId)
      this.ttlTimers.delete(requestId)
      this.cleanupTimers.delete(requestId)
    }, ANSWERED_RETENTION_MS)
    this.cleanupTimers.set(requestId, handle)
  }

  /** Clear all timers and pollers. Call on daemon shutdown. */
  destroy(): void {
    for (const timer of this.ttlTimers.values()) {
      clearTimeout(timer)
    }
    this.ttlTimers.clear()

    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer)
    }
    this.cleanupTimers.clear()

    for (const [requestId, waiters] of this.pollers.entries()) {
      const m = this.decisions.get(requestId)
      for (const poller of waiters) {
        clearTimeout(poller.timeoutHandle)
        if (m) {
          poller.resolve(this._toDecision({ ...m, status: 'cancelled' }))
        }
      }
    }
    this.pollers.clear()
  }

  private _toDecision(m: MutableDecision): Decision {
    const base = {
      requestId: m.requestId,
      sessionId: m.sessionId,
      sessionName: m.sessionName,
      type: m.type,
      title: m.title,
      description: m.description,
      options: m.options,
      createdAt: m.createdAt,
      expiresAt: m.expiresAt,
    }

    if (m.status === 'answered') {
      return {
        ...base,
        status: 'answered',
        answer: m.answer!,
        answeredAt: m.answeredAt!,
      }
    }

    if (m.status === 'expired') {
      return { ...base, status: 'expired' }
    }

    if (m.status === 'cancelled') {
      return { ...base, status: 'cancelled' }
    }

    // pending
    return { ...base, status: 'pending' }
  }
}
