import { describe, expect, it, mock } from 'bun:test';
import { handleStatuslinePost } from './statusline.js';
import { InMemoryCwdRegistry } from '../ws/cwd-registry.js';
import type { Hub } from '../ws/hub.js';

function makeDeps(overrides: Partial<{ cwdRegistry: InMemoryCwdRegistry; broadcastSpy: ReturnType<typeof mock> }> = {}) {
  const cwdRegistry = overrides.cwdRegistry ?? new InMemoryCwdRegistry();
  const broadcastSpy = overrides.broadcastSpy ?? mock(() => undefined);
  const hub: Hub = {
    add: () => undefined,
    tryAdd: () => ({ ok: true }),
    remove: () => undefined,
    broadcast: broadcastSpy,
    get size() { return 0; },
  };
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return { hub, cwdRegistry, logger, broadcastSpy };
}

const LOOPBACK_URL = 'http://127.0.0.1:8788/internal/statusline';
const PUBLIC_URL = 'http://example.com/internal/statusline';

describe('POST /internal/statusline', () => {
  it('rejects non-POST methods with 405', async () => {
    const deps = makeDeps();
    const res = await handleStatuslinePost(new Request(LOOPBACK_URL, { method: 'GET' }), deps);
    expect(res.status).toBe(405);
  });

  it('rejects non-loopback origin with 403', async () => {
    const deps = makeDeps();
    const res = await handleStatuslinePost(
      new Request(PUBLIC_URL, { method: 'POST', body: '{}' }),
      deps,
    );
    expect(res.status).toBe(403);
    expect(deps.broadcastSpy).not.toHaveBeenCalled();
  });

  it('returns 400 on invalid JSON', async () => {
    const deps = makeDeps();
    const res = await handleStatuslinePost(
      new Request(LOOPBACK_URL, { method: 'POST', body: 'not json' }),
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when cwd is missing', async () => {
    const deps = makeDeps();
    const res = await handleStatuslinePost(
      new Request(LOOPBACK_URL, {
        method: 'POST',
        body: JSON.stringify({ model: { display_name: 'Opus' } }),
      }),
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 with matched:false when cwd is unknown', async () => {
    const deps = makeDeps();
    const res = await handleStatuslinePost(
      new Request(LOOPBACK_URL, {
        method: 'POST',
        body: JSON.stringify({ cwd: '/unknown' }),
      }),
      deps,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, matched: false });
    expect(deps.broadcastSpy).not.toHaveBeenCalled();
  });

  it('broadcasts statusline frame when cwd resolves to a registered session', async () => {
    const cwdRegistry = new InMemoryCwdRegistry();
    cwdRegistry.set('/work/alpha', 'sess-alpha');
    const deps = makeDeps({ cwdRegistry });

    const res = await handleStatuslinePost(
      new Request(LOOPBACK_URL, {
        method: 'POST',
        body: JSON.stringify({
          cwd: '/work/alpha',
          model: { display_name: 'Opus 4.7 (1M context)', id: 'claude-opus-4-7' },
          context_window: { used_percentage: 5.4 },
          rate_limits: {
            five_hour: { used_percentage: 98 },
            seven_day: { used_percentage: 44, reset_at: '2026-04-20T12:00:00' },
          },
        }),
      }),
      deps,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; matched: boolean; session_id: string };
    expect(body.ok).toBe(true);
    expect(body.matched).toBe(true);
    expect(body.session_id).toBe('sess-alpha');

    expect(deps.broadcastSpy).toHaveBeenCalledTimes(1);
    const call = deps.broadcastSpy.mock.calls[0]![0] as {
      type: string;
      session_id: string;
      statusline: {
        model: string;
        ctx_pct: number;
        five_h_pct: number;
        seven_d_pct: number;
        seven_d_reset_at: string;
      };
    };
    expect(call.type).toBe('statusline');
    expect(call.session_id).toBe('sess-alpha');
    expect(call.statusline.model).toBe('Opus 4.7 (1M context)');
    expect(call.statusline.ctx_pct).toBe(5.4);
    expect(call.statusline.five_h_pct).toBe(98);
    expect(call.statusline.seven_d_pct).toBe(44);
    expect(call.statusline.seven_d_reset_at).toBe('2026-04-20T12:00:00');
  });

  it('accepts workspace.current_dir as a fallback for cwd', async () => {
    const cwdRegistry = new InMemoryCwdRegistry();
    cwdRegistry.set('/work/beta', 'sess-beta');
    const deps = makeDeps({ cwdRegistry });

    const res = await handleStatuslinePost(
      new Request(LOOPBACK_URL, {
        method: 'POST',
        body: JSON.stringify({
          workspace: { current_dir: '/work/beta' },
          model: { display_name: 'Sonnet' },
        }),
      }),
      deps,
    );

    expect(res.status).toBe(200);
    expect(deps.broadcastSpy).toHaveBeenCalledTimes(1);
  });

  it('tolerates partial statusline payloads (missing rate_limits/context_window)', async () => {
    const cwdRegistry = new InMemoryCwdRegistry();
    cwdRegistry.set('/work/gamma', 'sess-gamma');
    const deps = makeDeps({ cwdRegistry });

    const res = await handleStatuslinePost(
      new Request(LOOPBACK_URL, {
        method: 'POST',
        body: JSON.stringify({ cwd: '/work/gamma' }),
      }),
      deps,
    );

    expect(res.status).toBe(200);
    expect(deps.broadcastSpy).toHaveBeenCalledTimes(1);
    const call = deps.broadcastSpy.mock.calls[0]![0] as {
      statusline: { model: string | null; ctx_pct: number | null; five_h_pct: number | null; seven_d_pct: number | null; seven_d_reset_at: string | null };
    };
    expect(call.statusline.model).toBeNull();
    expect(call.statusline.ctx_pct).toBeNull();
    expect(call.statusline.five_h_pct).toBeNull();
    expect(call.statusline.seven_d_pct).toBeNull();
    expect(call.statusline.seven_d_reset_at).toBeNull();
  });
});
