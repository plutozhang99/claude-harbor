# claudegram

Personal, locally-run bridge that lets you read and reply to your Claude Code sessions from any device — without trusting a public chat platform with your message stream.

This repo is split into two tracks:

```
claudegram/
├── legacy/     # v0 — Telegram bot bridge focused on permission prompts
└── current/    # v1 — PWA + multi-session aggregator, CF Access gated
    ├── fakechat/     # per-session MCP channel (fork of fakechat plugin)
    └── claudegram/   # independent server (history, PWA, push, auth)  [to build]
```

## Why two tracks

`legacy/` is **v0**: a Telegram-bot-based permission-prompt bridge. It works (phase 1A–3C complete, see `legacy/README.md`) but locks the frontend to Telegram and ties message delivery to Telegram's infrastructure. It stays here, archived, as reference.

`current/` is **v1**: a redesign driven by two realizations.

1. **fakechat and claudegram are different things.** fakechat is a per-session chat channel that lives and dies with a Claude Code session. claudegram is a long-lived server that aggregates messages from all sessions, stores history, and pushes to a PWA. v0 conflated the two.
2. **We don't trust public bot platforms.** Telegram sees every message. A leaked bot token impersonates you. The whole point of running our own bridge is to keep the message stream on infrastructure we control, gated by Cloudflare Access (email-SSO allowlist at the edge, no secret-sharing with a third-party bot backend).

## Current architecture (v1, target)

```
Mac (developer machine)
  Claude session A ─stdio─> fakechat A ─┐
  Claude session B ─stdio─> fakechat B ─┤ HTTP webhook + reverse WebSocket
  Claude session C ─stdio─> fakechat C ─┘          │
                                                   ▼
  claudegram server (local launchd now, NAS/VPS later)
    SQLite history · WebSocket ↔ PWA · Web Push (VAPID)
                                                   │
                                       cloudflared + CF Access
                                                   │
                                                   ▼
                                           PWA (any device)
```

fakechat stays simple: opt-in webhook to claudegram (`CLAUDEGRAM_URL`) + reverse WebSocket for user replies. Without that env var set, fakechat is pure-local (matches upstream plugin behavior).

claudegram is the independent service — authentication, storage, UI, push. Designed from day one to be relocatable from localhost to an independent server (Pi / NAS / VPS) without rewriting fakechat.

Full design spec, protocols, roadmap, and tradeoff rationale: **[docs/request_v1.md](docs/request_v1.md)**.

## Status

- `legacy/` — v0, archived. Still runnable per its own README.
- `current/fakechat/` — seeded from the [fakechat plugin](https://github.com/anthropics/claude-plugins-official) (Apache-2.0). Will be lightly extended with the claudegram webhook hook.
- `current/claudegram/` — to build. Start from `docs/request_v1.md`.

## License

Private project. `legacy/` is private. `current/fakechat/` carries its upstream Apache-2.0 license.
