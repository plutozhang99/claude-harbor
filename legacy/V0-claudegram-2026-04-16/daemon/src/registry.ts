import { EventEmitter } from 'node:events'
import type {
  Session,
  SessionId,
  RegisterSessionRequest,
  ISOTimestamp,
  Result,
  ErrorResponse,
} from '@claudegram/shared'

const IDLE_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

// ─── Typed event map for SessionRegistry ─────────────────────────────────────

export type SessionEventMap = {
  registered: (session: Session) => void
  deregistered: (session: Session) => void
}

export class SessionRegistry {
  private sessions = new Map<SessionId, Session>()
  private startTime = Date.now()
  private readonly emitter = new EventEmitter()

  // ─── Typed event subscription API ──────────────────────────────────────────
  // Cast to `(...args: unknown[]) => void` is safe because:
  //   1. Node's EventEmitter has no native generic event-map support.
  //   2. `_emit` is the only call site that emits, and it is itself typed by
  //      SessionEventMap, so listeners only ever receive a Session.
  // Do not "clean up" this cast without preserving the type guarantee.

  on<K extends keyof SessionEventMap>(event: K, listener: SessionEventMap[K]): this {
    this.emitter.on(event, listener as (...args: unknown[]) => void)
    return this
  }

  off<K extends keyof SessionEventMap>(event: K, listener: SessionEventMap[K]): this {
    this.emitter.off(event, listener as (...args: unknown[]) => void)
    return this
  }

  /** Emit safely — a synchronous throw in a listener would otherwise propagate
   *  out of HTTP request handlers as an uncaught exception and crash the daemon.
   *  Listener errors are logged and swallowed. */
  private _emit<K extends keyof SessionEventMap>(event: K, session: Session): void {
    try {
      this.emitter.emit(event, session)
    } catch (err) {
      console.error(
        `[SessionRegistry] listener error on '${event}':`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  /** Returns the session if found. */
  get(sessionId: SessionId): Session | undefined {
    return this.sessions.get(sessionId)
  }

  /** Returns all sessions (both active and idle). */
  getAll(): Session[] {
    return Array.from(this.sessions.values())
  }

  /** Register a new session. */
  register(req: RegisterSessionRequest): Result<Session> {
    const now = new Date().toISOString() as ISOTimestamp

    // Check for name conflicts
    let staleSession: Session | undefined
    for (const existing of this.sessions.values()) {
      if (existing.name === req.name) {
        if (!this.isIdle(existing)) {
          const errorResponse: ErrorResponse = {
            error: 'SESSION_NAME_CONFLICT',
            message: `A session named "${req.name}" is already active.`,
          }
          return { ok: false, error: errorResponse }
        }
        // Idle session with same name — replace it; capture for deregistered event
        staleSession = existing
        this.sessions.delete(existing.sessionId)
        break
      }
    }

    const sessionId = crypto.randomUUID() as SessionId
    const session: Session = {
      sessionId,
      name: req.name,
      projectPath: req.projectPath,
      registeredAt: now,
      lastActiveAt: now,
    }

    this.sessions.set(sessionId, session)

    // Emit 'deregistered' for the stale session BEFORE 'registered' for the new one
    if (staleSession !== undefined) {
      this._emit('deregistered', staleSession)
    }
    this._emit('registered', session)

    return { ok: true, data: session }
  }

  /** Remove a session. Returns SESSION_NOT_FOUND if unknown. */
  unregister(sessionId: SessionId): Result<void> {
    const existing = this.sessions.get(sessionId)
    if (existing === undefined) {
      const errorResponse: ErrorResponse = {
        error: 'SESSION_NOT_FOUND',
        message: `Session "${sessionId}" not found.`,
      }
      return { ok: false, error: errorResponse }
    }

    this.sessions.delete(sessionId)
    this._emit('deregistered', existing)
    return { ok: true, data: undefined }
  }

  /** Update lastActiveAt for a session (called on any activity). */
  touch(sessionId: SessionId): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      const updated: Session = {
        ...session,
        lastActiveAt: new Date().toISOString() as ISOTimestamp,
      }
      this.sessions.set(sessionId, updated)
    }
  }

  /** Returns true if the session has been inactive for more than 30 minutes. */
  isIdle(session: Session): boolean {
    const lastActive = new Date(session.lastActiveAt).getTime()
    return Date.now() - lastActive > IDLE_THRESHOLD_MS
  }

  /** Returns uptime in seconds. */
  uptimeSeconds(): number {
    return Math.floor((Date.now() - this.startTime) / 1000)
  }
}
