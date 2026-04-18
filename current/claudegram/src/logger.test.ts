import { describe, it, expect } from "bun:test";
import { createLogger } from "./logger.js";
import type { LogLevel } from "./logger.js";

// Helper: build a capturing stream that collects all write() calls
function makeStream() {
  const lines: string[] = [];
  return {
    stream: { write: (s: string) => { lines.push(s); } },
    lines,
  };
}

// ISO-8601 UTC with millisecond precision
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("createLogger — level filtering", () => {
  it("level=debug: all four methods write", () => {
    const { stream, lines } = makeStream();
    const log = createLogger({ level: "debug", stream });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines.length).toBe(4);
  });

  it("level=info: debug suppressed, info/warn/error write", () => {
    const { stream, lines } = makeStream();
    const log = createLogger({ level: "info", stream });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines.length).toBe(3);
    const levels = lines.map(l => JSON.parse(l).level);
    expect(levels).toEqual(["info", "warn", "error"]);
  });

  it("level=warn: only warn/error write", () => {
    const { stream, lines } = makeStream();
    const log = createLogger({ level: "warn", stream });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines.length).toBe(2);
    const levels = lines.map(l => JSON.parse(l).level);
    expect(levels).toEqual(["warn", "error"]);
  });

  it("level=error: only error writes", () => {
    const { stream, lines } = makeStream();
    const log = createLogger({ level: "error", stream });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]).level).toBe("error");
  });
});

describe("createLogger — output format", () => {
  it("each line is valid JSON ending with \\n", () => {
    const { stream, lines } = makeStream();
    const log = createLogger({ level: "debug", stream });
    log.info("test");
    expect(lines.length).toBe(1);
    expect(lines[0].endsWith("\n")).toBe(true);
    // should not throw
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it("parsed JSON has correct ts, level, msg keys", () => {
    const { stream, lines } = makeStream();
    const log = createLogger({ level: "debug", stream });
    log.warn("hello world");
    const obj = JSON.parse(lines[0]);
    expect(typeof obj.ts).toBe("string");
    expect(obj.level).toBe("warn");
    expect(obj.msg).toBe("hello world");
  });

  it("ts matches ISO-8601 UTC regex", () => {
    const { stream, lines } = makeStream();
    const log = createLogger({ level: "debug", stream });
    log.error("ts check");
    const { ts } = JSON.parse(lines[0]);
    expect(ts).toMatch(ISO_RE);
  });

  it("fields are merged into JSON root", () => {
    const { stream, lines } = makeStream();
    const log = createLogger({ level: "debug", stream });
    log.info("hi", { user: "x", n: 42 });
    const obj = JSON.parse(lines[0]);
    expect(obj.user).toBe("x");
    expect(obj.n).toBe(42);
  });

  it("reserved key collision: built-ins win", () => {
    const { stream, lines } = makeStream();
    const log = createLogger({ level: "debug", stream });
    log.info("hi", { ts: "fake", level: "fake", msg: "fake" });
    const obj = JSON.parse(lines[0]);
    expect(obj.ts).toMatch(ISO_RE);
    expect(obj.level).toBe("info");
    expect(obj.msg).toBe("hi");
  });

  it("fields=undefined produces no extra keys beyond ts/level/msg", () => {
    const { stream, lines } = makeStream();
    const log = createLogger({ level: "debug", stream });
    log.info("no fields");
    const obj = JSON.parse(lines[0]);
    expect(Object.keys(obj).sort()).toEqual(["level", "msg", "ts"]);
  });
});

describe("createLogger — instance isolation", () => {
  it("two separate loggers with different levels are independent", () => {
    const a = makeStream();
    const b = makeStream();
    const logA = createLogger({ level: "error", stream: a.stream });
    const logB = createLogger({ level: "debug", stream: b.stream });

    logA.debug("only-b");
    logA.error("both");
    logB.debug("only-b");
    logB.error("both");

    // logA: only error passes
    expect(a.lines.length).toBe(1);
    expect(JSON.parse(a.lines[0]).level).toBe("error");

    // logB: debug passes
    expect(b.lines.length).toBe(2);
    expect(JSON.parse(b.lines[0]).level).toBe("debug");
  });
});

describe("createLogger — unserializable fields fallback", () => {
  it("circular ref: does not throw, outputs exactly one line, _fields_err present", () => {
    const { stream, lines } = makeStream();
    const log = createLogger({ level: "error", stream });
    const o: any = {};
    o.self = o;
    expect(() => log.error("bad", o)).not.toThrow();
    expect(lines.length).toBe(1);
    const obj = JSON.parse(lines[0]);
    expect(obj._fields_err).toBe("unserializable");
  });

  it("BigInt: does not throw, outputs exactly one line, _fields_err present", () => {
    const { stream, lines } = makeStream();
    const log = createLogger({ level: "error", stream });
    expect(() => log.error("bad", { n: BigInt(1) })).not.toThrow();
    expect(lines.length).toBe(1);
    const obj = JSON.parse(lines[0]);
    expect(obj._fields_err).toBe("unserializable");
  });
});
