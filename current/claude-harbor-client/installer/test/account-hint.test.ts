/**
 * Tests for the P1.3 install-time account_hint capture module.
 *
 * Covers:
 *   - parseAccountHintFlag: default/auto/skip/manual:<val>/invalid
 *   - extractAccountHint path preference
 *   - redactHint shape
 *   - captureAccountHint:
 *       * auto mode happy path (CLI spawn mock returns JSON) → POST fires
 *       * auto mode with CLI missing (ENOENT) → no POST, install continues
 *       * auto mode with malformed JSON → no POST, warn line emitted
 *       * auto mode with no recognizable field → no POST, warn emitted
 *       * manual:<value> mode → posts verbatim, NO spawn
 *       * skip mode → no spawn, no POST
 *       * POST failure → still returns successfully
 *       * CLI timeout handling
 *       * Admin token header is sent when deps.adminToken is set
 *   - clearAccountHint: posts null
 *   - redaction: full hint never appears in stderr
 */

import { describe, expect, test } from "bun:test";
import {
  captureAccountHint,
  clearAccountHint,
  extractAccountHint,
  parseAccountHintFlag,
  redactHint,
  type CliSpawner,
  type PostFn,
} from "../src/account-hint.ts";

function jsonSpawn(payload: unknown): CliSpawner {
  return async () => ({ kind: "ok", stdout: JSON.stringify(payload) });
}
function rawSpawn(stdout: string): CliSpawner {
  return async () => ({ kind: "ok", stdout });
}
function failSpawn(reason: "not-found" | "nonzero-exit" | "timeout" | "spawn-failed"): CliSpawner {
  return async () => ({ kind: "error", reason });
}

interface Captured {
  readonly calls: Array<{ url: string; body: string; headers: Record<string, string> }>;
}
function captureFetch(status = 204, okOverride = true): {
  captured: Captured;
  post: PostFn;
} {
  const calls: Captured["calls"] = [];
  const post: PostFn = async (url, init) => {
    calls.push({ url, body: init.body, headers: { ...init.headers } });
    return { status, ok: okOverride };
  };
  return { captured: { calls }, post };
}

describe("parseAccountHintFlag", () => {
  test("undefined / empty → auto", () => {
    expect(parseAccountHintFlag(undefined)).toEqual({ kind: "auto" });
    expect(parseAccountHintFlag("")).toEqual({ kind: "auto" });
  });
  test("'auto'", () => {
    expect(parseAccountHintFlag("auto")).toEqual({ kind: "auto" });
  });
  test("'skip'", () => {
    expect(parseAccountHintFlag("skip")).toEqual({ kind: "skip" });
  });
  test("'manual:alice@example.com'", () => {
    expect(parseAccountHintFlag("manual:alice@example.com")).toEqual({
      kind: "manual",
      value: "alice@example.com",
    });
  });
  test("'manual:' (empty value) is invalid", () => {
    expect(parseAccountHintFlag("manual:")).toBeNull();
  });
  test("unknown value is invalid", () => {
    expect(parseAccountHintFlag("magic")).toBeNull();
  });
});

describe("extractAccountHint", () => {
  test("prefers data.account.email_address", () => {
    const hint = extractAccountHint({
      data: {
        account: { email_address: "first@ex.com", email: "second@ex.com" },
      },
    });
    expect(hint).toBe("first@ex.com");
  });
  test("falls back to data.account.email", () => {
    expect(
      extractAccountHint({ data: { account: { email: "x@ex.com" } } }),
    ).toBe("x@ex.com");
  });
  test("falls back to data.email", () => {
    expect(extractAccountHint({ data: { email: "top@ex.com" } })).toBe("top@ex.com");
  });
  test("falls back to data.user.email", () => {
    expect(
      extractAccountHint({ data: { user: { email: "u@ex.com" } } }),
    ).toBe("u@ex.com");
  });
  test("synthesizes role + org when no email", () => {
    expect(
      extractAccountHint({
        data: {
          account: {
            organization_role: "admin",
            organization_name: "Acme",
          },
        },
      }),
    ).toBe("admin @ Acme");
  });
  test("returns null when no candidates", () => {
    expect(extractAccountHint({ data: { account: {} } })).toBeNull();
    expect(extractAccountHint({})).toBeNull();
    expect(extractAccountHint(null)).toBeNull();
    expect(extractAccountHint("nope")).toBeNull();
  });
  test("accepts root-level account/user when no `data` wrapper", () => {
    expect(extractAccountHint({ account: { email: "a@b.com" } })).toBe("a@b.com");
  });
  test("empty string fields are skipped", () => {
    expect(
      extractAccountHint({
        data: { account: { email_address: "   ", email: "real@ex.com" } },
      }),
    ).toBe("real@ex.com");
  });
});

