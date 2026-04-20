#!/usr/bin/env bash
# claude-harbor-client one-shot installer.
#
# Usage:
#   ./install.sh                                # interactive, prompts for HARBOR_URL
#   ./install.sh http://harbor.local:7823       # pass URL as positional arg
#   ./install.sh --harbor-url http://... --dry-run --skip-settings --yes
#
# What it does:
#   1. Checks bun + claude are installed.
#   2. Runs `bun install` in each package.
#   3. Runs `bun link` in each package that ships a bin (exposes it).
#   4. Runs `bun link <name>` so the shims land on your PATH.
#   5. Optionally runs `claude-harbor-install install --harbor-url <url>` to
#      wire ~/.claude/settings.json.
#   6. Prints the shell-profile line you still need to add for HARBOR_URL.
#
# Re-runs are safe — every step is idempotent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_PKGS=(wrapper proxy hook statusline installer)
LINKED_BINS=(claude-harbor claude-harbor-hook claude-harbor-statusline claude-harbor-install)

HARBOR_URL=""
DRY_RUN=0
SKIP_SETTINGS=0
ASSUME_YES=0

# ─── colour helpers ──────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_RED=$'\e[31m'; C_YEL=$'\e[33m'; C_GRN=$'\e[32m'; C_BLU=$'\e[34m'; C_DIM=$'\e[2m'; C_RST=$'\e[0m'
else
  C_RED=""; C_YEL=""; C_GRN=""; C_BLU=""; C_DIM=""; C_RST=""
fi
info()  { printf '%s[harbor]%s %s\n'  "$C_BLU" "$C_RST" "$*"; }
warn()  { printf '%s[harbor]%s %s\n'  "$C_YEL" "$C_RST" "$*" >&2; }
err()   { printf '%s[harbor]%s %s\n'  "$C_RED" "$C_RST" "$*" >&2; }
ok()    { printf '%s[harbor]%s %s\n'  "$C_GRN" "$C_RST" "$*"; }
dim()   { printf '%s%s%s\n'           "$C_DIM" "$*" "$C_RST"; }
run()   {
  dim "  \$ $*"
  if [[ $DRY_RUN -eq 0 ]]; then "$@"; fi
}

usage() {
  cat <<EOF
claude-harbor-client installer

Usage: $0 [--harbor-url URL] [--dry-run] [--skip-settings] [--yes] [URL]
       $0 --help

Options:
  --harbor-url URL   Harbor server base URL (http:// or https://). Can also be
                     passed as the first positional argument.
  --dry-run          Print every command without executing.
  --skip-settings    Don't run claude-harbor-install install at the end.
  --yes, -y          Don't prompt; assume defaults where possible.
  --help, -h         Show this help.
EOF
}

# ─── arg parsing ─────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --harbor-url)     HARBOR_URL="${2:-}"; shift 2;;
    --harbor-url=*)   HARBOR_URL="${1#*=}"; shift;;
    --dry-run)        DRY_RUN=1; shift;;
    --skip-settings)  SKIP_SETTINGS=1; shift;;
    --yes|-y)         ASSUME_YES=1; shift;;
    --help|-h)        usage; exit 0;;
    --*)              err "unknown flag: $1"; usage; exit 2;;
    *)
      if [[ -z "$HARBOR_URL" ]]; then HARBOR_URL="$1"; shift
      else err "unexpected arg: $1"; usage; exit 2
      fi;;
  esac
done

# ─── prerequisite checks ─────────────────────────────────────────────────────
info "checking prerequisites"

if ! command -v bun >/dev/null 2>&1; then
  err "bun is not on PATH. Install from https://bun.sh then re-run."
  exit 1
fi
BUN_VERSION="$(bun --version 2>/dev/null || echo 'unknown')"
ok "bun $BUN_VERSION"

if ! command -v claude >/dev/null 2>&1; then
  warn "claude is not on PATH. The wrapper will need CLAUDE_BIN set at runtime, or install Claude Code first."
else
  ok "claude $(claude --version 2>/dev/null | head -1 || echo 'version unknown')"
fi

