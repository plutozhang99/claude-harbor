/**
 * P2.5 end-to-end smoke test. Exercises the full P2 stack without
 * spawning Flutter: a fixture build/web/ is staged on disk; we verify
 * static serve behavior (HTML+CSP, JS MIME, SPA fallthrough,
 * `/api/*` non-fallthrough, `HARBOR_FRONTEND_ROOT` env override) and
 * the live round-trip (session-start → WS subscribe →
 * user-prompt-submit + /channel/reply both fan out message.created).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { start, type HarborHandle } from "../src/index.ts";
import { __resetCorrelation } from "../src/correlate.ts";
import { __resetBus } from "../src/event-bus.ts";

interface Handle {
  port: number;
  harbor: HarborHandle;
  stop(): void;
}

function bootServer(buildDir: string): Handle {
  const h = start({
    port: 0,
    dbPath: ":memory:",
    frontendBuildDir: buildDir,
  });
  const port = h.server.port;
  if (typeof port !== "number") throw new Error("server port missing");
  return { port, harbor: h, stop: () => h.stop() };
}

function stageBundle(root: string): void {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(
    join(root, "index.html"),
    "<!doctype html><html><head><title>harbor-fixture</title></head><body></body></html>",
  );
  writeFileSync(
    join(root, "main.dart.js"),
    "// fixture — not real Flutter output\nconsole.log('ok');\n",
  );
  writeFileSync(
    join(root, "assets", "NOTICES"),
    "fixture notices\n",
  );
}

let handle: Handle;
let scratch: string;

beforeEach(() => {
  __resetCorrelation();
  __resetBus();
  scratch = mkdtempSync(join(tmpdir(), "harbor-p2e2e-"));
  stageBundle(scratch);
  handle = bootServer(scratch);
});

afterEach(() => {
  if (handle) handle.stop();
  __resetCorrelation();
  __resetBus();
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function baseUrl(): string {
  return `http://localhost:${handle.port}`;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function openSubWs(): WebSocket {
  return new WebSocket(`ws://localhost:${handle.port}/subscribe`);
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e) => reject(e), { once: true });
  });
}

function recorder(ws: WebSocket) {
  const buf: string[] = [];
  let resolveNext: (() => void) | null = null;
  const onMsg = (ev: MessageEvent) => {
    buf.push(typeof ev.data === "string" ? ev.data : String(ev.data));
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };
  ws.addEventListener("message", onMsg);
  return {
    async drain(n: number, timeoutMs = 3000): Promise<string[]> {
      const deadline = Date.now() + timeoutMs;
      while (buf.length < n) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(`drain: expected ${n}, got ${buf.length}`);
        }
        await new Promise<void>((res, rej) => {
          resolveNext = res;
          setTimeout(() => rej(new Error("drain timeout")), remaining).unref?.();
        }).catch(() => {});
      }
      return buf.splice(0, n);
    },
    stop() {
      ws.removeEventListener("message", onMsg);
    },
  };
}

describe("P2.5 static bundle served end-to-end", () => {
  test("GET / returns fixture index.html with CSP + nosniff", async () => {
    const res = await fetch(`${baseUrl()}/`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/html");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    const body = await res.text();
    expect(body).toContain("harbor-fixture");
  });

  test("GET /main.dart.js returns JS MIME", async () => {
    const res = await fetch(`${baseUrl()}/main.dart.js`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("application/javascript");
    // Non-HTML assets still get nosniff but no CSP.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  test("GET /assets/NOTICES returns the nested asset", async () => {
    const res = await fetch(`${baseUrl()}/assets/NOTICES`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("fixture notices");
  });

  test("GET /session/abc-xyz (Flutter SPA route) returns index.html", async () => {
    const res = await fetch(`${baseUrl()}/session/abc-xyz`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("harbor-fixture");
  });

  test("GET /api/does-not-exist is 404 (API paths do not fall through)", async () => {
    const res = await fetch(`${baseUrl()}/api/does-not-exist`);
    expect(res.status).toBe(404);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).not.toContain("text/html");
  });

  test("GET /health still wins over static", async () => {
    const res = await fetch(`${baseUrl()}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("GET /hooks/does-not-exist returns 404 (not index.html)", async () => {
    const res = await fetch(`${baseUrl()}/hooks/does-not-exist`);
    expect(res.status).toBe(404);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).not.toContain("text/html");
  });

  test("GET /admin/does-not-exist returns 404 (not index.html)", async () => {
    const res = await fetch(`${baseUrl()}/admin/does-not-exist`);
    expect(res.status).toBe(404);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).not.toContain("text/html");
  });

  test("GET /subscribe-fake falls through to SPA index.html (not blocked by /subscribe prefix)", async () => {
    // isReservedApiPath matches "/subscribe" only as an exact match or
    // "/subscribe/<something>" — it does NOT match "/subscribe-fake" because
    // the check is `path === p || path.startsWith(p + "/")`.
    // Therefore "/subscribe-fake" is NOT a reserved API path and SHOULD fall
    // through to the SPA index.html.
    const res = await fetch(`${baseUrl()}/subscribe-fake`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("harbor-fixture");
  });
});

describe("P2.5 live round-trip: session + WS + messages", () => {
  test("user-prompt-submit and /channel/reply both fan out message.created", async () => {
    // 1. Seed a session.
    const startRes = await postJson("/hooks/session-start", {
      session_id: "e2e-session",
      cwd: "/tmp/e2e-cwd",
      pid: 4242,
      ts: Date.now(),
    });
    expect(startRes.status).toBe(200);
    const { channel_token } = (await startRes.json()) as {
      channel_token: string;
    };
    expect(channel_token.length).toBeGreaterThan(0);

    // 2. Open a subscriber AFTER session-start so the first event we drain
    //    (post-subscribed) is the replayed session.created snapshot.
    const ws = openSubWs();
    const rec = recorder(ws);
    await waitOpen(ws);
    const [subscribedRaw, replayRaw] = await rec.drain(2);
    expect((JSON.parse(subscribedRaw!) as { type: string }).type).toBe(
      "subscribed",
    );
    const replay = JSON.parse(replayRaw!) as {
      type: string;
      session: Record<string, unknown>;
    };
    expect(replay.type).toBe("session.created");
    // Confirm channel_token never leaks over /subscribe (C1 guard).
    expect("channel_token" in replay.session).toBe(false);

    // 3. Inbound: user-prompt-submit → message.created.
    const inboundPending = rec.drain(1);
    const upRes = await postJson("/hooks/user-prompt-submit", {
      session_id: "e2e-session",
      prompt: "hello from the user",
    });
    expect(upRes.status).toBe(204);
    const [inboundRaw] = await inboundPending;
    const inbound = JSON.parse(inboundRaw!) as {
      type: string;
      session_id: string;
      message: { direction: string; content: string };
    };
    expect(inbound.type).toBe("message.created");
    expect(inbound.session_id).toBe("e2e-session");
    expect(inbound.message.direction).toBe("inbound");
    expect(inbound.message.content).toBe("hello from the user");

    // 4. Outbound: /channel/reply → message.created.
    const outboundPending = rec.drain(1);
    const replyRes = await postJson("/channel/reply", {
      channel_token,
      content: "hello from Claude",
    });
    expect(replyRes.status).toBe(200);
    const [outboundRaw] = await outboundPending;
    const outbound = JSON.parse(outboundRaw!) as {
      type: string;
      session_id: string;
      message: { direction: string; content: string };
    };
    expect(outbound.type).toBe("message.created");
    expect(outbound.session_id).toBe("e2e-session");
    expect(outbound.message.direction).toBe("outbound");
    expect(outbound.message.content).toBe("hello from Claude");

    rec.stop();
    ws.close();
  });
});

describe("P2.5 HARBOR_FRONTEND_ROOT env override", () => {
  test("env var is honored when no explicit buildDir is passed", async () => {
    handle.stop();
    // Fresh scratch + env var.
    const envRoot = mkdtempSync(join(tmpdir(), "harbor-env-root-"));
    try {
      stageBundle(envRoot);
      const prev = process.env.HARBOR_FRONTEND_ROOT;
      process.env.HARBOR_FRONTEND_ROOT = envRoot;
      try {
        const h = start({ port: 0, dbPath: ":memory:" });
        const port = h.server.port;
        if (typeof port !== "number") throw new Error("port missing");
        try {
          const res = await fetch(`http://localhost:${port}/`);
          expect(res.status).toBe(200);
          const body = await res.text();
          expect(body).toContain("harbor-fixture");
        } finally {
          h.stop();
        }
      } finally {
        if (prev === undefined) delete process.env.HARBOR_FRONTEND_ROOT;
        else process.env.HARBOR_FRONTEND_ROOT = prev;
      }
    } finally {
      try {
        rmSync(envRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
      // Re-boot a handle so afterEach can stop it.
      handle = bootServer(scratch);
    }
  });
});
