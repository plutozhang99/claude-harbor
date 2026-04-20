/** Help + version strings for the installer CLI. */

import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;

export const HELP_TEXT: string = `claude-harbor-install ${VERSION} — wire ~/.claude/settings.json for claude-harbor

Usage:
  claude-harbor-install install [--dry-run] [--harbor-url <url>] [--home <path>]
                                [--account-hint auto|skip|manual:<value>]
                                 Install hook, statusline and channel-plugin
                                 entries into settings.json. Idempotent.
  claude-harbor-install uninstall [--dry-run] [--home <path>]
                                 Remove the entries previously installed.
                                 Also clears any install-time account hint.
  claude-harbor-install --version, -v
  claude-harbor-install --help, -h

Flags:
  --dry-run          Print the planned diff and exit without writing.
  --harbor-url URL   Default harbor server URL (recorded in the sidecar for
                     your reference; hook/statusline binaries read HARBOR_URL
                     from env at runtime).
  --home PATH        Override \$CLAUDE_HOME (defaults to ~/.claude). Useful
                     for tests and non-default installations.
  --account-hint MODE
                     Install-time account identity capture (default 'auto').
                       auto          run 'claude auth status --json' and
                                     POST the best-effort hint to
                                     /admin/account-hint. All failures are
                                     swallowed; install still succeeds.
                       skip          do not invoke the CLI, do not POST.
                       manual:<val>  POST <val> verbatim (no CLI call).

Environment:
  HARBOR_URL         Default --harbor-url when the flag is not given.
  HARBOR_ADMIN_TOKEN If set, the account_hint POST sends the token via
                     X-Harbor-Admin-Token. Otherwise the server accepts
                     the POST only from loopback.

Notes:
  A backup of settings.json is created as settings.json.bak-<ISO> once,
  on the first install run. A sidecar claude-harbor-installed.json records
  the exact entries written so uninstall can revert them precisely.
`;
