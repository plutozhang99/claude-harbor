#!/usr/bin/env bash
# Dev convenience: build the Flutter bundle (unless --skip-build) and start
# the Bun server. The server serves the bundle at `/` when present.
#
# Env:
#   HARBOR_PORT   — TCP port (server default 7823).
#   HARBOR_BIND   — bind host (server default 127.0.0.1).
#   HARBOR_DEV    — when 1 on loopback, enables permissive GET CORS (dev).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVER_DIR="${REPO_ROOT}/current/claude-harbor-server"

SKIP_BUILD=0
for arg in "$@"; do
  case "${arg}" in
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "unknown arg: ${arg}" >&2; exit 2 ;;
  esac
done

if [ "${SKIP_BUILD}" -eq 0 ]; then
  "${SCRIPT_DIR}/build-frontend.sh"
else
  echo "[dev] --skip-build set; using existing bundle (if any)"
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun not on PATH. Install Bun first." >&2
  exit 1
fi

cd "${SERVER_DIR}"
echo "[dev] starting server (port=${HARBOR_PORT:-7823} bind=${HARBOR_BIND:-127.0.0.1})"
exec bun run src/index.ts
