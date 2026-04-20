/**
 * Integration tests for the P1.1 hook endpoints.
 *
 * Each test spins up a fresh server on an ephemeral port with an in-memory
 * SQLite database, so state does not leak across tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { start, type HarborHandle } from "../src/index.ts";
import { __resetCorrelation } from "../src/correlate.ts";

interface Handle {
  port: number;
  harbor: HarborHandle;
  stop: () => void;
}

/**
 * Monotonic counter shared across the test file so seeded pids and any
 * future deterministic identifiers don't vary run-to-run. Seeded with
 * process.pid so parallel `bun test` invocations on CI don't collide in
 * the rare case both tests talk to a shared external surface (none today,
 * but keeps the pattern safe).
 */
let nextPid = 20_000 + (process.pid % 1000) * 10;
function nextTestPid(): number {
  return nextPid++;
}

function bootServer(): Handle {
  // Use OS-assigned ephemeral ports via `port: 0`; this removes any
  // random-number / math-based port selection.
  const h = start({ port: 0, dbPath: ":memory:" });
  const port = h.server.port;
  if (typeof port !== "number") throw new Error("server port missing");
  return {
    port,
    harbor: h,
    stop: () => h.stop(),
  };
}

let handle: Handle;
beforeEach(() => {
  __resetCorrelation();
  handle = bootServer();
});
afterEach(() => {
  handle.stop();
  __resetCorrelation();
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

async function postRaw(
  path: string,
  body: string,
  headers: Record<string, string> = { "content-type": "application/json" },
): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, { method: "POST", headers, body });
}

/** Register a session via SessionStart and return the session_id. */
async function seedSession(
  session_id: string,
  cwd = `/tmp/${session_id}`,
  pid = nextTestPid(),
): Promise<string> {
  const res = await postJson("/hooks/session-start", {
    session_id,
    cwd,
    pid,
    ts: Date.now(),
  });
  if (res.status !== 200) {
    throw new Error(`seed session failed: ${res.status}`);
  }
  return session_id;
}

/** Generate a body slightly over the 64 KiB cap. */
function oversizedBody(): string {
  const pad = "x".repeat(66_000);
  return JSON.stringify({ session_id: "sess-big", pad });
}

// --- /hooks/user-prompt-submit -----------------------------------------

describe("POST /hooks/user-prompt-submit", () => {
  test("persists an inbound message row on happy path", async () => {
    const sid = await seedSession("sess-ups-ok");
    const res = await postJson("/hooks/user-prompt-submit", {
      session_id: sid,
      prompt: "hello claude",
    });
    expect(res.status).toBe(204);

    const row = handle.harbor.db.raw
      .prepare(
        "SELECT direction, content, meta_json FROM messages WHERE session_id = ?",
      )
      .get(sid) as
      | { direction: string; content: string; meta_json: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.direction).toBe("inbound");
    expect(row?.content).toBe("hello claude");
    expect(row?.meta_json).toContain("hello claude");
  });

  test("falls back to `message` field when `prompt` is absent", async () => {
    const sid = await seedSession("sess-ups-alt");
    const res = await postJson("/hooks/user-prompt-submit", {
      session_id: sid,
      message: "fallback path",
    });
    expect(res.status).toBe(204);
    const row = handle.harbor.db.raw
      .prepare("SELECT content FROM messages WHERE session_id = ?")
      .get(sid) as { content: string } | undefined;
    expect(row?.content).toBe("fallback path");
  });

  test("strips control characters from persisted content", async () => {
    const sid = await seedSession("sess-ups-ctl");
    const res = await postJson("/hooks/user-prompt-submit", {
      session_id: sid,
      prompt: "line1\x00bad\x07control\x7fend",
    });
    expect(res.status).toBe(204);
    const row = handle.harbor.db.raw
      .prepare("SELECT content FROM messages WHERE session_id = ?")
      .get(sid) as { content: string } | undefined;
    expect(row?.content).toBe("line1badcontrolend");
  });

  test("unknown session_id returns 404", async () => {
    const res = await postJson("/hooks/user-prompt-submit", {
      session_id: "nope",
      prompt: "x",
    });
    expect(res.status).toBe(404);
  });

  test("malformed JSON returns 400", async () => {
    const res = await postRaw("/hooks/user-prompt-submit", "{not json");
    expect(res.status).toBe(400);
  });

  test("missing session_id returns 400", async () => {
    const res = await postJson("/hooks/user-prompt-submit", { prompt: "x" });
    expect(res.status).toBe(400);
  });

  test("oversized payload returns 413", async () => {
    const res = await postRaw("/hooks/user-prompt-submit", oversizedBody());
    expect(res.status).toBe(413);
  });
});

