#!/usr/bin/env bash
# claude-harbor-client uninstaller.
#
# Usage:
#   ./uninstall.sh                # interactive
#   ./uninstall.sh --dry-run --skip-settings --yes
#
# Reverses install.sh:
#   1. Runs `claude-harbor-install uninstall` to remove ~/.claude/settings.json entries.
#   2. `bun unlink <name>` for each shim.
#   3. `bun unlink` inside each package to de-register it.
#
# Leaves node_modules/ and bun.lock alone — remove by hand if you want to
# fully purge.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_PKGS=(wrapper proxy hook statusline installer)
LINKED_BINS=(claude-harbor claude-harbor-hook claude-harbor-statusline claude-harbor-install)

DRY_RUN=0
SKIP_SETTINGS=0
ASSUME_YES=0

if [[ -t 1 ]]; then
  C_RED=$'\e[31m'; C_YEL=$'\e[33m'; C_GRN=$'\e[32m'; C_BLU=$'\e[34m'; C_DIM=$'\e[2m'; C_RST=$'\e[0m'
else
  C_RED=""; C_YEL=""; C_GRN=""; C_BLU=""; C_DIM=""; C_RST=""
fi
info() { printf '%s[harbor]%s %s\n' "$C_BLU" "$C_RST" "$*"; }
warn() { printf '%s[harbor]%s %s\n' "$C_YEL" "$C_RST" "$*" >&2; }
err()  { printf '%s[harbor]%s %s\n' "$C_RED" "$C_RST" "$*" >&2; }
ok()   { printf '%s[harbor]%s %s\n' "$C_GRN" "$C_RST" "$*"; }
dim()  { printf '%s%s%s\n' "$C_DIM" "$*" "$C_RST"; }
run()  { dim "  \$ $*"; if [[ $DRY_RUN -eq 0 ]]; then "$@" || true; fi }

usage() {
  cat <<EOF
claude-harbor-client uninstaller

Usage: $0 [--dry-run] [--skip-settings] [--yes]
       $0 --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)       DRY_RUN=1; shift;;
    --skip-settings) SKIP_SETTINGS=1; shift;;
    --yes|-y)        ASSUME_YES=1; shift;;
    --help|-h)       usage; exit 0;;
    *)               err "unknown arg: $1"; usage; exit 2;;
  esac
done

if [[ $ASSUME_YES -eq 0 && $DRY_RUN -eq 0 ]]; then
  printf '%s[harbor]%s About to uninstall claude-harbor-client. Continue? [y/N] ' "$C_YEL" "$C_RST"
  read -r reply </dev/tty || reply=""
  case "$reply" in
    y|Y|yes|YES) :;;
    *) info "cancelled"; exit 0;;
  esac
fi

# ─── remove ~/.claude/settings.json entries ──────────────────────────────────
if [[ $SKIP_SETTINGS -eq 0 ]]; then
  if command -v claude-harbor-install >/dev/null 2>&1; then
    info "removing ~/.claude/settings.json entries"
    if [[ $DRY_RUN -eq 1 ]]; then
      run claude-harbor-install uninstall --dry-run
    else
      run claude-harbor-install uninstall
    fi
  else
    warn "claude-harbor-install not on PATH; skipping settings.json cleanup"
  fi
fi

# ─── unlink shims ────────────────────────────────────────────────────────────
info "unlinking global shims"
for bin in "${LINKED_BINS[@]}"; do
  run bun unlink "$bin"
done

# ─── un-register packages ────────────────────────────────────────────────────
info "un-registering packages"
for pkg in "${CLIENT_PKGS[@]}"; do
  dir="$SCRIPT_DIR/$pkg"
  if [[ ! -f "$dir/package.json" ]]; then continue; fi
  run bash -c "cd '$dir' && bun unlink"
done

printf '\n'
ok "uninstall complete"
printf '\n'
printf 'Remaining:\n'
printf '  - node_modules/ in each package (remove with: rm -rf %s/*/node_modules)\n' "$SCRIPT_DIR"
printf '  - HARBOR_URL export in your shell profile (if you added one)\n'
