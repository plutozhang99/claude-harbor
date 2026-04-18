// logger.ts — structured JSONL logger, writes to stderr by default (never stdout).
// Default stream: process.stderr.write — no global state, each createLogger call is independent.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 } as const satisfies Record<LogLevel, number>;

// Default stream writes to stderr. Callers may inject a custom stream for testing.
const defaultStream: { readonly write: (s: string) => void } = {
  write: (s) => { process.stderr.write(s); },
};

export function createLogger(opts: {
  level: LogLevel;
  stream?: { write(s: string): void };
}): Logger {
  const minRank = LEVEL_RANK[opts.level];
  const stream = opts.stream ?? defaultStream;

  function log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < minRank) return;
    // Spread caller fields first so reserved keys (ts/level/msg) always win.
    const entry = {
      ...(fields ?? {}),
      ts: new Date().toISOString(),
      level,
      msg,
    };
    let line: string;
    try {
      line = JSON.stringify(entry) + "\n";
    } catch {
      line = JSON.stringify({
        ts: entry.ts,
        level: entry.level,
        msg: entry.msg,
        _fields_err: "unserializable",
      }) + "\n";
    }
    stream.write(line);
  }

  return {
    debug: (msg, fields) => log("debug", msg, fields),
    info:  (msg, fields) => log("info",  msg, fields),
    warn:  (msg, fields) => log("warn",  msg, fields),
    error: (msg, fields) => log("error", msg, fields),
  };
}
