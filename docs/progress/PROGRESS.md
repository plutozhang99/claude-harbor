## Project: claude-harbor

## Spec Files
- `docs/plans/PLAN-claude-harbor.md` — full architecture + phase plan
- `docs/CHANNELS-REFERENCE.md` — CC channel/hook/statusline research (2026-04-19)
- `docs/DESIGN.md` — Mistral-inspired warm amber/orange palette (frontend must follow)

## Plan File
- `docs/plans/PLAN-claude-harbor.md`

## Project Structure
```
/ (repo root; will be renamed to claude-harbor after session reopen)
├── current/
│   └── claude-harbor/        ← new code goes here (empty skeleton)
├── legacy/
│   ├── <pre-existing V0 dirs: bot, daemon, channel-server, shared, …>
│   └── V1-claudegram-2026-04-19/   ← archived former claudegram + fakechat
├── docs/
│   ├── DESIGN.md             (Mistral warm palette — untouched)
│   ├── CHANNELS-REFERENCE.md (2026-04-19 CC surface research)
│   ├── plans/PLAN-claude-harbor.md
│   ├── progress/PROGRESS.md  (this file)
│   └── archive/
```

Tech stack: Bun + TypeScript (remote + local binaries), Flutter 3.x (frontend), SQLite, Web Push, FCM (later).

## DESIGN.md
YES — `docs/DESIGN.md`. All UI changes must follow the Mistral warm palette (ivory/cream/amber/orange, Arial-like type at weight 400, near-zero border-radius, golden multi-layer shadows).

## Current Phase: P0 — Bootstrap

## Interruption Reason
<!-- empty -->

## Review Roster (fixed at kickoff)
- Code Review (backend/proxies/hooks): typescript-reviewer
- Code Review (frontend): flutter-reviewer
- Security Review: security-reviewer
- Functional Coverage: functional-coverage
- Architecture (phase boundaries): architect

## What's Done
- [x] V1 archival — `current/claudegram/` + `current/fakechat/` + root `README.md` + `docs/request_v1.md` moved to `legacy/V1-claudegram-2026-04-19/` (commit pending)
- [x] New skeleton `current/claude-harbor/` created
- [x] PLAN-claude-harbor.md written
- [x] PROGRESS.md rewritten

## Next Steps
- [ ] Rename GitHub repo `plutozhang99/claudegram` → `plutozhang99/claude-harbor` (gh repo rename)
- [ ] Update local `git remote set-url origin`
- [ ] Rename local dir `~/Documents/claudegram` → `~/Documents/claude-harbor` (LAST — user reopens CC from new path)
- [ ] P0.1: Remote Bun server skeleton — HTTP `/hooks/session-start`, `/statusline`, WS `/channel`, SQLite bootstrap
- [ ] P0.2: `claude-harbor-ch` stdio MCP proxy — connects to remote, forwards notifications + reply
- [ ] P0.3: `claude-harbor` CLI wrapper — `claude-harbor start [args]` → exec claude with channels
- [ ] P0.4: Install script — writes `~/.claude/settings.json` hooks + statusline + channel plugin; idempotent; includes uninstall

## Notes / Gotchas
- **Dropped features (do not rebuild):** account email identification, CC session_id/model auto-injection into channel tags, remote `/model` slash switch.
- **~/.claude policy:** writes only at install/uninstall time. Runtime NEVER touches it.
- **Session correlation:** hooks and channel subprocess are independent streams from CC; remote correlates by `cwd + parent_pid`. Test both match paths and mismatch (unbound) paths early.
- **Statusline is the only surface for model / ctx-% / rate-limits / cost.** Hooks don't expose them. Design backend accordingly.
- **Wrapper-only contract:** users running raw `claude` get hooks firing but no channel; frontend shows degraded (read-only) sessions. This is deliberate.
- **DESIGN.md is authoritative for UI** — Mistral warm palette, no cool colors, weight 400 only, sharp corners.

## Next Agent Prompt
Kick off P0.1 remote server skeleton. Prompt:

> You are implementing Phase P0.1 of claude-harbor. Read `docs/plans/PLAN-claude-harbor.md` sections 2, 3, 4, 5, 8 first. Build a minimal Bun + TypeScript remote server in `current/claude-harbor/server/`:
>
> - HTTP endpoints: `POST /hooks/session-start` (accepts `{session_id, cwd, pid, transcript_path, ts}`, creates session row, returns `{channel_token}`), `POST /statusline` (accepts full statusline stdin JSON, persists snapshot, returns `{line}` to echo back).
> - WS endpoint: `/channel` (handshake `{parent_pid, cwd, ts}`, correlates to pending session by `cwd+pid` match within 10s window, binds channel socket to session).
> - SQLite bootstrap per schema in PLAN §8 using `bun:sqlite`.
> - One inbound-message test: POST /admin/push-message `{session_id, content}` — sends a channel notification to the matched WS (next phase will wire to real CC).
> - Tests using `bun:test`: session-start creates row; statusline persists; WS correlation succeeds; WS correlation times out when no match.
> - NO auth, NO HTTPS yet (internal net only). NO Web Push yet.
> - Keep files <400 lines each. File layout: `server/src/{http.ts, ws.ts, db.ts, correlate.ts, index.ts}`, tests alongside.
>
> Use the typescript-patterns and bun-runtime skills. Do not implement hook binaries, proxy, or wrapper in this phase — just the server. Verify with `bun test` before reporting done.

## Orchestrator Rules (for future sessions)
On restart, still follow:
1. Orchestrator only — never write code/docs yourself; delegate to sub-agents.
2. After every sub-agent delivery, run code + security + functional reviews in PARALLEL as independent sub-agents, then have another sub-agent fix all findings. Max 3 review rounds before escalation.
3. Commit as soon as a task clears review — do not wait for user approval each time.
4. Auto-advance until context window is near its limit; no approval needed per step.
5. Keep this PROGRESS.md live — update at task start, task end, review result, commit.
6. When all P0–P4 tasks done, move `docs/progress/PROGRESS.md` to `docs/archive/PROGRESS-claude-harbor-[YYYYMMDD].md`.
7. Model routing: opus for coding/review/arch, sonnet for docs, haiku for commits/read-only exploration.
8. Reviews always parallel, never collapsed into one agent.
