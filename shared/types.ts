// ─── Branded primitive types ────────────────────────────────────────────────

declare const __brand: unique symbol;
type Brand<T, B> = T & { readonly [__brand]: B };

export type SessionId    = Brand<string, 'SessionId'>;
export type RequestId    = Brand<string, 'RequestId'>;
export type ISOTimestamp = Brand<string, 'ISOTimestamp'>;

// ─── Domain enums ────────────────────────────────────────────────────────────

export type DecisionStatus    = 'pending' | 'answered' | 'expired' | 'cancelled';
export type PermissionBehavior = 'allow' | 'deny';
export type DecisionType      = 'permission' | 'custom';

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEFAULT_TTL_SECONDS = 300;
/** Milliseconds a decision stays retrievable after being answered, to prevent
 *  race conditions between Telegram callback storage and channel-server poll. */
export const ANSWERED_RETENTION_MS = 30_000;

// ─── Session ─────────────────────────────────────────────────────────────────

export interface Session {
  sessionId:     SessionId;
  name:          string;
  projectPath:   string;
  registeredAt:  ISOTimestamp;
  lastActiveAt:  ISOTimestamp;
}

// ─── Decision ────────────────────────────────────────────────────────────────

export interface DecisionOption {
  id:    string;   // e.g. "yes", "no"
  label: string;   // Button text, e.g. "Yes", "No"
}

interface DecisionBase {
  requestId:   RequestId;
  sessionId:   SessionId;
  sessionName: string;
  type:        DecisionType;
  title:       string;
  description: string;
  options:     DecisionOption[];
  createdAt:   ISOTimestamp;
  expiresAt:   ISOTimestamp;  // unanswered expiry (DEFAULT_TTL_SECONDS after createdAt)
}

/** Discriminated union — narrow on `status` to access answered-only fields. */
export type Decision =
  | (DecisionBase & { status: 'pending' })
  | (DecisionBase & { status: 'answered'; answer: string; answeredAt: ISOTimestamp })
  | (DecisionBase & { status: 'expired' })
  | (DecisionBase & { status: 'cancelled' });

// ─── Permission verdict (channel-server → Claude Code) ───────────────────────

/** Discriminated union returned by the channel-server to Claude Code.
 *  - `allow`  → proceed without prompting
 *  - `deny`   → block the operation; optional `reason` surfaced to the user
 */
export type PermissionVerdict =
  | { readonly behavior: 'allow' }
  | { readonly behavior: 'deny'; readonly reason?: string }

// ─── Error types ─────────────────────────────────────────────────────────────

export type DaemonErrorCode =
  | 'SESSION_NAME_CONFLICT'
  | 'SESSION_NOT_FOUND'
  | 'DECISION_NOT_FOUND'
  | 'DAEMON_UNREACHABLE'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR';

export interface ErrorResponse {
  error:   DaemonErrorCode;
  message: string;
}

/** Typed result wrapper for fallible operations.
 *  E defaults to ErrorResponse for daemon operations; use a narrower error type
 *  for protocol-level parsing (e.g. CallbackParseError from @claudegram/shared/protocol). */
export type Result<T, E = ErrorResponse> =
  | { ok: true;  data:  T }
  | { ok: false; error: E };

// ─── HTTP API — Sessions ──────────────────────────────────────────────────────

// POST /api/sessions
export interface RegisterSessionRequest {
  name:        string;
  projectPath: string;
}
export interface RegisterSessionResponse {
  sessionId: SessionId;
  name:      string;
}

// DELETE /api/sessions/:sessionId  — no body, returns 204

// GET /api/sessions
export interface ListSessionsResponse {
  sessions: Session[];
}

// ─── HTTP API — Decisions ─────────────────────────────────────────────────────

// POST /api/decisions
export interface CreateDecisionRequest {
  sessionId:   SessionId;
  sessionName: string;
  type:        DecisionType;
  title:       string;
  description: string;
  options:     DecisionOption[];
  ttlSeconds?: number;          // defaults to DEFAULT_TTL_SECONDS
}
export interface CreateDecisionResponse {
  requestId: RequestId;
  status:    'pending';         // decision is created in pending state
}

// GET /api/decisions/:requestId  (long-poll: blocks until answered or 30s timeout)
export type PollDecisionResponse =
  | { requestId: RequestId; status: 'pending' | 'expired' | 'cancelled' }
  | { requestId: RequestId; status: 'answered'; answer: string };

// GET /api/decisions  (list decisions, optionally filtered by status)
export interface ListDecisionsResponse {
  decisions: Decision[];
}

// DELETE /api/decisions/:requestId  — no body, returns 204

// ─── HTTP API — Health ────────────────────────────────────────────────────────

// GET /api/health
export interface HealthResponse {
  ok:               boolean;
  uptime:           number;   // seconds since daemon start
  sessions:         number;   // active session count
  pendingDecisions: number;   // pending decision count
}
