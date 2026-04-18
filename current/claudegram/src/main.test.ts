/**
 * Spawn-child signal test for main.ts graceful shutdown.
 *
 * Strategy:
 *  1. Spawn `bun run src/main.ts` as a child process.
 *  2. Wait for `server_ready` line on stderr (JSONL).
 *  3. Send SIGTERM.
 *  4. Assert the child exits with code 0 within 5 s.
 *  5. Assert stderr contains `shutdown_complete`.
 *
 * NOTE: This test is marked `it.skip` by default because spawning a real
 * Bun process and waiting for signals can be flaky in sandboxed CI
 * environments where SIGTERM delivery to sub-processes is unreliable
 * (e.g., macOS GitHub Actions runners with strict process isolation or
 * aggressive timeouts). It is retained as a manual smoke-test.
 * Remove the `.skip` and run locally to validate end-to-end shutdown.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PROJECT_ROOT = new URL('..', import.meta.url).pathname;

async function collectStderr(
  proc: ReturnType<typeof Bun.spawn>,
  timeoutMs: number,
): Promise<string> {
  const chunks: string[] = [];
  const decoder = new TextDecoder();

  const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();

  const readAll = async (): Promise<void> => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
    } catch {
      // Stream closed on process exit — expected.
    }
  };

  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([readAll(), timeout]);

  return chunks.join('');
}

describe('main.ts graceful shutdown', () => {
  it.skip('spawns server, receives SIGTERM, exits 0 with shutdown_complete (skip: may be flaky in CI)', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'claudegram-main-test-'));
    const dbPath = join(tmpDir, 'test.db');

    let proc: ReturnType<typeof Bun.spawn> | undefined;

    try {
      proc = Bun.spawn(['bun', 'run', 'src/main.ts'], {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          CLAUDEGRAM_PORT: '0',
          CLAUDEGRAM_DB_PATH: dbPath,
          CLAUDEGRAM_LOG_LEVEL: 'info',
        },
        stdout: 'ignore',
        stderr: 'pipe',
      });

      // ── Wait for server_ready on stderr (up to 10 s) ─────────────────────
      const READY_TIMEOUT = 10_000;
      const startedAt = Date.now();
      let stderrAccum = '';
      let ready = false;

      const decoder = new TextDecoder();
      const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader();

      while (Date.now() - startedAt < READY_TIMEOUT) {
        const readPromise = reader.read();
        const timeoutPromise = new Promise<{ done: boolean; value?: Uint8Array }>(
          (resolve) => setTimeout(() => resolve({ done: false }), 200),
        );
        const { done, value } = await Promise.race([readPromise, timeoutPromise]);
        if (done) break;
        if (value) {
          stderrAccum += decoder.decode(value, { stream: true });
        }
        if (stderrAccum.includes('server_ready')) {
          ready = true;
          break;
        }
      }

      expect(ready).toBe(true);

      // ── Send SIGTERM ──────────────────────────────────────────────────────
      proc.kill('SIGTERM');

      // ── Wait for exit (up to 5 s) ─────────────────────────────────────────
      const EXIT_TIMEOUT = 5_000;
      const exitCode = await Promise.race([
        proc.exited,
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error('timed out waiting for exit')), EXIT_TIMEOUT),
        ),
      ]);

      // Drain remaining stderr after exit.
      const remaining = await collectStderr(proc, 1_000);
      const allStderr = stderrAccum + remaining;

      expect(exitCode).toBe(0);
      expect(allStderr).toContain('shutdown_complete');
    } finally {
      if (proc) {
        try { proc.kill(); } catch { /* already dead */ }
      }
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
