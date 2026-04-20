/**
 * P1.3 tests — install-time account_hint capture.
 *
 * Covers:
 *   - Db.setAccountHint + getAccountHint roundtrip (including null clear).
 *   - SessionStart AFTER setAccountHint → sessions.account_hint populated.
 *   - SessionStart BEFORE setAccountHint → sessions.account_hint NULL.
 *   - Overwriting account_hint later does NOT mutate prior sessions
 *     (immutable history).
 *   - /admin/account-hint auth gate: token-mode without header → 401.
 *   - /admin/account-hint payload size cap (>512 chars) → 400.
 *   - /admin/account-hint strips control chars before persisting.
 *   - /admin/account-hint empty string → stored as NULL.
 *   - /admin/account-hint non-string/non-null values → 400.
 *   - /admin/account-hint malformed JSON → 400.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { start, type HarborHandle } from "../src/index.ts";
import { __resetCorrelation } from "../src/correlate.ts";

interface Handle {
  port: number;
  harbor: HarborHandle;
  stop: () => void;
}

function bootServer(): Handle {
  const h = start({ port: 0, dbPath: ":memory:" });
  const port = h.server.port;
  if (typeof port !== "number") throw new Error("server port missing");
  return { port, harbor: h, stop: () => h.stop() };
}

let handle: Handle;
const ORIGINAL_TOKEN = process.env.HARBOR_ADMIN_TOKEN;

beforeEach(() => {
  __resetCorrelation();
});

afterEach(() => {
  if (handle) handle.stop();
  __resetCorrelation();
  if (ORIGINAL_TOKEN === undefined) delete process.env.HARBOR_ADMIN_TOKEN;
  else process.env.HARBOR_ADMIN_TOKEN = ORIGINAL_TOKEN;
});

function baseUrl(): string {
  return `http://localhost:${handle.port}`;
}

async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function postRaw(
  path: string,
  body: string,
  headers: Record<string, string> = { "content-type": "application/json" },
): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, { method: "POST", headers, body });
}

async function seedSession(
  session_id: string,
  cwd: string,
  pid: number,
): Promise<void> {
  const res = await postJson("/hooks/session-start", {
    session_id,
    cwd,
    pid,
    ts: Date.now(),
  });
  if (res.status !== 200) {
    throw new Error(`seed session failed: ${res.status}`);
  }
}

// ---- Db unit-ish tests -------------------------------------------------

describe("Db account_hint", () => {
  beforeEach(() => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
  });

  test("set + get roundtrip", () => {
    const db = handle.harbor.db;
    expect(db.getAccountHint()).toBeNull();
    db.setAccountHint("alice@example.com");
    expect(db.getAccountHint()).toBe("alice@example.com");
    db.setAccountHint("bob@example.com");
    expect(db.getAccountHint()).toBe("bob@example.com");
    db.setAccountHint(null);
    expect(db.getAccountHint()).toBeNull();
  });

  test("SessionStart AFTER setAccountHint populates sessions.account_hint", async () => {
    handle.harbor.db.setAccountHint("alice@example.com");
    await seedSession("sess-ah-1", "/tmp/ah1", 1001);
    const row = handle.harbor.db.getSessionById("sess-ah-1");
    expect(row?.account_hint).toBe("alice@example.com");
  });

  test("SessionStart BEFORE setAccountHint leaves account_hint NULL", async () => {
    await seedSession("sess-ah-2", "/tmp/ah2", 1002);
    const row = handle.harbor.db.getSessionById("sess-ah-2");
    expect(row?.account_hint).toBeNull();
  });

  test("overwriting account_hint does NOT mutate prior sessions", async () => {
    handle.harbor.db.setAccountHint("alice@example.com");
    await seedSession("sess-ah-3", "/tmp/ah3", 1003);
    handle.harbor.db.setAccountHint("bob@example.com");
    // New session created after the change picks up the new hint.
    await seedSession("sess-ah-4", "/tmp/ah4", 1004);
    // Clearing the hint again.
    handle.harbor.db.setAccountHint(null);
    await seedSession("sess-ah-5", "/tmp/ah5", 1005);

    expect(handle.harbor.db.getSessionById("sess-ah-3")?.account_hint).toBe(
      "alice@example.com",
    );
    expect(handle.harbor.db.getSessionById("sess-ah-4")?.account_hint).toBe(
      "bob@example.com",
    );
    expect(handle.harbor.db.getSessionById("sess-ah-5")?.account_hint).toBeNull();
  });
});

// ---- HTTP /admin/account-hint -----------------------------------------

describe("POST /admin/account-hint", () => {
  test("token-mode: missing header → 401", async () => {
    process.env.HARBOR_ADMIN_TOKEN = "secret-p13";
    handle = bootServer();
    const res = await postJson("/admin/account-hint", {
      account_hint: "alice@example.com",
    });
    expect(res.status).toBe(401);
    expect(handle.harbor.db.getAccountHint()).toBeNull();
  });

  test("token-mode: wrong header → 401; correct header → 204", async () => {
    process.env.HARBOR_ADMIN_TOKEN = "secret-p13";
    handle = bootServer();
    const wrong = await postJson(
      "/admin/account-hint",
      { account_hint: "alice@example.com" },
      { "x-harbor-admin-token": "nope" },
    );
    expect(wrong.status).toBe(401);
    const ok = await postJson(
      "/admin/account-hint",
      { account_hint: "alice@example.com" },
      { "x-harbor-admin-token": "secret-p13" },
    );
    expect(ok.status).toBe(204);
    expect(handle.harbor.db.getAccountHint()).toBe("alice@example.com");
  });

  test("loopback mode (no token): 204 + persists the hint", async () => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
    const res = await postJson("/admin/account-hint", {
      account_hint: "alice@example.com",
    });
    expect(res.status).toBe(204);
    expect(handle.harbor.db.getAccountHint()).toBe("alice@example.com");
  });

  test("explicit null clears the hint", async () => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
    handle.harbor.db.setAccountHint("pre-existing");
    const res = await postJson("/admin/account-hint", { account_hint: null });
    expect(res.status).toBe(204);
    expect(handle.harbor.db.getAccountHint()).toBeNull();
  });

  test("empty string stored as NULL", async () => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
    handle.harbor.db.setAccountHint("pre-existing");
    const res = await postJson("/admin/account-hint", { account_hint: "" });
    expect(res.status).toBe(204);
    expect(handle.harbor.db.getAccountHint()).toBeNull();
  });

  test("whitespace-only string stored as NULL", async () => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
    const res = await postJson("/admin/account-hint", {
      account_hint: "   \t\n  ",
    });
    expect(res.status).toBe(204);
    expect(handle.harbor.db.getAccountHint()).toBeNull();
  });

  test("control chars are stripped before persist", async () => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
    const res = await postJson("/admin/account-hint", {
      account_hint: "a\x00li\x07ce@example.com\x7f",
    });
    expect(res.status).toBe(204);
    expect(handle.harbor.db.getAccountHint()).toBe("alice@example.com");
  });

  test("payload size cap: > 512 chars → 400", async () => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
    const huge = "a".repeat(513);
    const res = await postJson("/admin/account-hint", { account_hint: huge });
    expect(res.status).toBe(400);
    expect(handle.harbor.db.getAccountHint()).toBeNull();
  });

  test("exactly 512 chars is accepted", async () => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
    const max = "a".repeat(512);
    const res = await postJson("/admin/account-hint", { account_hint: max });
    expect(res.status).toBe(204);
    expect(handle.harbor.db.getAccountHint()).toBe(max);
  });

  test("missing account_hint field → 400", async () => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
    const res = await postJson("/admin/account-hint", {});
    expect(res.status).toBe(400);
  });

  test("non-string, non-null value → 400", async () => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
    const res = await postJson("/admin/account-hint", { account_hint: 42 });
    expect(res.status).toBe(400);
  });

  test("malformed JSON → 400", async () => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
    const res = await postRaw("/admin/account-hint", "{not json");
    expect(res.status).toBe(400);
  });

  test("GET /admin/account-hint → 404 (only POST is routed)", async () => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
    const res = await fetch(`${baseUrl()}/admin/account-hint`, {
      method: "GET",
    });
    expect(res.status).toBe(404);
  });

  test("end-to-end: POST → new session picks up hint", async () => {
    delete process.env.HARBOR_ADMIN_TOKEN;
    handle = bootServer();
    await postJson("/admin/account-hint", {
      account_hint: "alice@example.com",
    });
    await seedSession("sess-ah-e2e", "/tmp/ah-e2e", 2001);
    const row = handle.harbor.db.getSessionById("sess-ah-e2e");
    expect(row?.account_hint).toBe("alice@example.com");
  });
});
