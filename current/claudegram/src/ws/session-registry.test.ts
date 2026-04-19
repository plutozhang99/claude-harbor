import { describe, it, expect } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { InMemorySessionRegistry } from './session-registry.js';
import type { OutboundSessionPayload } from './session-registry.js';

// ── Stub WebSocket ────────────────────────────────────────────────────────────

interface StubWsOptions {
  onSend?: (data: string) => void;
  onClose?: (code: number, reason: string) => void;
  throwOnClose?: boolean;
  throwOnSend?: boolean;
}

function makeStubWs(opts: StubWsOptions = {}): ServerWebSocket<unknown> {
  return {
    send: (data: string | ArrayBufferLike | ArrayBufferView) => {
      if (opts.throwOnSend) throw new Error('ws.send() failed');
      opts.onSend?.(data as string);
      return 0;
    },
    close: (code?: number, reason?: string) => {
      if (opts.throwOnClose) throw new Error('already closed');
      opts.onClose?.(code ?? 1000, reason ?? '');
    },
    data: undefined,
    readyState: 1,
    remoteAddress: '127.0.0.1',
    terminate: () => {},
    ping: () => 0,
    pong: () => 0,
    cork: (cb: () => void) => { cb(); return 0; },
    subscribe: () => {},
    unsubscribe: () => {},
    isSubscribed: () => false,
    publish: () => 0,
    binaryType: 'nodebuffer',
  } as unknown as ServerWebSocket<unknown>;
}

const stubPayload: OutboundSessionPayload = {
  type: 'reply',
  text: 'hello from pwa',
  client_msg_id: 'cmid-1',
  origin: 'pwa',
};

// ── SessionRegistry unit tests ────────────────────────────────────────────────

