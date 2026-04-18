import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

const webJsDir = path.resolve(process.cwd(), 'web/js');
const modules = ['ws.js', 'store.js', 'render.js', 'notify.js', 'index.js'];

describe('PWA JS modules parse cleanly', () => {
  for (const mod of modules) {
    it(`${mod} is valid ES2022 module syntax`, () => {
      const source = fs.readFileSync(path.join(webJsDir, mod), 'utf-8');
      const transpiler = new Bun.Transpiler({ loader: 'js' });
      expect(() => transpiler.scan(source)).not.toThrow();
      // Scan also validates the source parses without error
      const scanResult = transpiler.scan(source);
      expect(scanResult).toBeDefined();
    });
  }

  it('index.js imports all sibling modules', () => {
    const src = fs.readFileSync(path.join(webJsDir, 'index.js'), 'utf-8');
    expect(src).toContain("from './ws.js'");
    expect(src).toContain("from './store.js'");
    expect(src).toContain("from './render.js'");
    expect(src).toContain("from './notify.js'");
  });
});