// --- /hooks/pre-tool-use ------------------------------------------------

describe("POST /hooks/pre-tool-use", () => {
  test("persists a PreToolUse event with input and permission_mode", async () => {
    const sid = await seedSession("sess-pre-ok");
    const res = await postJson("/hooks/pre-tool-use", {
      session_id: sid,
      tool_name: "Bash",
      tool_input: { command: "ls" },
      permission_mode: "default",
    });
    expect(res.status).toBe(204);

    const row = handle.harbor.db.raw
      .prepare(
        "SELECT hook_event, tool_name, tool_input_json, tool_output_json, permission_mode FROM tool_events WHERE session_id = ?",
      )
      .get(sid) as
      | {
          hook_event: string;
          tool_name: string;
          tool_input_json: string;
          tool_output_json: string | null;
          permission_mode: string;
        }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.hook_event).toBe("PreToolUse");
    expect(row?.tool_name).toBe("Bash");
    expect(JSON.parse(row!.tool_input_json)).toEqual({ command: "ls" });
    expect(row?.tool_output_json).toBeNull();
    expect(row?.permission_mode).toBe("default");
  });

  test("unknown session_id returns 404", async () => {
    const res = await postJson("/hooks/pre-tool-use", {
      session_id: "nope",
      tool_name: "Bash",
    });
    expect(res.status).toBe(404);
  });

  test("malformed JSON returns 400", async () => {
    const res = await postRaw("/hooks/pre-tool-use", "not-json");
    expect(res.status).toBe(400);
  });

  test("missing session_id returns 400", async () => {
    const res = await postJson("/hooks/pre-tool-use", { tool_name: "Bash" });
    expect(res.status).toBe(400);
  });

  test("oversized payload returns 413", async () => {
    const res = await postRaw("/hooks/pre-tool-use", oversizedBody());
    expect(res.status).toBe(413);
  });
});

// --- /hooks/post-tool-use -----------------------------------------------

describe("POST /hooks/post-tool-use", () => {
  test("persists a PostToolUse event with input + tool_response", async () => {
    const sid = await seedSession("sess-post-ok");
    const res = await postJson("/hooks/post-tool-use", {
      session_id: sid,
      tool_name: "Read",
      tool_input: { file_path: "/x" },
      tool_response: { content: "hello" },
      permission_mode: "acceptEdits",
    });
    expect(res.status).toBe(204);
    const row = handle.harbor.db.raw
      .prepare(
        "SELECT hook_event, tool_name, tool_output_json, permission_mode FROM tool_events WHERE session_id = ?",
      )
      .get(sid) as
      | {
          hook_event: string;
          tool_name: string;
          tool_output_json: string;
          permission_mode: string;
        }
      | undefined;
    expect(row?.hook_event).toBe("PostToolUse");
    expect(row?.tool_name).toBe("Read");
    expect(JSON.parse(row!.tool_output_json)).toEqual({ content: "hello" });
    expect(row?.permission_mode).toBe("acceptEdits");
  });

  test("falls back to `tool_output` when `tool_response` is absent", async () => {
    const sid = await seedSession("sess-post-alt");
    const res = await postJson("/hooks/post-tool-use", {
      session_id: sid,
      tool_name: "Read",
      tool_output: { alt: true },
    });
    expect(res.status).toBe(204);
    const row = handle.harbor.db.raw
      .prepare(
        "SELECT tool_output_json FROM tool_events WHERE session_id = ?",
      )
      .get(sid) as { tool_output_json: string } | undefined;
    expect(JSON.parse(row!.tool_output_json)).toEqual({ alt: true });
  });

  test("unknown session_id returns 404", async () => {
    const res = await postJson("/hooks/post-tool-use", {
      session_id: "nope",
      tool_name: "Read",
    });
    expect(res.status).toBe(404);
  });

  test("malformed JSON returns 400", async () => {
    const res = await postRaw("/hooks/post-tool-use", "{{{");
    expect(res.status).toBe(400);
  });

  test("missing session_id returns 400", async () => {
    const res = await postJson("/hooks/post-tool-use", { tool_name: "Read" });
    expect(res.status).toBe(400);
  });

  test("oversized payload returns 413", async () => {
    const res = await postRaw("/hooks/post-tool-use", oversizedBody());
    expect(res.status).toBe(413);
  });
});

