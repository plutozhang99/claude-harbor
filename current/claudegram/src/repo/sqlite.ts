import type { Database } from '../db/client.js';
import type { Message, Session, MessageInsert, SessionUpsert, MessageRepo, SessionRepo } from './types.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

// ─────────────────────────────── MessageRepo ───────────────────────────────

export class SqliteMessageRepo implements MessageRepo {
  private readonly stmtInsertWithIngested: ReturnType<Database['prepare']>;
  private readonly stmtInsertWithoutIngested: ReturnType<Database['prepare']>;
  private readonly stmtFindWithBefore: ReturnType<Database['prepare']>;
  private readonly stmtFindWithoutBefore: ReturnType<Database['prepare']>;

  constructor(private readonly db: Database) {
    this.stmtInsertWithIngested = db.prepare(
      `INSERT INTO messages (session_id, id, direction, ts, content, ingested_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(session_id, id) DO NOTHING`
    );

    this.stmtInsertWithoutIngested = db.prepare(
      `INSERT INTO messages (session_id, id, direction, ts, content)
       VALUES (?,?,?,?,?)
       ON CONFLICT(session_id, id) DO NOTHING`
    );

    this.stmtFindWithBefore = db.prepare(
      `SELECT session_id, id, direction, ts, ingested_at, content
       FROM messages
       WHERE session_id=? AND ts<?
       ORDER BY ts DESC
       LIMIT ?`
    );

    this.stmtFindWithoutBefore = db.prepare(
      `SELECT session_id, id, direction, ts, ingested_at, content
       FROM messages
       WHERE session_id=?
       ORDER BY ts DESC
       LIMIT ?`
    );
  }

  insert(msg: MessageInsert): void {
    if (msg.ingested_at !== undefined) {
      this.stmtInsertWithIngested.run(
        msg.session_id,
        msg.id,
        msg.direction,
        msg.ts,
        msg.content,
        msg.ingested_at
      );
    } else {
      this.stmtInsertWithoutIngested.run(
        msg.session_id,
        msg.id,
        msg.direction,
        msg.ts,
        msg.content
      );
    }
  }

  // Clamp silently: HTTP layer is the enforcement point for invalid input.
  // Clamping floor to 1 prevents SQLite's "LIMIT -1 = unlimited" footgun.
  findBySession(session_id: string, opts?: { before?: number; limit?: number }): ReadonlyArray<Message> {
    const rawLimit = opts?.limit ?? DEFAULT_LIMIT;
    const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);

    if (opts?.before !== undefined) {
      return this.stmtFindWithBefore.all(session_id, opts.before, limit) as Message[];
    }
    return this.stmtFindWithoutBefore.all(session_id, limit) as Message[];
  }
}

// ─────────────────────────────── SessionRepo ───────────────────────────────

export class SqliteSessionRepo implements SessionRepo {
  private readonly stmtUpsert: ReturnType<Database['prepare']>;
  private readonly stmtFindById: ReturnType<Database['prepare']>;

  constructor(private readonly db: Database) {
    this.stmtUpsert = db.prepare(
      `INSERT INTO sessions (id, name, first_seen_at, last_seen_at)
       VALUES (?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         name = excluded.name`
    );

    this.stmtFindById = db.prepare(
      `SELECT id, name, first_seen_at, last_seen_at
       FROM sessions
       WHERE id=?`
    );
  }

  upsert(s: SessionUpsert): void {
    this.stmtUpsert.run(s.id, s.name, s.now, s.now);
  }

  findById(id: string): Readonly<Session> | null {
    return (this.stmtFindById.get(id) as Session | null) ?? null;
  }
}
