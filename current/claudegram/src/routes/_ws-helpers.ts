/**
 * Shared WebSocket helper utilities used across route handlers.
 * Kept minimal — only helpers that would otherwise be duplicated >10 lines.
 */

import type { ServerWebSocket } from 'bun';
import type { Logger } from '../logger.js';

// ── Backpressure guard ────────────────────────────────────────────────────────

/**
 * Tagged result from `sendWithBackpressure`.
 * Renamed from the inline helper to avoid collision with `SessionRegistry.SendResult`.
 */
export type BackpressureResult = { ok: true } | { ok: false; reason: 'buffer_full' };

/**
 * Send `text` through `ws` unless the socket's outbound buffer has already
 * exceeded `capBytes`.  Returns `{ ok: false, reason: 'buffer_full' }` in that
 * case so callers can decide whether to drop or escalate.
 */
export function sendWithBackpressure(
  ws: ServerWebSocket<unknown>,
  text: string,
  capBytes: number,
): BackpressureResult {
  if (ws.getBufferedAmount() > capBytes) {
    return { ok: false, reason: 'buffer_full' };
  }
  ws.send(text);
  return { ok: true };
}

// ── Shared error-reason union ─────────────────────────────────────────────────

/**
 * All error reasons that may appear in outbound `{type:'error'}` frames sent
 * from any WebSocket route handler.  Adding a new reason here is the only
 * change needed to extend the type — `sendErrorFrame` enforces it at the
 * call site.
 */
export type WsErrorReason =
  | 'invalid_payload'
  | 'session_not_connected'
  | 'unknown_message'
  | 'internal_error'
  | 'send_failed';

// ── Error frame sender ────────────────────────────────────────────────────────

/**
 * Payload shape accepted by `sendErrorFrame`.
 * `reason` must be a known `WsErrorReason`; additional string/number/undefined
 * fields (e.g. `session_id`, `client_msg_id`, `up_to_message_id`) are allowed.
 */
export type ErrorFramePayload = { reason: WsErrorReason } & Record<string, string | number | undefined>;

/**
 * Send a JSON error frame to `ws`, guarded by backpressure.
 * Logs a warn if the socket buffer is full and the frame is dropped.
 */
export function sendErrorFrame(
  ws: ServerWebSocket<unknown>,
  payload: ErrorFramePayload,
  capBytes: number,
  logger: Logger,
  phase: string,
): void {
  const errorText = JSON.stringify({ type: 'error', ...payload });
  const result = sendWithBackpressure(ws, errorText, capBytes);
  if (!result.ok) {
    logger.warn('ws_buffer_full', { phase });
  }
}
