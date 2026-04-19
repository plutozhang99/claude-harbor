import type { ServerWebSocket } from 'bun';

// ── Payload types ─────────────────────────────────────────────────────────────

export type OutboundSessionPayload = {
  readonly type: 'reply';
  readonly text: string;
  readonly reply_to?: string;
  readonly client_msg_id: string;
  readonly origin: 'pwa';
};

// ── Result types ──────────────────────────────────────────────────────────────

/**
 * Tagged result returned by `send()`.
 * Future arms (e.g. `'buffer_full'`) added in P2.5 by extending the `reason` union.
 */
export type SendResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'no_session' | 'send_failed' };

// ── Interface ─────────────────────────────────────────────────────────────────

export interface SessionRegistry {
  /**
   * Register a WebSocket for the given session_id.
   *
   * If a prior socket is already registered for the same session_id it is
   * evicted: `ws.close(1000, 'evicted by new registration')` is called on it
   * before the map entry is replaced.  This is normal behaviour when fakechat
   * restarts — do NOT treat it as an error.
   *
   * Returns a `Disposable` whose `[Symbol.dispose]()` calls `unregister`.
   */
  register(session_id: string, ws: ServerWebSocket<unknown>): Disposable;

  /**
   * Send a payload to the socket registered for `session_id`.
   * JSON-serialises the payload exactly once.
   * Returns `{ ok: true }` on success, or a tagged error object on failure.
   */
  send(session_id: string, payload: OutboundSessionPayload): SendResult;

  /** Remove the registration for `session_id` (no-op if not registered). */
  unregister(session_id: string): void;

  /** Number of currently registered sessions. */
  readonly size: number;
}

// ── Implementation ────────────────────────────────────────────────────────────

export class InMemorySessionRegistry implements SessionRegistry {
  private readonly sockets = new Map<string, ServerWebSocket<unknown>>();

  register(session_id: string, ws: ServerWebSocket<unknown>): Disposable {
    const existing = this.sockets.get(session_id);
    if (existing !== undefined) {
      try {
        existing.close(1000, 'evicted by new registration');
      } catch (err) {
        // Mirror hub.ts:33-36 — socket may already be in terminal state. Log and proceed.
        // Use console.warn for now (project has no shared logger in this module yet).
        console.warn('[SessionRegistry] eviction close() failed:', err instanceof Error ? err.message : String(err));
      }
    }
    this.sockets.set(session_id, ws);

    let disposed = false;
    const registeredWs = ws; // capture at registration time
    return {
      [Symbol.dispose]: () => {
        if (disposed) return;
        disposed = true;
        if (this.sockets.get(session_id) === registeredWs) {
          this.sockets.delete(session_id);
        }
      },
    };
  }

  send(session_id: string, payload: OutboundSessionPayload): SendResult {
    const ws = this.sockets.get(session_id);
    if (ws === undefined) return { ok: false, reason: 'no_session' };
    const text = JSON.stringify(payload);
    try {
      ws.send(text);
      return { ok: true };
    } catch (err) {
      console.warn('[SessionRegistry] ws.send() failed for', session_id, ':', err instanceof Error ? err.message : String(err));
      return { ok: false, reason: 'send_failed' };
    }
  }

  unregister(session_id: string): void {
    this.sockets.delete(session_id);
  }

  get size(): number {
    return this.sockets.size;
  }
}
