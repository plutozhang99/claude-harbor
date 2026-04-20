/**
 * SQLite DDL per PLAN §8. Applied on startup; idempotent (IF NOT EXISTS).
 *
 * Lightweight validators for hook payloads also live here. They mirror
 * the hand-rolled style used elsewhere in the server (we deliberately
 * avoid adding zod to keep the dependency surface minimal).
 */

import { asString } from "./http-utils.ts";

export type HookValidation =
  | { ok: true; session_id: string; raw: Record<string, unknown> }
  | { ok: false; status: 400 | 413; error: string };

/**
 * Shared shape for every hook endpoint: payload MUST be a JSON object
 * with a non-empty string `session_id`. Oversize / malformed bodies are
 * caught earlier in the request path; this just verifies shape.
 */
export function validateHookPayload(body: unknown): HookValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, status: 400, error: "invalid json" };
  }
  const raw = body as Record<string, unknown>;
  const session_id = asString(raw.session_id);
  if (!session_id) {
    return { ok: false, status: 400, error: "missing session_id" };
  }
  return { ok: true, session_id, raw };
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  channel_token TEXT UNIQUE NOT NULL,
  cwd TEXT,
  pid INTEGER,
  project_dir TEXT,
  account_hint TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  ended_reason TEXT,
  latest_model TEXT,
  latest_model_display TEXT,
  latest_ctx_pct REAL,
  latest_ctx_window_size INTEGER,
  latest_limits_json TEXT,
  latest_cost_usd REAL,
  latest_version TEXT,
  latest_permission_mode TEXT,
  latest_statusline_at INTEGER,
  status TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);
CREATE INDEX IF NOT EXISTS idx_sessions_channel_token ON sessions(channel_token);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  direction TEXT,
  content TEXT,
  meta_json TEXT,
  created_at INTEGER,
  FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

CREATE TABLE IF NOT EXISTS tool_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  hook_event TEXT,
  tool_name TEXT,
  tool_input_json TEXT,
  tool_output_json TEXT,
  permission_mode TEXT,
  created_at INTEGER,
  FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT,
  keys_json TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS install_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  account_hint TEXT,
  updated_at INTEGER NOT NULL
);
`;

/**
 * Idempotent additive migrations for columns that post-date the initial
 * schema. Each statement must tolerate the column already existing
 * (we swallow the error) so `start()` can apply them on every boot.
 */
export const MIGRATIONS: ReadonlyArray<string> = [
  "ALTER TABLE sessions ADD COLUMN ended_reason TEXT",
];
