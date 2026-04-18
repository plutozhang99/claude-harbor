import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { openDatabase, closeDatabase } from './db/client.js';
import type { Database } from './db/client.js';
import { createServer } from './server.js';
import type { RunningServer } from './server.js';
import type { Config } from './config.js';
import { createLogger } from './logger.js';

// Use a port range that avoids collision with common services.
const BASE_PORT = 38000 + (process.pid % 1000);

function makeConfig(port: number): Config {
  // Bypass Zod to allow port=0-style ephemeral. Tests use explicit high ports.
  return { port, db_path: ':memory:', log_level: 'error' };
}

const logger = createLogger({ level: 'error' });

let db: Database;
let server: RunningServer;
let portCounter = 0;

function nextPort(): number {
  return BASE_PORT + portCounter++;
}

beforeEach(() => {
  db = openDatabase(':memory:');
});

afterEach(async () => {
  if (server) {
    await server.stop(true);
  }
  closeDatabase(db);
});

describe('createServer', () => {
  it('returns object with port > 0 and a stop function', () => {
    server = createServer({ config: makeConfig(nextPort()), db, logger });
    expect(server.port).toBeGreaterThan(0);
    expect(typeof server.stop).toBe('function');
  });

  it('GET /nope returns 404 with JSON body', async () => {
    server = createServer({ config: makeConfig(nextPort()), db, logger });
    const res = await fetch(`http://localhost:${server.port}/nope`, {
      signal: AbortSignal.timeout(2000),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'not found' });
  });

  it('stop() stops the server — subsequent fetch fails', async () => {
    const s = createServer({ config: makeConfig(nextPort()), db, logger });
    const port = s.port;
    await s.stop(true);
    // server is left null so afterEach's stop() is skipped for this case.
    server = null as unknown as RunningServer;

    let threw = false;
    try {
      await fetch(`http://localhost:${port}/nope`, {
        signal: AbortSignal.timeout(1000),
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('migrate runs before Bun.serve — tables exist immediately after createServer', () => {
    server = createServer({ config: makeConfig(nextPort()), db, logger });
    type Row = { name: string };
    const tables = db
      .query<Row, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all();
    const names = tables.map((r) => r.name);
    expect(names).toContain('messages');
    expect(names).toContain('sessions');
  });

  it('tables exist on the same DB instance passed to createServer (invariant 2)', () => {
    server = createServer({ config: makeConfig(nextPort()), db, logger });
    type Row = { cnt: number };
    const row = db
      .query<Row, []>(
        "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name IN ('messages','sessions')"
      )
      .get();
    expect(row?.cnt).toBe(2);
  });
});
