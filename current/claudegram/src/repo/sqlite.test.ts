import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { openDatabase, closeDatabase, type Database } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { SqliteMessageRepo, SqliteSessionRepo } from './sqlite.js';

let db: Database;
let msgRepo: SqliteMessageRepo;
let sessRepo: SqliteSessionRepo;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  msgRepo = new SqliteMessageRepo(db);
  sessRepo = new SqliteSessionRepo(db);
});

afterEach(() => {
  closeDatabase(db);
});

// Helper to insert a session before inserting messages (FK requirement)
function insertSession(id: string, name = 'test', now = 1_000_000): void {
  sessRepo.upsert({ id, name, now });
}

describe('SqliteMessageRepo', () => {
  // Test 1: insert a valid message → findBySession returns it
  it('insert valid message then findBySession returns 1 row', () => {
    insertSession('s1');
    msgRepo.insert({ session_id: 's1', id: 'm1', direction: 'user', ts: 100, content: 'hello' });
    const rows = msgRepo.findBySession('s1');
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('m1');
    expect(rows[0].session_id).toBe('s1');
    expect(rows[0].direction).toBe('user');
    expect(rows[0].ts).toBe(100);
    expect(rows[0].content).toBe('hello');
  });

  // Test 2: insert WITHOUT ingested_at → row's ingested_at is within wall-clock range
  it('insert without ingested_at → ingested_at defaults to current time', () => {
    insertSession('s1');
    const before = Date.now();
    msgRepo.insert({ session_id: 's1', id: 'm1', direction: 'user', ts: 100, content: 'hello' });
    const after = Date.now();
    const rows = msgRepo.findBySession('s1');
    expect(rows.length).toBe(1);
    expect(rows[0].ingested_at).toBeGreaterThanOrEqual(before);
    expect(rows[0].ingested_at).toBeLessThanOrEqual(after);
  });

  // Test 3: insert WITH explicit ingested_at=12345 → row has ingested_at === 12345
  it('insert with explicit ingested_at → row preserves that value', () => {
    insertSession('s1');
    msgRepo.insert({ session_id: 's1', id: 'm1', direction: 'user', ts: 100, content: 'hi', ingested_at: 12345 });
    const rows = msgRepo.findBySession('s1');
    expect(rows.length).toBe(1);
    expect(rows[0].ingested_at).toBe(12345);
  });

  // Test 4: insert same (session_id, id) twice → silent no-op, still 1 row
  it('duplicate (session_id, id) is silent no-op', () => {
    insertSession('s1');
    msgRepo.insert({ session_id: 's1', id: 'm1', direction: 'user', ts: 100, content: 'first' });
    msgRepo.insert({ session_id: 's1', id: 'm1', direction: 'user', ts: 200, content: 'second' });
    const rows = msgRepo.findBySession('s1');
    expect(rows.length).toBe(1);
    expect(rows[0].content).toBe('first');
  });

  // Test 5: same id but different session_id → each session returns exactly 1 row
  it('same message id under different session_ids are independent', () => {
    insertSession('s1');
    insertSession('s2');
    msgRepo.insert({ session_id: 's1', id: 'm1', direction: 'user', ts: 100, content: 'from s1' });
    msgRepo.insert({ session_id: 's2', id: 'm1', direction: 'user', ts: 100, content: 'from s2' });
    expect(msgRepo.findBySession('s1').length).toBe(1);
    expect(msgRepo.findBySession('s2').length).toBe(1);
  });

  // Test 6: insert message with no matching session → FK violation throws
  it('insert message with missing session throws FK error', () => {
    expect(() => {
      msgRepo.insert({ session_id: 'nonexistent', id: 'm1', direction: 'user', ts: 100, content: 'bad' });
    }).toThrow();
  });

  // Test 7: direction 'user' and 'assistant' succeed; 'bot' throws CHECK constraint
  it("direction 'user' and 'assistant' succeed; 'bot' throws", () => {
    insertSession('s1');
    expect(() =>
      msgRepo.insert({ session_id: 's1', id: 'm1', direction: 'user', ts: 100, content: 'ok' })
    ).not.toThrow();
    expect(() =>
      msgRepo.insert({ session_id: 's1', id: 'm2', direction: 'assistant', ts: 101, content: 'ok' })
    ).not.toThrow();
    expect(() =>
      // @ts-expect-error intentional invalid direction
      msgRepo.insert({ session_id: 's1', id: 'm3', direction: 'bot', ts: 102, content: 'bad' })
    ).toThrow();
  });

  // Test 8: findBySession on unknown session → empty array
  it('findBySession for unknown session returns empty array', () => {
    const rows = msgRepo.findBySession('unknown');
    expect(rows).toEqual([]);
  });

  // Test 9: findBySession orders by ts DESC
  it('findBySession returns rows ordered by ts DESC', () => {
    insertSession('s1');
    msgRepo.insert({ session_id: 's1', id: 'm1', direction: 'user', ts: 10, content: 'a' });
    msgRepo.insert({ session_id: 's1', id: 'm2', direction: 'user', ts: 30, content: 'c' });
    msgRepo.insert({ session_id: 's1', id: 'm3', direction: 'user', ts: 20, content: 'b' });
    const rows = msgRepo.findBySession('s1');
    expect(rows[0].ts).toBe(30);
    expect(rows[1].ts).toBe(20);
    expect(rows[2].ts).toBe(10);
  });

  // Test 10: findBySession with limit=2 returns 2 most-recent rows (insert 5)
  it('findBySession with limit=2 returns 2 most-recent rows', () => {
    insertSession('s1');
    for (let i = 1; i <= 5; i++) {
      msgRepo.insert({ session_id: 's1', id: `m${i}`, direction: 'user', ts: i * 10, content: `msg${i}` });
    }
    const rows = msgRepo.findBySession('s1', { limit: 2 });
    expect(rows.length).toBe(2);
    expect(rows[0].ts).toBe(50);
    expect(rows[1].ts).toBe(40);
  });

  // Test 11: findBySession with before=<ts> filters out messages with ts >= before
  it('findBySession with before filters messages by ts', () => {
    insertSession('s1');
    msgRepo.insert({ session_id: 's1', id: 'm1', direction: 'user', ts: 10, content: 'a' });
    msgRepo.insert({ session_id: 's1', id: 'm2', direction: 'user', ts: 20, content: 'b' });
    msgRepo.insert({ session_id: 's1', id: 'm3', direction: 'user', ts: 30, content: 'c' });
    const rows = msgRepo.findBySession('s1', { before: 25 });
    // Should return ts=10 and ts=20 (both < 25), ordered DESC
    expect(rows.length).toBe(2);
    expect(rows[0].ts).toBe(20);
    expect(rows[1].ts).toBe(10);
  });

  // Test 12: findBySession with limit=1000 silently caps at 500
  // The cap is enforced in code: Math.min(limit, 500). With 5 rows inserted
  // and limit=1000, we get ≤ 5 (capped to 500 internally, but only 5 exist).
  // To verify the cap code path with data: insert 600 rows and assert only 500 returned.
  it('findBySession with limit=1000 silently caps at 500', () => {
    insertSession('s1');
    for (let i = 1; i <= 600; i++) {
      msgRepo.insert({ session_id: 's1', id: `m${i}`, direction: 'user', ts: i, content: `msg${i}` });
    }
    const rows = msgRepo.findBySession('s1', { limit: 1000 });
    // Cap enforced: never more than 500 returned even when 600 rows exist
    expect(rows.length).toBe(500);
  });

  // Test 12b: limit=0 and limit=-1 are clamped to 1 (not silently unlimited).
  // Without the floor clamp, SQLite treats LIMIT -1 as unlimited.
  it('findBySession with limit=0 returns at most 1 row (clamped, never unlimited)', () => {
    insertSession('s1');
    for (let i = 1; i <= 5; i++) {
      msgRepo.insert({ session_id: 's1', id: `m${i}`, direction: 'user', ts: i, content: `msg${i}` });
    }
    expect(msgRepo.findBySession('s1', { limit: 0 }).length).toBe(1);
    expect(msgRepo.findBySession('s1', { limit: -1 }).length).toBe(1);
    expect(msgRepo.findBySession('s1', { limit: -9999 }).length).toBe(1);
  });

  // Test 13: returned Message objects have all six fields
  it('returned Message objects have all required fields', () => {
    insertSession('s1');
    msgRepo.insert({ session_id: 's1', id: 'm1', direction: 'user', ts: 100, content: 'hello', ingested_at: 999 });
    const rows = msgRepo.findBySession('s1');
    expect(rows.length).toBe(1);
    const msg = rows[0];
    expect(typeof msg.session_id).toBe('string');
    expect(typeof msg.id).toBe('string');
    expect(typeof msg.direction).toBe('string');
    expect(typeof msg.ts).toBe('number');
    expect(typeof msg.ingested_at).toBe('number');
    expect(typeof msg.content).toBe('string');
    // Verify all six fields are present by checking the keys
    expect('session_id' in msg).toBe(true);
    expect('id' in msg).toBe(true);
    expect('direction' in msg).toBe(true);
    expect('ts' in msg).toBe(true);
    expect('ingested_at' in msg).toBe(true);
    expect('content' in msg).toBe(true);
  });
});