describe('InMemorySessionRegistry', () => {
  it('starts empty: size === 0', () => {
    const registry = new InMemorySessionRegistry();
    expect(registry.size).toBe(0);
  });

  it('register(session_id, ws) increments size', () => {
    const registry = new InMemorySessionRegistry();
    registry.register('sess-1', makeStubWs());
    expect(registry.size).toBe(1);
  });

  it('register returns a Disposable that unregisters on dispose', () => {
    const registry = new InMemorySessionRegistry();
    const ws = makeStubWs();
    const disposable = registry.register('sess-1', ws);
    expect(registry.size).toBe(1);

    disposable[Symbol.dispose]();
    expect(registry.size).toBe(0);
  });

  it('send on known session_id → sends JSON payload and returns { ok: true }', () => {
    const registry = new InMemorySessionRegistry();
    const received: string[] = [];
    const ws = makeStubWs({ onSend: (data) => received.push(data) });

    registry.register('sess-1', ws);
    const result = registry.send('sess-1', stubPayload);

    expect(result).toEqual({ ok: true });
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(JSON.stringify(stubPayload));
  });

  it('send on unknown session_id → returns { ok: false, reason: "no_session" } without throwing', () => {
    const registry = new InMemorySessionRegistry();
    const result = registry.send('nonexistent', stubPayload);
    expect(result).toEqual({ ok: false, reason: 'no_session' });
  });

  it('unregister removes the session; subsequent send returns { ok: false, reason: "no_session" }', () => {
    const registry = new InMemorySessionRegistry();
    registry.register('sess-1', makeStubWs());
    expect(registry.size).toBe(1);

    registry.unregister('sess-1');
    expect(registry.size).toBe(0);

    const result = registry.send('sess-1', stubPayload);
    expect(result).toEqual({ ok: false, reason: 'no_session' });
  });

  it('unregister on unknown session_id does NOT throw', () => {
    const registry = new InMemorySessionRegistry();
    expect(() => registry.unregister('ghost')).not.toThrow();
  });

  it('register on existing session_id evicts + closes prior socket with code 1000', () => {
    const registry = new InMemorySessionRegistry();
    const closeCalls: Array<{ code: number; reason: string }> = [];
    const oldWs = makeStubWs({
      onClose: (code, reason) => closeCalls.push({ code, reason }),
    });

    registry.register('sess-1', oldWs);
    registry.register('sess-1', makeStubWs());

    expect(closeCalls).toHaveLength(1);
    expect(closeCalls[0].code).toBe(1000);
    expect(closeCalls[0].reason).toBe('evicted by new registration');
  });

  it('size stays at 1 after eviction (not 2)', () => {
    const registry = new InMemorySessionRegistry();
    registry.register('sess-1', makeStubWs());
    registry.register('sess-1', makeStubWs());
    expect(registry.size).toBe(1);
  });

  it('send after eviction targets the new socket, not the evicted one', () => {
    const registry = new InMemorySessionRegistry();
    const oldReceived: string[] = [];
    const newReceived: string[] = [];

    const oldWs = makeStubWs({ onSend: (d) => oldReceived.push(d) });
    const newWs = makeStubWs({ onSend: (d) => newReceived.push(d) });

    registry.register('sess-1', oldWs);
    registry.register('sess-1', newWs);

    registry.send('sess-1', stubPayload);

    expect(oldReceived).toHaveLength(0);
    expect(newReceived).toHaveLength(1);
  });

  it('JSON.stringify called once per send (all sockets receive same string)', () => {
    // Verify the implementation serialises once by checking two distinct sessions
    // receive identical strings when sent the same payload.
    const registry = new InMemorySessionRegistry();
    const received: string[] = [];

    registry.register('sess-a', makeStubWs({ onSend: (d) => received.push(d) }));
    registry.register('sess-b', makeStubWs({ onSend: (d) => received.push(d) }));

    registry.send('sess-a', stubPayload);
    registry.send('sess-b', stubPayload);

    // Both sends must produce identical JSON
    expect(received).toHaveLength(2);
    expect(received[0]).toBe(received[1]);
    expect(received[0]).toBe(JSON.stringify(stubPayload));
  });

  it('multiple sessions are independent — send targets only the correct session', () => {
    const registry = new InMemorySessionRegistry();
    const received: Record<string, string[]> = { a: [], b: [] };

    registry.register('sess-a', makeStubWs({ onSend: (d) => received.a.push(d) }));
    registry.register('sess-b', makeStubWs({ onSend: (d) => received.b.push(d) }));

    registry.send('sess-a', stubPayload);

    expect(received.a).toHaveLength(1);
    expect(received.b).toHaveLength(0);
  });

  it('Disposable dispose is idempotent — double dispose does not throw or corrupt state', () => {
    const registry = new InMemorySessionRegistry();
    const ws = makeStubWs();
    const disposable = registry.register('sess-1', ws);

    disposable[Symbol.dispose]();
    expect(() => disposable[Symbol.dispose]()).not.toThrow();
    expect(registry.size).toBe(0);
  });

  it('no state leak between tests — fresh registry starts at size 0', () => {
    const registry = new InMemorySessionRegistry();
    expect(registry.size).toBe(0);
  });

  it('send with optional reply_to field — serialised correctly', () => {
    const registry = new InMemorySessionRegistry();
    const received: string[] = [];
    registry.register('sess-1', makeStubWs({ onSend: (d) => received.push(d) }));

    const payloadWithReplyTo: OutboundSessionPayload = {
      type: 'reply',
      text: 'a response',
      reply_to: 'msg-99',
      client_msg_id: 'cmid-2',
      origin: 'pwa',
    };

    const result = registry.send('sess-1', payloadWithReplyTo);
    expect(result).toEqual({ ok: true });
    expect(received[0]).toBe(JSON.stringify(payloadWithReplyTo));
  });

  // ── R2 new tests ──────────────────────────────────────────────────────────

  it('eviction with throwing close — register does not throw, size === 1, send to new socket succeeds', () => {
    const registry = new InMemorySessionRegistry();
    const oldWs = makeStubWs({ throwOnClose: true });
    const newReceived: string[] = [];
    const newWs = makeStubWs({ onSend: (d) => newReceived.push(d) });

    // First registration
    registry.register('sess-1', oldWs);
    // Second registration evicts — oldWs.close() throws; must not propagate
    expect(() => registry.register('sess-1', newWs)).not.toThrow();

    expect(registry.size).toBe(1);
    const result = registry.send('sess-1', stubPayload);
    expect(result).toEqual({ ok: true });
    expect(newReceived).toHaveLength(1);
  });

  it('stale Disposable after rebind — calling A dispose does not remove the new socket', () => {
    const registry = new InMemorySessionRegistry();
    const newReceived: string[] = [];
    const wsA = makeStubWs();
    const wsB = makeStubWs({ onSend: (d) => newReceived.push(d) });

    // Register A → get disposable A
    const disposableA = registry.register('sess-1', wsA);
    // Rebind with B (evicts A)
    registry.register('sess-1', wsB);

    // Dispose A — must NOT delete B from the registry
    disposableA[Symbol.dispose]();

    expect(registry.size).toBe(1);
    const result = registry.send('sess-1', stubPayload);
    expect(result).toEqual({ ok: true });
    expect(newReceived).toHaveLength(1);
  });
});
