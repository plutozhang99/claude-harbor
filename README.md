# claude-harbor

A remote aggregator that displays multiple live Claude Code (CC) sessions on a mobile-first PWA with push notifications (P3). Designed to run on a machine separate from the ones running CC.

> This project has been discontinued due to overlapping functionality with Claude Code's remote-control feature. For more details, see https://code.claude.com/docs/en/remote-control

Three packages, one repo:

| Path | What |
|---|---|
| [`current/claude-harbor-server/`](./current/claude-harbor-server/) | Bun HTTP + WS + SQLite server. Serves the frontend bundle at `/`. |
| [`current/claude-harbor-client/`](./current/claude-harbor-client/) | Per-machine binaries: wrapper, hook, statusline, MCP channel proxy, installer. |
| [`current/claude-harbor-frontend/`](./current/claude-harbor-frontend/) | Flutter Web PWA (P2). Mobile apps are P4. |

See [`docs/plans/PLAN-claude-harbor.md`](./docs/plans/PLAN-claude-harbor.md)
and [`docs/DESIGN.md`](./docs/DESIGN.md) for architecture and visual
language.

---

## Quick Start

```bash
# 1. Start server (frontend already built — skip Flutter rebuild)
./scripts/dev.sh --skip-build
# → open http://127.0.0.1:7823/ in a browser

# 2. Wire up Claude Code on this machine
HARBOR_URL=http://127.0.0.1:7823 \
  current/claude-harbor-client/install.sh

# 3. Launch a monitored CC session
claude-harbor start
```

That's it. The browser dashboard live-updates as Claude Code sessions run.

---

## Getting Started (P2)

### Prerequisites

- [Bun](https://bun.sh) 1.3+
- [Flutter](https://flutter.dev) 3.x (tested on 3.41.6 / Dart 3.11.4)

### Build + run

```bash
# One-shot build of the Flutter PWA into
#   current/claude-harbor-frontend/build/web/
./scripts/build-frontend.sh

# Build, then start the server with the bundle served at `/`.
./scripts/dev.sh

# Skip the Flutter build step (uses whatever is already in build/web/).
./scripts/dev.sh --skip-build
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `HARBOR_PORT` | `7823` | TCP port to listen on |
| `HARBOR_BIND` | `127.0.0.1` | Bind address. Set `0.0.0.0` to expose on all interfaces (LAN access) |
| `HARBOR_ADMIN_TOKEN` | _(none)_ | Required when `HARBOR_BIND` is non-loopback. Any string works |
| `HARBOR_ALLOW_UNSAFE_BIND` | _(none)_ | Set `1` to skip the admin token requirement on non-loopback binds |
| `HARBOR_DB_PATH` | `./data/harbor.db` | SQLite database file path |
| `HARBOR_FRONTEND_ROOT` | `build/web/` | Override path to Flutter static bundle |
| `HARBOR_DEV` | _(none)_ | Set `1` to enable permissive GET CORS (loopback only, for `flutter run -d chrome`) |
| `HARBOR_CORR_WINDOW_MS` | `10000` | Correlation window in ms for matching hooks to sessions |

**LAN example:**
```bash
HARBOR_BIND=0.0.0.0 HARBOR_ADMIN_TOKEN=mysecret ./scripts/dev.sh --skip-build
# → http://<your-lan-ip>:7823/
```

Once the server is up, open `http://127.0.0.1:7823/` in a browser. The
session list loads over REST and live-updates via `WS /subscribe`.

### Dev-mode CORS

Set `HARBOR_DEV=1` on a loopback-bound server to enable permissive CORS
on GET routes only (lets you run `flutter run -d chrome` against a Bun
server on a different port). Never applied to POST; never applied on
non-loopback binds.

### Wire up a local Claude Code

On each machine that runs CC:

```bash
# Install hooks + statusline + MCP channel into ~/.claude/settings.json.
# Points the client at your running server.
./current/claude-harbor-client/install.sh

# Launch a wrapped CC session.
claude-harbor start
```

See [`current/claude-harbor-client/README.md`](./current/claude-harbor-client/README.md)
for installer details and
[`current/claude-harbor-client/uninstall.sh`](./current/claude-harbor-client/uninstall.sh)
for clean revert.

---

## Security notes

**`HARBOR_FRONTEND_ROOT` operator warning:** The server serves every file under
`HARBOR_FRONTEND_ROOT` recursively. Only point it at a trusted Flutter
`build/web/` output. Never set it to `/`, `/etc`, `/proc`, or a home directory
— any file beneath that root becomes publicly readable via the static serve.

**`--dart-define=HARBOR_ADMIN_TOKEN` compile-embedding warning:** Passing
`HARBOR_ADMIN_TOKEN` via `flutter build web --dart-define=HARBOR_ADMIN_TOKEN=...`
embeds the token as a plain-text string in the shipped JavaScript bundle. This
is acceptable only on a trusted internal network (the default P2 deployment).
For any internet-reachable or shared-network deployment, do NOT compile the
token into the bundle; front the server with a reverse proxy that performs its
own authentication, and leave the token out of the build.

**Reverse-proxy recommendation:** For any non-loopback deployment, run the
server behind a reverse proxy that terminates TLS and enforces its own
authentication layer. `HARBOR_BIND=0.0.0.0` without a proxy is supported only
with `HARBOR_ADMIN_TOKEN` set (or the `HARBOR_ALLOW_UNSAFE_BIND=1` escape hatch).

---

## Tests

```bash
# Server
cd current/claude-harbor-server && bun test && bunx tsc --noEmit

# Frontend
cd current/claude-harbor-frontend && flutter analyze && flutter test
```

---

## Phase status

- P0, P1 — done (server skeleton, hooks, correlation, account_hint).
- P2 — done (Flutter PWA scaffold → data layer → session list → detail →
  build integration).
- **P3 — next.** Web Push (VAPID) + notification policy.
- P4 — mobile builds (iOS + Android via Flutter).
- P5 — multi-user / multi-project (future).

Completed phases are archived under
[`docs/archive/`](./docs/archive/). `docs/progress/PROGRESS.md` is
created fresh when a new phase starts. See
[`docs/plans/PLAN-claude-harbor.md`](./docs/plans/PLAN-claude-harbor.md)
for phase plans.
