import { describe, expect, it } from 'bun:test';
import { InMemoryCwdRegistry } from './cwd-registry.js';

describe('InMemoryCwdRegistry', () => {
  it('set → lookup returns the session_id', () => {
    const r = new InMemoryCwdRegistry();
    r.set('/work/alpha', 'sess-alpha');
    expect(r.lookup('/work/alpha')).toBe('sess-alpha');
  });

  it('lookup returns undefined for unknown cwd', () => {
    const r = new InMemoryCwdRegistry();
    expect(r.lookup('/nope')).toBeUndefined();
  });

  it('set on existing cwd replaces the mapping (last-writer-wins)', () => {
    const r = new InMemoryCwdRegistry();
    r.set('/work/alpha', 'sess-old');
    r.set('/work/alpha', 'sess-new');
    expect(r.lookup('/work/alpha')).toBe('sess-new');
    expect(r.size).toBe(1);
  });

  it('clearBySession drops all cwds pointing at the given session_id', () => {
    const r = new InMemoryCwdRegistry();
    r.set('/work/alpha', 'sess-alpha');
    r.set('/work/beta', 'sess-beta');
    r.set('/work/gamma', 'sess-alpha'); // two cwds → same session (edge case)

    r.clearBySession('sess-alpha');

    expect(r.lookup('/work/alpha')).toBeUndefined();
    expect(r.lookup('/work/gamma')).toBeUndefined();
    expect(r.lookup('/work/beta')).toBe('sess-beta');
    expect(r.size).toBe(1);
  });

  it('clearBySession is a no-op for unknown session_id', () => {
    const r = new InMemoryCwdRegistry();
    r.set('/work/alpha', 'sess-alpha');
    r.clearBySession('sess-missing');
    expect(r.lookup('/work/alpha')).toBe('sess-alpha');
    expect(r.size).toBe(1);
  });

  it('size tracks number of active cwd mappings', () => {
    const r = new InMemoryCwdRegistry();
    expect(r.size).toBe(0);
    r.set('/a', 's1');
    r.set('/b', 's2');
    expect(r.size).toBe(2);
    r.clearBySession('s1');
    expect(r.size).toBe(1);
  });
});
