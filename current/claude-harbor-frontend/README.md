# claude-harbor-frontend

Flutter Web PWA for [claude-harbor](../../README.md). Consumes the Bun
server's REST + WS surfaces to render live CC sessions, chat history, and
compose outbound replies.

Paired server: [`../claude-harbor-server/`](../claude-harbor-server/).
Design system: [`../../docs/DESIGN.md`](../../docs/DESIGN.md) — Mistral
warm palette, weight 400 only, zero-radius everywhere.

## Stack

- Flutter 3.x (tested on 3.41.6 / Dart 3.11.4). Web target first; mobile
  arrives in P4.
- Riverpod 2.x for state, `http` for REST, `web_socket_channel` for WS.

## Development

Run against a local server bound on a different port:

```bash
flutter run -d chrome \
  --dart-define=HARBOR_BASE_URI=http://127.0.0.1:7823 \
  --dart-define=HARBOR_ADMIN_TOKEN=<token-if-server-has-one>
```

**Warning:** `--dart-define=HARBOR_ADMIN_TOKEN=...` compiles the token into the
shipped JS bundle. Safe for loopback/trusted-network use only; do not ship a
production bundle with a real token for public deployment.

Start the server with `HARBOR_DEV=1` on loopback to get permissive CORS
on GET (POST stays same-origin; see server README).

Defaults (when `--dart-define` is omitted): base URI is inferred from the
current origin, so the app is fully same-origin when served from the
production Bun build.

## Production build

From the repo root:

```bash
./scripts/build-frontend.sh
```

Output lands at `build/web/` and is served by the Bun server when it
boots (override with `HARBOR_FRONTEND_ROOT`).

## Tests

```bash
flutter test       # unit + widget tests (~96 cases)
flutter analyze    # lints + type check; must be clean
```

## Layout

```
lib/
├── main.dart                 # ProviderScope + MaterialApp
├── theme/mistral_theme.dart  # DESIGN.md palette + typography tokens
├── models/                   # Session, Message, Statusline, RateLimits
├── services/
│   ├── harbor_api_client.dart  # REST client
│   └── harbor_live_service.dart# WS /subscribe with reconnect + heartbeat
├── repositories/             # SessionRepository, MessageRepository
├── providers/                # Riverpod providers
├── screens/                  # list + detail screens
└── widgets/                  # SectionLabel, skeletons, etc.
```

See [`../../docs/plans/PLAN-claude-harbor.md`](../../docs/plans/PLAN-claude-harbor.md)
§9 P2 for the phase spec and
[`../../docs/progress/PROGRESS.md`](../../docs/progress/PROGRESS.md) for
the live task board.