describe("redactHint", () => {
  test("shows head + length only", () => {
    const out = redactHint("alice@example.com");
    expect(out).toBe("ali… (len=17)");
    expect(out).not.toContain("alice");
  });
  test("strips control chars from the head slice (no CR/LF/ESC)", () => {
    const out = redactHint("\n\x1b[31mX");
    expect(out).not.toContain("\n");
    expect(out).not.toContain("\x1b");
    // The two control chars (\n, \x1b) must be replaced with `?`; the
    // surviving `[` is a printable char and may pass through.
    expect(out.startsWith("??[")).toBe(true);
  });
});

describe("captureAccountHint — skip mode", () => {
  test("returns early, no spawn, no post", async () => {
    const { captured, post } = captureFetch();
    let spawnCalled = false;
    const spawn: CliSpawner = async () => {
      spawnCalled = true;
      return { kind: "ok", stdout: "{}" };
    };
    const out = await captureAccountHint({
      mode: { kind: "skip" },
      harborUrl: "http://localhost:7823",
      spawn,
      post,
    });
    expect(spawnCalled).toBe(false);
    expect(captured.calls.length).toBe(0);
    expect(out.attemptedPost).toBe(false);
    expect(out.skipReason).toBe("skip mode");
  });
});

describe("captureAccountHint — manual mode", () => {
  test("posts verbatim without spawning", async () => {
    const { captured, post } = captureFetch();
    let spawnCalled = false;
    const spawn: CliSpawner = async () => {
      spawnCalled = true;
      return { kind: "ok", stdout: "{}" };
    };
    const out = await captureAccountHint({
      mode: { kind: "manual", value: "alice@example.com" },
      harborUrl: "http://localhost:7823",
      spawn,
      post,
    });
    expect(spawnCalled).toBe(false);
    expect(captured.calls.length).toBe(1);
    expect(JSON.parse(captured.calls[0]!.body)).toEqual({
      account_hint: "alice@example.com",
    });
    expect(out.attemptedPost).toBe(true);
    expect(out.postOk).toBe(true);
  });
});

