# PLAN: claude-harbor

**Last Updated:** 2026-04-19

---

## 1. Project Summary

**claude-harbor** is a remote aggregator that surfaces multiple live Claude Code (CC) sessions on one mobile-first frontend with push notifications. The aggregator runs on a machine separate from where CC runs.

Use-case: user runs CC in 3 different repos on their laptop; they see all 3 sessions on their phone and can answer Claude's questions from anywhere.

Internal network only, single user for now. Multi-user / multi-project is a future phase.

---

## 2. Architecture

```
LOCAL (per CC instance)                    REMOTE SERVER
────────────────────────                   ───────────────────────────────
claude-harbor CLI wrapper                   HTTP:
  └─ exec claude --channels=                  POST /hooks/session-start
     plugin:claude-harbor@local [args]        POST /hooks/user-prompt-submit
                                              POST /hooks/pre-tool-use
CC process                                    POST /hooks/post-tool-use
  ├─ hooks (installed once) ──HTTP──►         POST /hooks/stop
  │   SessionStart, UserPromptSubmit,         POST /hooks/session-end
  │   PreToolUse, PostToolUse, Stop,          POST /statusline  (returns line to stdout)
  │   SessionEnd, Notification              WS:
  ├─ statusline exec ────────HTTP──►          /channel/{channel_token}
  │                                         STORE: SQLite
  └─ stdio MCP channel subprocess           PUSH: Web Push (VAPID) now; FCM later
      (claude-harbor-ch) ─────WS──►         STATIC: serves Flutter web bundle
                                            REST+WS for frontend

FRONTEND (Flutter — Web PWA first, then iOS/Android)
  ├─ Session list (aggregated live sessions)
  ├─ Session detail: model, context %, 5h/7d limits, cost, cwd
  ├─ Two-way chat per session
  ├─ Compose → channel reply tool call (slash-command text is just text)
  └─ Push subscriptions
```

---

## 3. Components

| Component | Language/Stack | Purpose |
|---|---|---|
| `claude-harbor` CLI wrapper | Bun single-file | User runs `claude-harbor start [args]`; exec's `claude` with channels plugin |
| `claude-harbor-ch` stdio MCP proxy | Bun single-file | Spawned by CC as channel; opens WS to remote, forwards notifications both ways |
| `claude-harbor-hook` binary | Bun single-file | Invoked by CC hooks; POSTs payload to remote |
| `claude-harbor-statusline` binary | Bun single-file | Invoked by CC statusline; POSTs stdin JSON to remote, echoes rendered line back |
| Remote server | Bun + TypeScript | HTTP + WS + SQLite + Web Push; serves Flutter bundle |
| Frontend | Flutter 3.x (Material 3) | Web PWA + iOS/Android apps from one codebase |

---

## 4. Session Registration & Correlation

CC does NOT inject `session_id`, `model`, or `cwd` into `<channel>` tags. So we correlate by matching hook-reported session metadata with channel connection metadata.

On CC launch via `claude-harbor start`:

1. `SessionStart` hook POSTs `{session_id, cwd, pid, transcript_path, ts}` to `/hooks/session-start`. Remote creates session row, returns `channel_token`.
2. `claude-harbor-ch` subprocess (spawned by CC) opens WS to `/channel`, sends handshake `{parent_pid, cwd, ts}`.
3. Remote matches handshake by `(cwd + parent_pid)` against recent SessionStart events. On match, binds the channel connection to the session.

- If match fails within N seconds, channel is shown as "unbound" in frontend (degraded mode).
- User running raw `claude` (without wrapper) has hooks firing but no channel — session appears read-only in frontend; replies are disabled.

---

## 5. Per-session Metadata Pipeline

`statusline` is the ONLY surface that exposes model + context-window + 5h/7d rate limits + cost. CC renders statusline after each assistant message (debounced 300ms).

