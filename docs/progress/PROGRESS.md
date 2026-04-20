## Project: Frontend CSP Fix (self-host CanvasKit + drop Roboto CDN)

## Spec Files
- Verbal: Frontend console errors — CSP blocks `gstatic.com/flutter-canvaskit/*` (CanvasKit JS/WASM) and `fonts.gstatic.com/*` (Roboto woff2). Dev harness: `./dev.sh`. Fix by self-hosting (Plan A).

## Plan File
- Inline below (small fix, no separate PLAN-*.md).

## Project Structure
- `scripts/build-frontend.sh` — runs `flutter build web --release --base-href /`
- `scripts/dev.sh` — calls build-frontend.sh then starts Bun server
- `current/claude-harbor-frontend/` — Flutter web app (lib/, web/, pubspec.yaml)
- `current/claude-harbor-server/src/http-static.ts:251` — CSP: `connect-src 'self' ws: wss:; ...; script-src 'self' 'wasm-unsafe-eval'`
- Build output: `current/claude-harbor-frontend/build/web/` (contains `canvaskit/` locally already)

## DESIGN.md
- Yes — `docs/DESIGN.md`. Typography: Arial + system-ui stack. NOT Roboto. All UI changes must follow it.

## Current Phase: csp-fix

## Interruption Reason
<!-- empty -->

## Review Roster (fixed at kickoff)
- Code Review: typescript-reviewer (for build-frontend.sh + any ts) + flutter-reviewer (for Dart changes)
- Security Review: security-reviewer (CSP posture, no CDN re-enable)
- Functional Coverage: functional-coverage (rebuild + console clean + app renders)

## What's Done
- [x] T1+T2+T3: `scripts/build-frontend.sh` now passes `--no-web-resources-cdn`; rebuild produces local `build/web/canvaskit/{canvaskit.js,canvaskit.wasm}` (7.1 MB wasm). `flutter_bootstrap.js` has `"useLocalCanvasKit":true`; gstatic URL is a dead ternary branch (no runtime fetch). `fontFamily: 'Arial'` was already in `lib/theme/mistral_theme.dart:256` and propagates cleanly through theme. — code ✅ sec ✅ func ✅ — commit 154e0a8
- [x] T4+T5: Reviews done. Server runtime verified: `GET /` → 200 + strict CSP; `GET /canvaskit/canvaskit.wasm` → 200 `application/wasm`.

## What's Done (cont.)
- [x] F1: Bundled Noto Sans SC (16 MB) + Noto Emoji mono (~409 KB) as local assets; registered via pubspec.yaml; wired `fontFamilyFallback: ['NotoSansSC', 'NotoEmoji']` in `mistral_theme.dart:257` after `fontFamily: 'Arial'`. Build produces `build/web/assets/assets/fonts/{NotoSansSC-Regular.otf, NotoEmoji-Regular.ttf}`; Bun serves 200 + exact content-length. CSP unchanged. — code ✅ sec ✅ func ✅ — commit 96d656a

## What's Done (cont.)
- [x] F1.5: Register Roboto locally (`assets/fonts/Roboto-Regular.ttf`, 515 KB from googlefonts/roboto) to satisfy Flutter engine init's hardcoded Roboto fetch (runs BEFORE ThemeData applies, so `fontFamily: 'Arial'` can't suppress it). Fix `HarborApiClient._resolve` double-slash when `base.path == '/'` → `/sessions` requests no longer fall through to SPA → app now reaches the harbor API correctly. — code ✅ sec ✅ func ✅ — commit 6fcb39c

## Notes / Gotchas (cont.)
- Flutter Web's engine has a built-in Roboto registration that runs at init, independent of ThemeData. Only way to stop the gstatic fetch is to have `Roboto` listed in FontManifest (via pubspec asset). Arial-as-theme-default alone is insufficient.
- `HEAD /sessions` still falls through to SPA (separate minor server routing bug — real clients use GET and are unaffected). Can be filed as a separate ticket.
- Residual: `fontFallbackBaseUrl` default in `main.dart.js` is still `fonts.gstatic.com/s/` for glyphs outside all registered families — covered by F2 scope.

## Next Steps
- [ ] F2 (follow-up, needs user decision — "遇到再说"): Remaining glyph gaps that will still tofu under strict CSP:
  - **Japanese/Korean kana/hangul** — Noto Sans SC does not cover U+3040–U+30FF (Hiragana/Katakana) or U+AC00–U+D7AF (Hangul). Add NotoSansJP + NotoSansKR (~10 MB each) if in scope.
  - **Color emoji** — currently monochrome line-style. Swap to NotoColorEmoji (~10 MB) if design requires color.
  - **Math symbols (U+2200–U+22FF, U+1D400+)** — LaTeX-rendered math by Claude will miss. Add Noto Sans Math (~450 KB) if in scope.
  - **Newest Unicode emoji** (post-v2.034 additions, e.g. U+1FAE8 shaking face) — tofu.
  - **Regional flag sequences (U+1F1E6+)** — NotoEmoji mono lacks flag glyphs.
- [ ] Optional hardening (non-blocking): (a) Subset NotoSansSC to observed codepoints via `pyftsubset` (~2-4 MB → ~10 MB saved); (b) pin CJK source to a tagged release + add `assets/fonts/CHECKSUMS.txt`; (c) add server test asserting CSP header + static `/canvaskit/canvaskit.wasm` serve; (d) add `flutter --version` guard in `build-frontend.sh` for Flutter 3.24+.

## Notes / Gotchas
- `lockdown-install.js` SES warnings are from browser extensions (MetaMask/etc) — not our code. Ignore.
- Do NOT relax CSP to allow `www.gstatic.com` / `fonts.gstatic.com`; preserving internal-net same-origin posture is a project invariant.
- Flutter 3.41+ removed `--web-renderer`; renderer is per-platform auto.
- `--no-web-resources-cdn` is a `flutter build web` flag that rewrites `flutter_bootstrap.js` to load CanvasKit from app's own `canvaskit/` path.
- For Dart font change: look for `MaterialApp` / `ThemeData` in `lib/main.dart` or a theme file; set `fontFamily: 'Arial'`. Arial exists as a system font in all major browsers; Flutter Web will resolve it via the browser without a network fetch.

## Next Agent Prompt
<!-- T1+T2 combined brief below, dispatched to opus coder -->

## Orchestrator Rules (for future sessions)
On restart, still follow:
1. Orchestrator only — never write code/docs yourself
2. After every sub-agent delivery, run code + security + functional reviews, then have a sub-agent fix all findings
3. Commit as soon as a task clears review — do not wait for the user
4. Auto-advance until the context window is near its limit; no need to ask for approval each step
5. Keep PROGRESS.md live
6. When all tasks are done, move PROGRESS.md to docs/archive/PROGRESS-[name]-[YYYYMMDD].md
