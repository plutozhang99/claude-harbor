import { describe, it, expect, beforeEach } from 'bun:test';
import { openDatabase, closeDatabase } from './client.js';
import type { Database } from './client.js';
import { migrate } from './migrate.js';

type SqliteMasterRow = { type: string; name: string };

describe('migrate', () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  // No afterEach cleanup — memory DBs are GC'd and tests are isolated.

  it('1. creates sessions table, messages table, and index in sqlite_master', () => {
    migrate(db);
    const rows = db
      .query<SqliteMasterRow, string[]>(
        `SELECT type, name FROM sqlite_master WHERE name IN (?,?,?) ORDER BY name`,
      )
      .all('idx_messages_session_ts', 'messages', 'sessions');

    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(['idx_messages_session_ts', 'messages', 'sessions']);
    expect(rows.find((r) => r.name === 'sessions')?.type).toBe('table');
    expect(rows.find((r) => r.name === 'messages')?.type).toBe('table');
    expect(rows.find((r) => r.name === 'idx_messages_session_ts')?.type).toBe('index');
    closeDatabase(db);
  });

  it('2. can INSERT a valid sessions row after migrate', () => {
    migrate(db);
    expect(() =>
      db.run(
        `INSERT INTO sessions (id, name, first_seen_at, last_seen_at) VALUES (?,?,?,?)`,
        ['s1', 'My Session', 1000, 2000],
      ),
    ).not.toThrow();
    closeDatabase(db);
  });

  it('3. INSERT into messages with unknown session_id throws FK constraint', () => {
    migrate(db);
    expect(() =>
      db.run(
        `INSERT INTO messages (session_id, id, direction, ts, content) VALUES (?,?,?,?,?)`,
        ['no-such-session', 'm1', 'user', 1000, 'hello'],
      ),
    ).toThrow();
    closeDatabase(db);
  });

  it('4. INSERT into messages with direction="bot" throws CHECK constraint', () => {
    migrate(db);
    db.run(
      `INSERT INTO sessions (id, name, first_seen_at, last_seen_at) VALUES (?,?,?,?)`,
      ['s1', 'Session', 1000, 2000],
    );
    expect(() =>
      db.run(
        `INSERT INTO messages (session_id, id, direction, ts, content) VALUES (?,?,?,?,?)`,
        ['s1', 'm1', 'bot', 1000, 'hello'],
      ),
    ).toThrow();
    closeDatabase(db);
  });

  it('5. direction="user" and direction="assistant" both succeed', () => {
    migrate(db);
    db.run(
      `INSERT INTO sessions (id, name, first_seen_at, last_seen_at) VALUES (?,?,?,?)`,
      ['s1', 'Session', 1000, 2000],
    );
    expect(() =>
      db.run(
        `INSERT INTO messages (session_id, id, direction, ts, content) VALUES (?,?,?,?,?)`,
        ['s1', 'm1', 'user', 1000, 'hello'],
      ),
    ).not.toThrow();
    expect(() =>
      db.run(
        `INSERT INTO messages (session_id, id, direction, ts, content) VALUES (?,?,?,?,?)`,
        ['s1', 'm2', 'assistant', 1001, 'world'],
      ),
    ).not.toThrow();
    closeDatabase(db);
  });

  it('6. ingested_at default has true millisecond precision within [beforeInsert, afterInsert]', () => {
    migrate(db);
    db.run(
      `INSERT INTO sessions (id, name, first_seen_at, last_seen_at) VALUES (?,?,?,?)`,
      ['s1', 'Session', 1000, 2000],
    );
    const beforeInsert = Date.now();
    db.run(
      `INSERT INTO messages (session_id, id, direction, ts, content) VALUES (?,?,?,?,?)`,
      ['s1', 'm1', 'user', 1000, 'hello'],
    );
    const afterInsert = Date.now();
    const row = db
      .query<{ ingested_at: number }, [string]>(`SELECT ingested_at FROM messages WHERE id=?`)
      .get('m1');
    expect(row).not.toBeNull();
    expect(row!.ingested_at).toBeGreaterThanOrEqual(beforeInsert);
    expect(row!.ingested_at).toBeLessThanOrEqual(afterInsert);
    closeDatabase(db);
  });

  it('7. running migrate twice is idempotent — no throw, still exactly 3 objects', () => {
    migrate(db);
    expect(() => migrate(db)).not.toThrow();
    const rows = db
      .query<SqliteMasterRow, string[]>(
        `SELECT name FROM sqlite_master WHERE name IN (?,?,?)`,
      )
      .all('idx_messages_session_ts', 'messages', 'sessions');
    expect(rows).toHaveLength(3);
    closeDatabase(db);
  });

  it('8. composite PK: inserting same (session_id, id) twice throws', () => {
    migrate(db);
    db.run(
      `INSERT INTO sessions (id, name, first_seen_at, last_seen_at) VALUES (?,?,?,?)`,
      ['s1', 'Session', 1000, 2000],
    );
    db.run(
      `INSERT INTO messages (session_id, id, direction, ts, content) VALUES (?,?,?,?,?)`,
      ['s1', 'm1', 'user', 1000, 'hello'],
    );
    expect(() =>
      db.run(
        `INSERT INTO messages (session_id, id, direction, ts, content) VALUES (?,?,?,?,?)`,
        ['s1', 'm1', 'user', 1001, 'again'],
      ),
    ).toThrow();
    closeDatabase(db);
  });

  it('9. same message id under different session_ids both succeed (composite PK)', () => {
    migrate(db);
    db.run(
      `INSERT INTO sessions (id, name, first_seen_at, last_seen_at) VALUES (?,?,?,?)`,
      ['s1', 'Session A', 1000, 2000],
    );
    db.run(
      `INSERT INTO sessions (id, name, first_seen_at, last_seen_at) VALUES (?,?,?,?)`,
      ['s2', 'Session B', 1000, 2000],
    );
    expect(() =>
      db.run(
        `INSERT INTO messages (session_id, id, direction, ts, content) VALUES (?,?,?,?,?)`,
        ['s1', 'shared-id', 'user', 1000, 'from s1'],
      ),
    ).not.toThrow();
    expect(() =>
      db.run(
        `INSERT INTO messages (session_id, id, direction, ts, content) VALUES (?,?,?,?,?)`,
        ['s2', 'shared-id', 'assistant', 1001, 'from s2'],
      ),
    ).not.toThrow();
    closeDatabase(db);
  });

  it('10. deleting a session cascades to its messages', () => {
    migrate(db);
    db.run(
      `INSERT INTO sessions (id, name, first_seen_at, last_seen_at) VALUES (?,?,?,?)`,
      ['s1', 'Session', 1000, 2000],
    );
    db.run(
      `INSERT INTO messages (session_id, id, direction, ts, content) VALUES (?,?,?,?,?)`,
      ['s1', 'm1', 'user', 1000, 'hello'],
    );
    db.run(`DELETE FROM sessions WHERE id=?`, ['s1']);
    const count = db
      .query<{ cnt: number }, [string]>(`SELECT COUNT(*) as cnt FROM messages WHERE session_id=?`)
      .get('s1');
    expect(count!.cnt).toBe(0);
    closeDatabase(db);
  });
});