- `claude-harbor-statusline` binary reads stdin JSON, POSTs to `/statusline`, and echoes a short pretty-printed line back to stdout (so CC's terminal statusline still works).
- Remote persists the latest snapshot per `session_id`; frontend subscribes via WS for live updates.

Fields captured: `model.id`, `model.display_name`, `context_window.used_percentage`, `context_window.context_window_size`, `rate_limits.five_hour.*`, `rate_limits.seven_day.*`, `cost.total_cost_usd`, `cwd`, `workspace.project_dir`, `version`, `permission_mode`.

---

## 6. What We Dropped (Explicit Non-goals)

- **Account email identity** — not exposed by CC to hooks/statusline/env. Don't work around it.
- **CC auto-injecting session_id/model into channel tags** — CC doesn't. We correlate instead.
- **Remote `/model` switch** — no official route. Nice-to-have only. If added later, will send plain text and hope Claude runs the slash command.

---

## 7. `~/.claude/` Policy (CRITICAL)

- **Install-time only**: writing to `~/.claude/settings.json` to register hooks + statusline, and registering the channel plugin. Nothing else.
- **Runtime**: NEVER reads or writes `~/.claude/`. All state lives on the remote server and in the wrapper's own binaries.
- Uninstall must be clean — full revert of settings.json entries.

---

## 8. Data Model (SQLite on remote)

```sql
sessions (
  session_id TEXT PRIMARY KEY,
  channel_token TEXT UNIQUE,
  cwd TEXT,
  pid INTEGER,
  project_dir TEXT,
  account_hint TEXT,  -- filled by install-time `claude auth status --json`, stored on remote
  started_at INTEGER,
  ended_at INTEGER,
  latest_model TEXT,
  latest_ctx_pct REAL,
  latest_limits_json TEXT,
  latest_cost_usd REAL,
  latest_statusline_at INTEGER,
  status TEXT  -- active | idle | ended | unbound
)

messages (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  direction TEXT,  -- inbound (user→Claude via channel) | outbound (Claude→user via reply tool)
  content TEXT,
  meta_json TEXT,
  created_at INTEGER
)

tool_events (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  hook_event TEXT,  -- PreToolUse | PostToolUse | ...
  tool_name TEXT,
  tool_input_json TEXT,
  tool_output_json TEXT,
  permission_mode TEXT,
  created_at INTEGER
)

push_subscriptions (
  id INTEGER PRIMARY KEY,
  endpoint TEXT,
  keys_json TEXT,
  created_at INTEGER
)
```

---

## 9. Phase Breakdown

### P0 — Bootstrap (remote + proxy minimal)

- Remote Bun server skeleton: HTTP `/hooks/session-start`, `/statusline`, WS `/channel`, SQLite init.
- `claude-harbor-ch` stdio MCP proxy: connects to remote, forwards `notifications/claude/channel` and `reply` tool calls.
- `claude-harbor` CLI wrapper.
- Minimal install script: writes hooks + statusline + channel plugin to `~/.claude/settings.json`; idempotent.
- Manual test: run wrapper → session registers → send inbound message via WS → see in CC.

### P1 — Full hooks & session correlation

- All hook endpoints + payload persistence.
- `cwd + pid` correlation logic, plus unbound/idle state machine.
- `claude auth status --json` read at install-time, stored on remote as `account_hint`.
- SQLite schema + repository layer with tests.

### P2 — Flutter frontend scaffold

- Flutter 3.x project, target Web first. Material 3 with Mistral warm palette from `docs/DESIGN.md`.
- Session list with live WS updates.
- Session detail: chat pane, metadata pane (model, ctx %, limits, cost).
- Compose → outbound reply via REST.
- Responsive mobile-first layout.

### P3 — Push notifications

- Web Push (VAPID). Subscribe from PWA.
- Notification policy: push when Claude sends a `<channel>` reply to the user (via `reply` tool) and the browser tab is not focused.
- Per-session mute toggle.

### P4 — Mobile polish & packaging

- Flutter iOS + Android builds. FCM integration.
- App store packaging prep (icons, splash, permissions, privacy policy stub).
- PWA install prompt tuning.

### P5 — Multi-user / multi-project (future, out of immediate scope)

- Auth layer. Per-user session scoping. Project grouping.

---

## 10. Review Roster

Fixed at kickoff:

- Code review: **typescript-reviewer** (backend + proxies + hooks) and **flutter-reviewer** (frontend)
- Security review: **security-reviewer**
- Functional coverage: **functional-coverage** skill
- Architecture: **architect** agent for phase-boundary decisions

---

## 11. Open Research Items

- Channel plugin registration: the exact JSON shape for registering a local-filesystem channel plugin in `~/.claude/settings.json` (vs. going through Anthropic's marketplace). Needs an experiment early in P0.
- `--dangerously-load-development-channels` requirement during development: confirm whether the install script needs to toggle this or whether local registration bypasses allowlist.
- Statusline refresh rate and whether a 300ms debounce causes missed push triggers (probably fine, flag for P3 review).
- Web Push on iOS 16.4+ PWA: confirm VAPID flow works for user's phone specifically before P4.