describe('SqliteSessionRepo', () => {
  // Test 14: upsert new session → findById returns it with first_seen_at === last_seen_at === now
  it('upsert new session → findById returns correct data', () => {
    sessRepo.upsert({ id: 'sess1', name: 'My Session', now: 5000 });
    const sess = sessRepo.findById('sess1');
    expect(sess).not.toBeNull();
    expect(sess!.id).toBe('sess1');
    expect(sess!.name).toBe('My Session');
    expect(sess!.first_seen_at).toBe(5000);
    expect(sess!.last_seen_at).toBe(5000);
  });

  // Test 15: upsert again with later now and different name → first_seen_at unchanged, last_seen_at updated, name updated
  it('second upsert updates last_seen_at and name but not first_seen_at', () => {
    sessRepo.upsert({ id: 'sess1', name: 'Original', now: 1000 });
    sessRepo.upsert({ id: 'sess1', name: 'Updated', now: 9999 });
    const sess = sessRepo.findById('sess1');
    expect(sess).not.toBeNull();
    expect(sess!.first_seen_at).toBe(1000);
    expect(sess!.last_seen_at).toBe(9999);
    expect(sess!.name).toBe('Updated');
  });

  // Test 16: findById for unknown id → returns null
  it('findById unknown id returns null', () => {
    const result = sessRepo.findById('does-not-exist');
    expect(result).toBeNull();
  });
});
