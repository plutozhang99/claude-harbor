/**
 * Install-time account_hint capture for P1.3.
 *
 * Per PLAN §6 account email identity is NOT exposed by CC to runtime
 * hooks / statusline / env. We therefore capture a best-effort hint ONCE
 * at install time by shelling out to the `claude auth status --json` CLI
 * command, then POST it to the server's `/admin/account-hint` endpoint.
 *
 * This path is STRICTLY best-effort:
 *   - any CLI failure (ENOENT, non-zero exit, timeout, malformed JSON) is
 *     swallowed and the install proceeds with no hint;
 *   - any POST failure is logged to stderr (with the hint redacted) and
 *     the install still returns success.
 *
 * The operator can override this behavior with `--account-hint=<mode>`:
 *   - `auto`            (default) — try the CLI, derive a hint, POST.
 *   - `skip`            — never invoke CLI, never POST.
 *   - `manual:<value>`  — skip the CLI, POST the provided value verbatim.
 */

import { DEFAULT_HARBOR_URL } from "./types.ts";

/** Max characters we'll send upstream. Server also enforces 512. */
const MAX_HINT_CHARS = 512;

/** CLI spawn timeout: keep install snappy even if `claude` misbehaves. */
const CLI_TIMEOUT_MS = 3_000;

/** Best-effort POST timeout. */
const POST_TIMEOUT_MS = 2_000;

export type AccountHintMode =
  | { readonly kind: "auto" }
  | { readonly kind: "skip" }
  | { readonly kind: "manual"; readonly value: string };

/**
 * Parse the `--account-hint` flag. Returns `null` on invalid syntax so
 * the caller can surface a usage error.
 */
export function parseAccountHintFlag(raw: string | undefined): AccountHintMode | null {
  if (raw === undefined || raw === "") return { kind: "auto" };
  if (raw === "auto") return { kind: "auto" };
  if (raw === "skip") return { kind: "skip" };
  if (raw.startsWith("manual:")) {
    const value = raw.slice("manual:".length);
    if (value.length === 0) return null;
    return { kind: "manual", value };
  }
  return null;
}

/**
 * Redact a hint for logs: show only the first 3 characters plus length.
 * Never log the full email / identifier.
 */
export function redactHint(hint: string): string {
  // Strip control chars (including CR/LF/ESC) so log output stays single-line
  // and cannot be used to inject terminal escape sequences.
  const head = hint.slice(0, 3).replace(/[\x00-\x1F\x7F-\x9F]/g, "?");
  return `${head}… (len=${hint.length})`;
}

/**
 * Minimal spawner interface — the real one wraps `Bun.spawn`. The
 * installer tests inject a fake to cover ENOENT / timeout / bad JSON
 * paths without needing an actual `claude` binary on PATH.
 */
export interface CliSpawnResult {
  readonly kind: "ok";
  readonly stdout: string;
}
export interface CliSpawnErr {
  readonly kind: "error";
  readonly reason:
    | "not-found"
    | "nonzero-exit"
    | "timeout"
    | "spawn-failed";
  readonly detail?: string;
}
export type CliSpawnOutcome = CliSpawnResult | CliSpawnErr;

export type CliSpawner = (
  argv: readonly string[],
  timeoutMs: number,
) => Promise<CliSpawnOutcome>;

/** Real spawner: `Bun.spawn` with stdout piped, stdin/stderr ignored. */
export const defaultCliSpawner: CliSpawner = async (argv, timeoutMs) => {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn({
      cmd: [...argv],
      // stderr: "ignore" avoids a second pipe we'd have to drain in parallel
      // to prevent a >64 KiB write from blocking the child indefinitely.
      stdio: ["ignore", "pipe", "ignore"],
      // No shell=true; Bun.spawn never invokes a shell when given argv.
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ENOENT|not found|No such file/i.test(msg)) {
      return { kind: "error", reason: "not-found", detail: msg };
    }
    return { kind: "error", reason: "spawn-failed", detail: msg };
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill();
    } catch {
      // ignore
    }
  }, timeoutMs);
  // CRITICAL: start draining stdout BEFORE awaiting `proc.exited`. If the
  // child writes more than the pipe buffer (~64 KiB) and we are still
  // awaiting exit without a reader, the child blocks on write forever and
  // only the timeout kill ends the process — losing all output.
  const out = proc.stdout;
  const stdoutPromise =
    out && typeof out !== "number"
      ? new Response(out).text()
      : Promise.resolve("");
  let code: number;
  try {
    code = await proc.exited;
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) {
    // Still resolve the read promise so we don't leak it; we just discard
    // whatever partial bytes arrived before the kill.
    try {
      await stdoutPromise;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Best-effort log; nothing else to do.
      // eslint-disable-next-line no-console
      console.error(`claude-harbor-install: account_hint: failed to drain stdout after timeout: ${msg}`);
    }
    return { kind: "error", reason: "timeout" };
  }
  if (code !== 0) {
    try {
      await stdoutPromise;
    } catch {
      // ignore — we are reporting nonzero-exit anyway
    }
    return {
      kind: "error",
      reason: "nonzero-exit",
      detail: `exit=${code}`,
    };
  }
  let stdout = "";
  try {
    stdout = await stdoutPromise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`claude-harbor-install: account_hint: failed to read CLI stdout: ${msg}`);
  }
  return { kind: "ok", stdout };
};

