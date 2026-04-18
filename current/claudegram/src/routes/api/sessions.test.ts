import { describe, it, expect } from 'bun:test';
import type { SessionRepo, SessionListItem } from '../../repo/types.js';
import type { Logger } from '../../logger.js';
import { handleApiSessions } from './sessions.js';

async function json(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>;
}

function makeReq(method: string, path = '/api/sessions'): Request {
  return new Request(`http://localhost${path}`, { method });
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const emptyRepo = {
  sessRepo: {
    upsert: () => {},
    findById: () => null,
    findAll: () => [],
  } satisfies SessionRepo,
  logger: noopLogger,
};

const twoItemRepo = {
  sessRepo: {
    upsert: () => {},
    findById: () => null,
    findAll: (): ReadonlyArray<SessionListItem> => [
      {
        id: 'sess-1',
        name: 'Session One',
        first_seen_at: 1000,
        last_seen_at: 2000,
        status: 'active',
        last_read_at: 1500,
        unread_count: 3,
      },
      {
        id: 'sess-2',
        name: 'Session Two',
        first_seen_at: 3000,
        last_seen_at: 4000,
        status: 'ended',
        last_read_at: 3500,
        unread_count: 0,
      },
    ],
  } satisfies SessionRepo,
  logger: noopLogger,
};

describe('handleApiSessions', () => {
  it('GET with empty findAll → 200 { ok: true, sessions: [] }', async () => {
    const res = handleApiSessions(makeReq('GET'), emptyRepo);
    const r = res instanceof Promise ? await res : res;
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    const body = await json(r);
    expect(body).toEqual({ ok: true, sessions: [] });
  });

  it('GET with 2 items → returns both in order', async () => {
    const res = handleApiSessions(makeReq('GET'), twoItemRepo);
    const r = res instanceof Promise ? await res : res;
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body.ok).toBe(true);
    const sessions = body.sessions as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('sess-1');
    expect(sessions[1].id).toBe('sess-2');
  });

  it('POST → 405 method not allowed', async () => {
    const res = handleApiSessions(makeReq('POST'), emptyRepo);
    const r = res instanceof Promise ? await res : res;
    expect(r.status).toBe(405);
    const body = await json(r);
    expect(body).toEqual({ ok: false, error: 'method not allowed' });
  });

  it('returns 500 when repo throws', async () => {
    const errors: Array<[string, Record<string, unknown>]> = [];
    const errorLogger: Logger = {
      ...noopLogger,
      error: (msg, fields) => { errors.push([msg, fields ?? {}]); },
    };

    const throwingRepo = {
      sessRepo: {
        upsert: () => {},
        findById: () => null,
        findAll: (): ReadonlyArray<SessionListItem> => { throw new Error('DB exploded'); },
      } satisfies SessionRepo,
      logger: errorLogger,
    };

    const res = handleApiSessions(makeReq('GET'), throwingRepo);
    const r = res instanceof Promise ? await res : res;
    expect(r.status).toBe(500);
    const body = await json(r);
    expect(body).toEqual({ ok: false, error: 'internal error' });
    expect(errors.length).toBe(1);
    expect(errors[0]![0]).toBe('sessions_list_failed');
  });
});
