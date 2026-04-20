# Claudegram

> Telegram bot bridge for Claude Code permission prompts. Approve / deny file edits, bash commands, and MCP tool calls from your phone — across multiple concurrent sessions.

## Why

When running 5–6 Claude Code sessions in parallel, switching terminals to respond to permission prompts gets expensive:

- Context-switch overhead between windows
- Background prompts get missed
- Sessions silently block waiting for your attention

Claudegram forwards every native Claude Code permission prompt to a personal Telegram bot. Tap a button on your phone — the session resumes immediately.

## Architecture

Three Bun workspaces speaking over HTTP + MCP stdio:

```
┌──────────────┐  MCP stdio   ┌──────────────────┐  HTTP  ┌─────────────┐
│ Claude Code  │ ───────────► │  Channel Server  │ ─────► │   Daemon    │
│   session    │              │  (per session)   │        │ (singleton) │
└──────────────┘              └──────────────────┘        │             │
                                                          │  + grammy   │
                              ┌──────────────────┐ events │  bot in     │
                              │ Telegram (you)   │ ◄───── │  process    │
                              └──────────────────┘        └─────────────┘
```

| Component | Role | Lifetime |
|-----------|------|----------|
| **Daemon** (`daemon/`) | Hono HTTP server with PID lock; holds the decision queue (TTL + long-poll) and session registry; runs the grammy Telegram bot in-process via typed `EventEmitter` | Singleton — one per machine |
| **Channel Server** (`channel-server/`) | MCP stdio server registering `claude/channel/permission` capability; relays permission prompts to the daemon and long-polls for the verdict | One per Claude Code session |
| **Bot** (`bot/`) | grammy bot subscribed to daemon's queue + registry events; renders 3-button keyboards; handles `callback_query` and bot commands | Single instance inside daemon |
| **Shared** (`shared/`) | Cross-workspace types and protocol constants (`PERMISSION_OPTION_IDS`, `encode/parseCallbackData`, `Result<T, E>`) | Type-only — Bun-native, no compiled output |

Daemon ↔ bot is **in-process** (typed `EventEmitter`, not HTTP). Channel server ↔ daemon is HTTP with `AbortSignal`-aware long polling. Telegram callback data is `cg:<requestId>:<optionId>` (within the 64-byte API limit, UUID-validated).

## Features (v0.1)

- ✅ Multi-session registration via `CLAUDEGRAM_SESSION_NAME` env var (auto on startup, deregister on shutdown)
- ✅ Native permission forwarding for `file_edit` / `bash` / `mcp_tool` with `Yes` / `Yes, all <category>` / `No` buttons (PRD F2)
- ✅ Session-scoped `yes_all` allowlist — subsequent same-category permissions auto-allow without daemon round-trip
- ✅ TTL expiry (5 min default) and graceful idempotency on Telegram retries
- ✅ Telegram allowlist gate (single-user trust model) with answered-callback ack for unauthorized clicks
- ✅ Bot commands: `/sessions`, `/pending`, `/cancel <id>`, `/cancel_all`
- ✅ Session lifecycle Telegram notifications (`Session registered: name`, `Session ended: name`)
- ✅ Hardened input boundary: zod everywhere, byte-bounded callback data, scheme-restricted URLs (`http|https`), `MAX_SAFE_INTEGER` user-ID guard, control-char rejection, 4096-byte Telegram message budget

## Setup

Requires **Bun** (>= 1.0) and a Telegram bot token from [@BotFather](https://t.me/BotFather).

```bash
# 1. Install workspaces
bun install

# 2. Configure
cp .env.example .env
# fill TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWLIST (your numeric Telegram user ID — message @userinfobot to get it)

# 3. Run daemon
bun run daemon/src/index.ts
# stderr will report: Config loaded → PID lock → HTTP listening on 3582 → bot started
```

To wire a Claude Code session, point its MCP config at the channel server with the session name in the env:

```bash
CLAUDEGRAM_SESSION_NAME=api-refactor bun run channel-server/src/index.ts
# (typically Claude Code launches this for you per its mcp config)
```

The daemon must be running before any channel server starts; the channel server fail-fasts with a clear error if `CLAUDEGRAM_DAEMON_URL` (default `http://localhost:3582`) is unreachable.

### Environment

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `TELEGRAM_BOT_TOKEN` | yes | — | from @BotFather |
| `TELEGRAM_ALLOWLIST` | yes | — | comma-separated Telegram user IDs (positive integers, ≤ `Number.MAX_SAFE_INTEGER`) |
| `CLAUDEGRAM_PORT` | no | `3582` | daemon HTTP port |
| `CLAUDEGRAM_DAEMON_URL` | no | `http://localhost:3582` | channel server uses this; must be `http://` or `https://` |
| `CLAUDEGRAM_SESSION_NAME` | yes (channel server only) | — | human-readable name shown in every Telegram message |

## Status

v0.1 core loop (Phase 1A → 3C) is complete and committed. Remaining for v1.0:

- [ ] Phase 2D — Unit tests for queue + registry
- [ ] Phase 4A — End-to-end test against real Claude Code sessions
- [ ] Phase 4C — Graceful shutdown ordering (cancel pendings → notify Telegram → bot.stop → queue.destroy → release PID)
- [ ] Phase 4D — `launchd` plist + CLI (`start` / `stop` / `status` / `configure`)

Phase 4B (atomic JSON state persistence) is intentionally deferred to v0.2 — pending decisions cannot survive restart (TTL state is lost) and registered sessions reference dead Claude Code processes.

## Non-Goals (v1)

- Not a chat bridge — no arbitrary message forwarding between Telegram and Claude Code
- Not a task trigger — cannot start new Claude Code sessions from Telegram
- Not multi-user — single user, single bot
- Not a cloud service — runs locally only

## Project Layout

```
claudegram/
├── shared/              # cross-workspace types + protocol constants
├── daemon/              # singleton HTTP server + queue + registry + bot host
├── channel-server/      # per-session MCP stdio relay
├── bot/                 # grammy bot (subscribed to daemon's events)
├── docs/
│   ├── PRD.md           # product requirements
│   └── progress/        # phase-by-phase development log
└── .env.example
```

## License

Private project. Not for redistribution.