/**
 * Best-effort extraction of an account-identifying string from the
 * (un-stable) `claude auth status --json` output. We try several paths
 * in order; first non-empty match wins. If nothing fits, we try to
 * synthesize a role+org label. Returns null when nothing usable exists.
 */
export function extractAccountHint(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const root = raw as Record<string, unknown>;
  const data = pickObject(root, "data") ?? root;

  const account = pickObject(data, "account");
  const user = pickObject(data, "user");

  const candidates: Array<string | null> = [
    pickString(account, "email_address"),
    pickString(account, "email"),
    pickString(data, "email"),
    pickString(user, "email"),
  ];
  for (const c of candidates) {
    if (c) return truncate(c);
  }
  const role = pickString(account, "organization_role");
  const org = pickString(account, "organization_name");
  if (role && org) return truncate(`${role} @ ${org}`);
  if (org) return truncate(org);
  return null;
}

function pickObject(
  obj: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (!obj) return null;
  const v = obj[key];
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function pickString(
  obj: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return null;
}

function truncate(s: string): string {
  if (s.length <= MAX_HINT_CHARS) return s;
  return s.slice(0, MAX_HINT_CHARS);
}

/**
 * Minimal fetch signature so tests can inject a fake.
 * Matches the subset of the DOM `fetch` we actually use.
 */
export type PostFn = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ readonly status: number; readonly ok: boolean }>;

export interface PostAccountHintDeps {
  readonly harborUrl: string;
  readonly adminToken?: string | null;
  readonly post?: PostFn;
  readonly timeoutMs?: number;
}

export interface PostAccountHintResult {
  readonly ok: boolean;
  /** Best-effort error reason on failure (truncated, control-stripped). */
  readonly errorReason: string | null;
}

/**
 * POST `/admin/account-hint` with the given value (string or null to
 * clear). Best-effort: returns ok=true on 2xx, ok=false otherwise. Never
 * throws — swallow + caller logs.
 */