describe("captureAccountHint — auto mode", () => {
  test("happy path: spawn → extract → post", async () => {
    const { captured, post } = captureFetch();
    const spawn = jsonSpawn({
      data: { account: { email_address: "alice@example.com" } },
    });
    const stderrLines: string[] = [];
    const stdoutLines: string[] = [];
    const out = await captureAccountHint({
      mode: { kind: "auto" },
      harborUrl: "http://localhost:7823/",
      spawn,
      post,
      stderr: (m) => stderrLines.push(m),
      stdout: (m) => stdoutLines.push(m),
    });
    expect(captured.calls.length).toBe(1);
    expect(captured.calls[0]!.url).toBe(
      "http://localhost:7823/admin/account-hint",
    );
    expect(JSON.parse(captured.calls[0]!.body)).toEqual({
      account_hint: "alice@example.com",
    });
    expect(out.attemptedPost).toBe(true);
    expect(out.postOk).toBe(true);
    // Redaction: full email must NOT appear in stdout/stderr.
    expect(stdoutLines.join("\n")).not.toContain("alice@example.com");
    expect(stderrLines.join("\n")).not.toContain("alice@example.com");
  });

  test("missing CLI (ENOENT) → no POST, returns skip reason", async () => {
    const { captured, post } = captureFetch();
    const stderrLines: string[] = [];
    const out = await captureAccountHint({
      mode: { kind: "auto" },
      harborUrl: "http://localhost:7823",
      spawn: failSpawn("not-found"),
      post,
      stderr: (m) => stderrLines.push(m),
    });
    expect(captured.calls.length).toBe(0);
    expect(out.attemptedPost).toBe(false);
    expect(out.skipReason).toBe("cli-not-found");
    expect(stderrLines.some((l) => l.includes("not-found"))).toBe(true);
  });

  test("timeout → no POST, returns skip reason", async () => {
    const { captured, post } = captureFetch();
    const out = await captureAccountHint({
      mode: { kind: "auto" },
      harborUrl: "http://localhost:7823",
      spawn: failSpawn("timeout"),
      post,
    });
    expect(captured.calls.length).toBe(0);
    expect(out.skipReason).toBe("cli-timeout");
  });

  test("nonzero exit → no POST", async () => {
    const { captured, post } = captureFetch();
    const out = await captureAccountHint({
      mode: { kind: "auto" },
      harborUrl: "http://localhost:7823",
      spawn: failSpawn("nonzero-exit"),
      post,
    });
    expect(captured.calls.length).toBe(0);
    expect(out.skipReason).toBe("cli-nonzero-exit");
  });

  test("malformed JSON → no POST, warn emitted", async () => {
    const { captured, post } = captureFetch();
    const stderrLines: string[] = [];
    const out = await captureAccountHint({
      mode: { kind: "auto" },
      harborUrl: "http://localhost:7823",
      spawn: rawSpawn("not-json{{{"),
      post,
      stderr: (m) => stderrLines.push(m),
    });
    expect(captured.calls.length).toBe(0);
    expect(out.skipReason).toBe("cli-bad-json");
    expect(stderrLines.some((l) => l.toLowerCase().includes("not json"))).toBe(
      true,
    );
  });

  test("no recognizable field → no POST", async () => {
    const { captured, post } = captureFetch();
    const out = await captureAccountHint({
      mode: { kind: "auto" },
      harborUrl: "http://localhost:7823",
      spawn: jsonSpawn({ data: { account: { unrelated: true } } }),
      post,
    });
    expect(captured.calls.length).toBe(0);
    expect(out.skipReason).toBe("cli-no-field");
  });

  test("POST failure → returns postOk=false but does not throw", async () => {
    const calls: Array<unknown> = [];
    const post: PostFn = async (url, init) => {
      calls.push({ url, body: init.body });
      return { status: 500, ok: false };
    };
    const stderrLines: string[] = [];
    const out = await captureAccountHint({
      mode: { kind: "manual", value: "alice@example.com" },
      harborUrl: "http://localhost:7823",
      post,
      stderr: (m) => stderrLines.push(m),
    });
    expect(calls.length).toBe(1);
    expect(out.attemptedPost).toBe(true);
    expect(out.postOk).toBe(false);
    expect(stderrLines.some((l) => l.includes("POST failed"))).toBe(true);
    // Redaction present.
    expect(stderrLines.join("\n")).not.toContain("alice@example.com");
  });

  test("POST throws → still returns cleanly", async () => {
    const post: PostFn = async () => {
      throw new Error("network nope");
    };
    const out = await captureAccountHint({
      mode: { kind: "manual", value: "alice@example.com" },
      harborUrl: "http://localhost:7823",
      post,
    });
    expect(out.attemptedPost).toBe(true);
    expect(out.postOk).toBe(false);
  });

  test("admin token sent as X-Harbor-Admin-Token when provided", async () => {
    const { captured, post } = captureFetch();
    await captureAccountHint({
      mode: { kind: "manual", value: "alice@example.com" },
      harborUrl: "http://localhost:7823",
      adminToken: "secret-x",
      post,
    });
    expect(captured.calls[0]!.headers["x-harbor-admin-token"]).toBe("secret-x");
  });

  test("no admin token → header omitted", async () => {
    const { captured, post } = captureFetch();
    await captureAccountHint({
      mode: { kind: "manual", value: "alice@example.com" },
      harborUrl: "http://localhost:7823",
      post,
    });
    expect(captured.calls[0]!.headers["x-harbor-admin-token"]).toBeUndefined();
  });
});

describe("clearAccountHint", () => {
  test("posts {account_hint: null}", async () => {
    const { captured, post } = captureFetch();
    const ok = await clearAccountHint({
      harborUrl: "http://localhost:7823",
      post,
    });
    expect(ok).toBe(true);
    expect(captured.calls.length).toBe(1);
    expect(JSON.parse(captured.calls[0]!.body)).toEqual({ account_hint: null });
  });

  test("POST failure → logs warning, returns false", async () => {
    const post: PostFn = async () => ({ status: 500, ok: false });
    const stderrLines: string[] = [];
    const ok = await clearAccountHint({
      harborUrl: "http://localhost:7823",
      post,
      stderr: (m) => stderrLines.push(m),
    });
    expect(ok).toBe(false);
    expect(stderrLines.some((l) => l.includes("clear POST failed"))).toBe(true);
  });
});