BUN_GLOBAL_BIN="$(bun pm -g bin 2>/dev/null || true)"
if [[ -n "$BUN_GLOBAL_BIN" && ":$PATH:" != *":$BUN_GLOBAL_BIN:"* ]]; then
  warn "Bun's global bin dir is NOT on PATH: $BUN_GLOBAL_BIN"
  warn "After install, add this to ~/.zshrc or ~/.bashrc:"
  warn "  export PATH=\"$BUN_GLOBAL_BIN:\$PATH\""
fi

# ─── HARBOR_URL resolution ────────────────────────────────────────────────────
if [[ -z "$HARBOR_URL" && $SKIP_SETTINGS -eq 0 ]]; then
  if [[ $ASSUME_YES -eq 1 ]]; then
    SKIP_SETTINGS=1
    warn "--yes given without --harbor-url; skipping settings.json step"
  else
    printf '\n%s[harbor]%s Harbor server URL (e.g. http://localhost:7823): ' "$C_BLU" "$C_RST"
    read -r HARBOR_URL </dev/tty || true
    if [[ -z "$HARBOR_URL" ]]; then
      warn "no URL entered; skipping settings.json step"
      SKIP_SETTINGS=1
    fi
  fi
fi

if [[ -n "$HARBOR_URL" ]]; then
  case "$HARBOR_URL" in
    http://*|https://*) :;;
    *) err "HARBOR_URL must start with http:// or https:// (got: $HARBOR_URL)"; exit 2;;
  esac
fi

# ─── install + link each package ─────────────────────────────────────────────
for pkg in "${CLIENT_PKGS[@]}"; do
  dir="$SCRIPT_DIR/$pkg"
  if [[ ! -d "$dir" ]]; then
    err "missing package dir: $dir"
    exit 1
  fi
  info "install deps: $pkg"
  run bash -c "cd '$dir' && bun install"
done

for pkg in "${CLIENT_PKGS[@]}"; do
  dir="$SCRIPT_DIR/$pkg"
  if [[ ! -f "$dir/package.json" ]]; then continue; fi
  if ! grep -q '"bin"' "$dir/package.json"; then
    dim "  $pkg has no bin entry; skipping bun link"
    continue
  fi
  info "expose bin: $pkg"
  run bash -c "cd '$dir' && bun link"
done

info "link shims onto PATH"
for bin in "${LINKED_BINS[@]}"; do
  run bun link "$bin"
done

# ─── verify ──────────────────────────────────────────────────────────────────
info "verifying"
if [[ $DRY_RUN -eq 0 ]]; then
  for bin in "${LINKED_BINS[@]}"; do
    if command -v "$bin" >/dev/null 2>&1; then
      ok "$bin -> $(command -v "$bin")"
    else
      err "$bin not found on PATH after linking"
      err "add Bun's global bin to PATH (see warning above) and re-run this script, or invoke the binaries directly from each package"
      exit 1
    fi
  done
fi

# ─── write settings.json ─────────────────────────────────────────────────────
if [[ $SKIP_SETTINGS -eq 0 && -n "$HARBOR_URL" ]]; then
  info "writing ~/.claude/settings.json entries"
  if [[ $DRY_RUN -eq 1 ]]; then
    run claude-harbor-install install --harbor-url "$HARBOR_URL" --dry-run
  else
    run claude-harbor-install install --harbor-url "$HARBOR_URL"
  fi
else
  warn "skipped settings.json step"
fi

# ─── next steps ──────────────────────────────────────────────────────────────
printf '\n'
ok "install complete"
printf '\n'
printf 'Next steps:\n'
if [[ -n "$HARBOR_URL" ]]; then
  printf '  1. Add this line to your shell profile (~/.zshrc or ~/.bashrc):\n\n'
  printf '        export HARBOR_URL=%s\n\n' "$HARBOR_URL"
fi
printf '  2. Open a new shell, then launch CC with:\n\n'
printf '        claude-harbor start\n\n'
printf '     (passes all args through to the real claude, plus the channel plugin)\n\n'
printf 'To reverse: ./uninstall.sh\n'