export async function postAccountHintDetailed(
  value: string | null,
  deps: PostAccountHintDeps,
): Promise<PostAccountHintResult> {
  const url = `${deps.harborUrl.replace(/\/+$/, "")}/admin/account-hint`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (deps.adminToken) {
    headers["x-harbor-admin-token"] = deps.adminToken;
  }
  const body = JSON.stringify({ account_hint: value });
  const poster: PostFn = deps.post ?? defaultPost;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    deps.timeoutMs ?? POST_TIMEOUT_MS,
  );
  try {
    const res = await poster(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    if (res.ok) return { ok: true, errorReason: null };
    return { ok: false, errorReason: `http ${res.status}` };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // Strip control chars and truncate so log output stays single-line.
    const sanitized = raw
      .replace(/[\x00-\x1F\x7F-\x9F]/g, "?")
      .slice(0, 80);
    return { ok: false, errorReason: sanitized };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience wrapper preserving the original boolean-returning shape for
 * callers that don't need the error reason.
 */
export async function postAccountHint(
  value: string | null,
  deps: PostAccountHintDeps,
): Promise<boolean> {
  const result = await postAccountHintDetailed(value, deps);
  return result.ok;
}

const defaultPost: PostFn = async (url, init) => {
  const res = await fetch(url, init as RequestInit);
  return { status: res.status, ok: res.ok };
};

// --- Orchestration -----------------------------------------------------

export interface CaptureDeps {
  readonly mode: AccountHintMode;
  readonly harborUrl?: string;
  readonly adminToken?: string | null;
  readonly spawn?: CliSpawner;
  readonly post?: PostFn;
  readonly stderr?: (msg: string) => void;
  readonly stdout?: (msg: string) => void;
  readonly cliTimeoutMs?: number;
  readonly postTimeoutMs?: number;
}

export interface CaptureOutcome {
  /** True if we actually sent a POST (success or failure). */
  readonly attemptedPost: boolean;
  /** True on a 2xx from the server. */
  readonly postOk: boolean;
  /** Hint we ended up sending (redacted form), null if none. */
  readonly hintRedacted: string | null;
  /** Reason we skipped, if any — for logs/tests. */
  readonly skipReason: string | null;
}

/**
 * Run the install-time capture per `mode`. Always returns — never throws.
 * Never logs the raw hint. Stderr lines use `redactHint`.
 */
export async function captureAccountHint(
  deps: CaptureDeps,
): Promise<CaptureOutcome> {
  const stderr = deps.stderr ?? ((): void => {});
  const stdout = deps.stdout ?? ((): void => {});
  const harborUrl = deps.harborUrl ?? DEFAULT_HARBOR_URL;

  if (deps.mode.kind === "skip") {
    return {
      attemptedPost: false,
      postOk: false,
      hintRedacted: null,
      skipReason: "skip mode",
    };
  }

  let hint: string | null = null;
  if (deps.mode.kind === "manual") {
    hint = deps.mode.value.slice(0, MAX_HINT_CHARS);
  } else {
    const spawn = deps.spawn ?? defaultCliSpawner;
    const outcome = await spawn(
      ["claude", "auth", "status", "--json"],
      deps.cliTimeoutMs ?? CLI_TIMEOUT_MS,
    );
    if (outcome.kind === "error") {
      stderr(
        `claude-harbor-install: account_hint: CLI ${outcome.reason}; continuing without hint.`,
      );
      return {
        attemptedPost: false,
        postOk: false,
        hintRedacted: null,
        skipReason: `cli-${outcome.reason}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(outcome.stdout);
    } catch {
      stderr(
        "claude-harbor-install: account_hint: CLI output is not JSON; continuing without hint.",
      );
      return {
        attemptedPost: false,
        postOk: false,
        hintRedacted: null,
        skipReason: "cli-bad-json",
      };
    }
    hint = extractAccountHint(parsed);
    if (!hint) {
      stderr(
        "claude-harbor-install: account_hint: no recognizable field in CLI output; continuing without hint.",
      );
      return {
        attemptedPost: false,
        postOk: false,
        hintRedacted: null,
        skipReason: "cli-no-field",
      };
    }
  }

  const redacted = hint ? redactHint(hint) : null;
  const result = await postAccountHintDetailed(hint, {
    harborUrl,
    adminToken: deps.adminToken ?? null,
    post: deps.post,
    timeoutMs: deps.postTimeoutMs,
  });
  if (!result.ok) {
    const reason = result.errorReason ?? "unknown";
    stderr(
      `claude-harbor-install: account_hint: POST failed: ${reason}; install proceeds. hint=${redacted}`,
    );
  } else {
    stdout(`  account_hint: posted ${redacted ?? "(cleared)"}`);
  }
  return {
    attemptedPost: true,
    postOk: result.ok,
    hintRedacted: redacted,
    skipReason: null,
  };
}

/**
 * Best-effort clear invoked by `uninstall`. Exported separately so the
 * uninstall path stays a one-liner.
 */
export async function clearAccountHint(deps: {
  readonly harborUrl?: string;
  readonly adminToken?: string | null;
  readonly post?: PostFn;
  readonly stderr?: (msg: string) => void;
  readonly timeoutMs?: number;
}): Promise<boolean> {
  const ok = await postAccountHint(null, {
    harborUrl: deps.harborUrl ?? DEFAULT_HARBOR_URL,
    adminToken: deps.adminToken ?? null,
    post: deps.post,
    timeoutMs: deps.timeoutMs,
  });
  if (!ok && deps.stderr) {
    deps.stderr(
      "claude-harbor-install: account_hint: clear POST failed; uninstall proceeds.",
    );
  }
  return ok;
}
