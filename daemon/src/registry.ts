import type {
  Session,
  SessionId,
  RegisterSessionRequest,
  ISOTimestamp,
  Result,
  ErrorResponse,
} from '@claudegram/shared'

const IDLE_THRESHOLD_MS = 30 * 60 * 1000 // 30 minutes

export class SessionRegistry {
  private sessions = new Map<SessionId, Session>()
  private startTime = Date.now()

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
    for (const existing of this.sessions.values()) {
      if (existing.name === req.name) {
        if (!this.isIdle(existing)) {
          const errorResponse: ErrorResponse = {
            error: 'SESSION_NAME_CONFLICT',
            message: `A session named "${req.name}" is already active.`,
          }
          return { ok: false, error: errorResponse }
        }
        // Idle session with same name — replace it
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
    return { ok: true, data: session }
  }

  /** Remove a session. Returns SESSION_NOT_FOUND if unknown. */
  unregister(sessionId: SessionId): Result<void> {
    if (!this.sessions.has(sessionId)) {
      const errorResponse: ErrorResponse = {
        error: 'SESSION_NOT_FOUND',
        message: `Session "${sessionId}" not found.`,
      }
      return { ok: false, error: errorResponse }
    }

    this.sessions.delete(sessionId)
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