// --- /hooks/stop --------------------------------------------------------

describe("POST /hooks/stop", () => {
  test("persists a Stop audit row with raw payload as tool_input_json", async () => {
    const sid = await seedSession("sess-stop-ok");
    const res = await postJson("/hooks/stop", {
      session_id: sid,
      stop_hook_active: true,
    });
    expect(res.status).toBe(204);
    const row = handle.harbor.db.raw
      .prepare(
        "SELECT hook_event, tool_name, tool_input_json FROM tool_events WHERE session_id = ?",
      )
      .get(sid) as
      | {
          hook_event: string;
          tool_name: string | null;
          tool_input_json: string;
        }
      | undefined;
    expect(row?.hook_event).toBe("Stop");
    expect(row?.tool_name).toBeNull();
    expect(JSON.parse(row!.tool_input_json)).toEqual({
      session_id: sid,
      stop_hook_active: true,
    });
  });

  test("unknown session_id returns 404", async () => {
    const res = await postJson("/hooks/stop", { session_id: "nope" });
    expect(res.status).toBe(404);
  });

  test("malformed JSON returns 400", async () => {
    const res = await postRaw("/hooks/stop", "garbage");
    expect(res.status).toBe(400);
  });

  test("missing session_id returns 400", async () => {
    const res = await postJson("/hooks/stop", {});
    expect(res.status).toBe(400);
  });

  test("oversized payload returns 413", async () => {
    const res = await postRaw("/hooks/stop", oversizedBody());
    expect(res.status).toBe(413);
  });
});

// --- /hooks/session-end -------------------------------------------------

describe("POST /hooks/session-end", () => {
  test("marks the session as ended with ended_at timestamp", async () => {
    const sid = await seedSession("sess-end-ok");
    const before = Date.now();
    const res = await postJson("/hooks/session-end", { session_id: sid });
    expect(res.status).toBe(204);
    const row = handle.harbor.db.raw
      .prepare("SELECT status, ended_at FROM sessions WHERE session_id = ?")
      .get(sid) as { status: string; ended_at: number } | undefined;
    expect(row?.status).toBe("ended");
    expect(typeof row?.ended_at).toBe("number");
    expect(row!.ended_at).toBeGreaterThanOrEqual(before);
  });

  test("is idempotent: second call also returns 204", async () => {
    const sid = await seedSession("sess-end-idem");
    const first = await postJson("/hooks/session-end", { session_id: sid });
    expect(first.status).toBe(204);
    const second = await postJson("/hooks/session-end", { session_id: sid });
    expect(second.status).toBe(204);
    const row = handle.harbor.db.raw
      .prepare("SELECT status FROM sessions WHERE session_id = ?")
      .get(sid) as { status: string } | undefined;
    expect(row?.status).toBe("ended");
  });

  test("unknown session_id returns 404", async () => {
    const res = await postJson("/hooks/session-end", {
      session_id: "missing",
    });
    expect(res.status).toBe(404);
  });

  test("malformed JSON returns 400", async () => {
    const res = await postRaw("/hooks/session-end", "nope");
    expect(res.status).toBe(400);
  });

  test("missing session_id returns 400", async () => {
    const res = await postJson("/hooks/session-end", {});
    expect(res.status).toBe(400);
  });

  test("oversized payload returns 413", async () => {
    const res = await postRaw("/hooks/session-end", oversizedBody());
    expect(res.status).toBe(413);
  });
});

// --- /hooks/notification ------------------------------------------------

describe("POST /hooks/notification", () => {
  test("persists a Notification audit row with raw payload", async () => {
    const sid = await seedSession("sess-notif-ok");
    const res = await postJson("/hooks/notification", {
      session_id: sid,
      message: "permission required",
    });
    expect(res.status).toBe(204);
    const row = handle.harbor.db.raw
      .prepare(
        "SELECT hook_event, tool_name, tool_input_json FROM tool_events WHERE session_id = ?",
      )
      .get(sid) as
      | {
          hook_event: string;
          tool_name: string | null;
          tool_input_json: string;
        }
      | undefined;
    expect(row?.hook_event).toBe("Notification");
    expect(row?.tool_name).toBeNull();
    expect(JSON.parse(row!.tool_input_json)).toEqual({
      session_id: sid,
      message: "permission required",
    });
  });

  test("unknown session_id returns 404", async () => {
    const res = await postJson("/hooks/notification", {
      session_id: "nope",
      message: "x",
    });
    expect(res.status).toBe(404);
  });

  test("malformed JSON returns 400", async () => {
    const res = await postRaw("/hooks/notification", "---");
    expect(res.status).toBe(400);
  });

  test("missing session_id returns 400", async () => {
    const res = await postJson("/hooks/notification", { message: "hi" });
    expect(res.status).toBe(400);
  });

  test("oversized payload returns 413", async () => {
    const res = await postRaw("/hooks/notification", oversizedBody());
    expect(res.status).toBe(413);
  });
});

// --- cross-cutting ------------------------------------------------------

describe("hook endpoints content-type gate", () => {
  test("rejects non-JSON content-type with 400", async () => {
    const sid = await seedSession("sess-ct");
    const res = await postRaw(
      "/hooks/user-prompt-submit",
      JSON.stringify({ session_id: sid, prompt: "hi" }),
      { "content-type": "text/plain" },
    );
    expect(res.status).toBe(400);
  });

  test("accepts application/json with charset parameter", async () => {
    const sid = await seedSession("sess-ct2");
    const res = await postRaw(
      "/hooks/user-prompt-submit",
      JSON.stringify({ session_id: sid, prompt: "hi" }),
      { "content-type": "application/json; charset=utf-8" },
    );
    expect(res.status).toBe(204);
  });
});

// --- streaming body cap (P1.1 HIGH fix) --------------------------------

describe("streaming body cap", () => {
  test("rejects >64 KiB body even without Content-Length", async () => {
    // Build a 200 KiB ReadableStream that fetch won't add Content-Length
    // for. The body field is large enough to blow the 64 KiB cap but the
    // server should abort the read and return 413 without buffering past
    // one chunk beyond the cap.
    const sid = await seedSession("sess-stream-cap");
    const big = "y".repeat(200_000);
    const payload = `{"session_id":"${sid}","pad":"${big}"}`;
    const encoder = new TextEncoder();
    // Yield in ~16 KiB chunks so the server's streaming reader must see
    // multiple reads before detecting the cap breach.
    const CHUNK = 16_384;
    const totalBytes = encoder.encode(payload);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < totalBytes.length; i += CHUNK) {
          controller.enqueue(totalBytes.slice(i, i + CHUNK));
        }
        controller.close();
      },
    });

    const res = await fetch(`${baseUrl()}/hooks/user-prompt-submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      // @ts-ignore - Bun/undici accept this to opt into half-duplex streaming
      duplex: "half",
    });
    expect(res.status).toBe(413);
  });

  test("rejects 100 KiB body sent in one buffer (no CL trust required)", async () => {
    // Standard path: fetch will set a Content-Length, so this exercises
    // the fast-path CL reject too. Included to lock in the regression
    // that undercounting via UTF-16 .length on `text()` used to allow.
    const sid = await seedSession("sess-stream-cap2");
    const big = "z".repeat(100_000);
    const res = await postRaw(
      "/hooks/user-prompt-submit",
      JSON.stringify({ session_id: sid, pad: big }),
    );
    expect(res.status).toBe(413);
  });
});

// --- session-end reason persistence (P1.1 MEDIUM fix) ------------------

describe("POST /hooks/session-end reason field", () => {
  test("persists `reason` to ended_reason column", async () => {
    const sid = await seedSession("sess-end-reason");
    const res = await postJson("/hooks/session-end", {
      session_id: sid,
      reason: "clear",
    });
    expect(res.status).toBe(204);
    const row = handle.harbor.db.raw
      .prepare(
        "SELECT status, ended_at, ended_reason FROM sessions WHERE session_id = ?",
      )
      .get(sid) as
      | { status: string; ended_at: number; ended_reason: string | null }
      | undefined;
    expect(row?.status).toBe("ended");
    expect(row?.ended_reason).toBe("clear");
  });

  test("strips control chars from `reason` before persisting", async () => {
    const sid = await seedSession("sess-end-reason-ctl");
    const res = await postJson("/hooks/session-end", {
      session_id: sid,
      reason: "logout\x00\x07bad",
    });
    expect(res.status).toBe(204);
    const row = handle.harbor.db.raw
      .prepare("SELECT ended_reason FROM sessions WHERE session_id = ?")
      .get(sid) as { ended_reason: string | null } | undefined;
    expect(row?.ended_reason).toBe("logoutbad");
  });

  test("absent `reason` leaves ended_reason null", async () => {
    const sid = await seedSession("sess-end-no-reason");
    const res = await postJson("/hooks/session-end", { session_id: sid });
    expect(res.status).toBe(204);
    const row = handle.harbor.db.raw
      .prepare("SELECT ended_reason FROM sessions WHERE session_id = ?")
      .get(sid) as { ended_reason: string | null } | undefined;
    expect(row?.ended_reason).toBeNull();
  });
});

// --- FK guard against orphan audit rows (P1.1 HIGH fix) ----------------

describe("foreign-key enforcement", () => {
  test("PRAGMA foreign_keys is ON at the DB connection", () => {
    const row = handle.harbor.db.raw
      .prepare("PRAGMA foreign_keys")
      .get() as { foreign_keys: number } | undefined;
    expect(row?.foreign_keys).toBe(1);
  });

  test("direct insert with unknown session_id fails via FK (belt-and-braces backstop for hook-layer 404)", () => {
    // The hook layer rejects unknown sessions at the HTTP boundary with
    // 404, so this scenario should not occur in production. We still
    // assert the DB-level backstop so an accidental bypass (e.g. a new
    // path that calls `insertToolEvent` directly) cannot silently write
    // orphans.
    expect(() => {
      handle.harbor.db.insertToolEvent({
        session_id: "definitely-not-a-session",
        hook_event: "PreToolUse",
        tool_name: "Bash",
        tool_input_json: "{}",
        tool_output_json: null,
        permission_mode: null,
        created_at: Date.now(),
      });
    }).toThrow();

    expect(() => {
      handle.harbor.db.insertMessage({
        session_id: "definitely-not-a-session",
        direction: "inbound",
        content: "x",
        metaJson: "{}",
        created_at: Date.now(),
      });
    }).toThrow();
  });
});
