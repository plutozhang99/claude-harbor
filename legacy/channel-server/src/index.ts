import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Notification } from '@modelcontextprotocol/sdk/types.js'
import type { PermissionVerdict, SessionId } from '@claudegram/shared'
import { loadChannelConfig } from './config.js'
import { SessionPermissionAllowlist } from './allowlist.js'
import { handlePermission, parsePermissionNotification } from './permission.js'
import { createDaemonClient, formatRelayError } from './relay.js'

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// Fail fast on bad environment; loadChannelConfig calls process.exit(1) if
// CLAUDEGRAM_SESSION_NAME is missing or CLAUDEGRAM_DAEMON_URL is invalid.
const config = loadChannelConfig()

// ─── Session-scoped state ─────────────────────────────────────────────────────

const allowlist = new SessionPermissionAllowlist()

// ─── Daemon HTTP client ───────────────────────────────────────────────────────

const daemon = createDaemonClient(config.CLAUDEGRAM_DAEMON_URL)

// ─── Phase 2C: register session with daemon ───────────────────────────────────
//
// Boot order: loadChannelConfig → create daemon client → registerSession →
//   install signal/stdin handlers → connect MCP transport.
//
// projectPath defaults to process.cwd(), which reflects the working directory
// of the Claude Code session that spawned this channel-server.  This is the
// best approximation of the project path without an explicit env var.

const projectPath = process.cwd()
process.stderr.write(
  `[claudegram/channel-server] registering session "${config.CLAUDEGRAM_SESSION_NAME}" with daemon at ${config.CLAUDEGRAM_DAEMON_URL}\n`,
)

const registered = await daemon.registerSession(config.CLAUDEGRAM_SESSION_NAME, projectPath)
if (!registered.ok) {
  process.stderr.write(
    `[claudegram/channel-server] failed to register session '${config.CLAUDEGRAM_SESSION_NAME}': ${formatRelayError(registered.error)}\n`,
  )
  // Only suggest "is the daemon running?" for transport-level failures.
  // 4xx/5xx HTTP responses prove the daemon IS running, so that hint would
  // be misleading (e.g. a 409 SESSION_NAME_CONFLICT or a 500 internal error).
  if (registered.error.kind === 'network' || registered.error.kind === 'timeout') {
    process.stderr.write(
      `[claudegram/channel-server] is the daemon running at ${config.CLAUDEGRAM_DAEMON_URL}?\n`,
    )
  }
  process.exit(1)
}
const sessionId: SessionId = registered.data.sessionId

process.stderr.write(
  `[claudegram/channel-server] registered as '${config.CLAUDEGRAM_SESSION_NAME}' (${sessionId})\n`,
)

// ─── Graceful shutdown ────────────────────────────────────────────────────────
//
// Deregisters the session before exiting.  The `shuttingDown` guard prevents
// double-shutdown if multiple signals arrive in quick succession (e.g. SIGINT
// followed by SIGTERM).  The flag is set synchronously BEFORE the first
// `await` so a re-entry from a second signal is rejected before any I/O —
// this is correct because Node.js executes the synchronous prologue of an
// async function on the call stack of the caller.
//
// Known TODO (Phase 4C/2D): the MCP SDK does not expose an `onclose` hook for
// the stdio transport, so `stdin.on('end')` may not fire when Claude Code
// closes the transport via JSON-RPC rather than closing the pipe. Until then
// the SIGTERM/SIGINT path is the primary shutdown trigger.

let shuttingDown = false

async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write(`[claudegram/channel-server] shutting down (${reason})\n`)
  const deregistered = await daemon.deregisterSession(sessionId)
  if (!deregistered.ok) {
    process.stderr.write(
      `[claudegram/channel-server] deregister failed: ${formatRelayError(deregistered.error)}\n`,
    )
  }
  process.exit(0)
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})
process.stdin.on('end', () => {
  void shutdown('stdin closed')
})
process.stdin.on('error', (err: Error) => {
  void shutdown(`stdin error: ${err.message}`)
})

// ─── MCP Server setup ─────────────────────────────────────────────────────────

/**
 * The MCP Server instance.
 *
 * We advertise the `claude/channel/permission` capability under `experimental`
 * because it is a Claudegram-specific extension not part of the base MCP spec.
 *
 * SDK: @modelcontextprotocol/sdk@1.29.0
 * API: new Server(info, { capabilities }) + server.setNotificationHandler(schema, handler)
 *      The `method` literal in the Zod schema is used by the SDK to route
 *      incoming notifications (see zod-json-schema-compat.js getMethodLiteral).
 */
const server = new Server(
  {
    name: 'claudegram-channel-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      experimental: {
        'claude/channel/permission': {},
        // Advertise the verdict send-back capability so Claude Code knows we
        // will emit result notifications.
        'claude/channel/permission/result': {},
      },
    },
  },
)

// ─── Notification handler ─────────────────────────────────────────────────────

/**
 * Handle incoming `claude/channel/permission` notifications from Claude Code.
 *
 * We use `fallbackNotificationHandler` rather than `setNotificationHandler`
 * because the channel permission method is a Claudegram-specific extension
 * not present in the base MCP spec.  `fallbackNotificationHandler` receives
 * all methods that lack a dedicated handler, so we guard with a method check.
 *
 * Verdict send-back (Phase 2B):
 *   JSON-RPC 2.0 does not permit a response to a notification (it has no id
 *   field). Therefore the verdict is returned via a separate **server →
 *   client** notification with method `claude/channel/permission/result`.
 *
 *   Payload:
 *     {
 *       correlationId: string,   // value of notification.params.correlationId
 *       verdict: PermissionVerdict
 *     }
 *
 *   Claude Code MUST:
 *     a) include a stable `correlationId` field in each
 *        `claude/channel/permission` notification payload; and
 *     b) listen for `claude/channel/permission/result` notifications and match
 *        on `correlationId` to unblock the corresponding permission prompt.
 *
 *   Open question for Phase 4A: agree the exact `correlationId` format with
 *   Claude Code (a UUID is the simplest option).
 *
 *   If Claude Code does not include `correlationId` in the payload, the result
 *   notification is still sent with `correlationId: null` so the client can
 *   observe the verdict even if it cannot correlate to a specific prompt.
 */
server.fallbackNotificationHandler = async (notification: Notification): Promise<void> => {
  // Outer try/catch: prevents any unexpected throw from escaping into the SDK
  // message loop, which could either crash the process or silently terminate
  // the stdio session.  All errors are logged and swallowed.
  try {
    if (notification.method !== 'claude/channel/permission') {
      process.stderr.write(
        `[claudegram/channel-server] unhandled notification method: ${notification.method}\n`,
      )
      return
    }

    const parsed = parsePermissionNotification(notification.params)

    if (!parsed.ok) {
      process.stderr.write(
        `[claudegram/channel-server] invalid permission notification payload: ${parsed.error}\n`,
      )
      return
    }

    // Extract correlationId from the validated payload (may be absent — the
    // schema marks it `.optional()`).  We pull it out of `parsed.data` rather
    // than the raw `notification.params` so it has been bounded-length-checked
    // and type-narrowed to `string | undefined` by zod.
    const correlationId: string | null = parsed.data.correlationId ?? null

    // Inner try/catch around handlePermission: contract requires that we
    // always have a verdict to act on.  A throw inside handlePermission must
    // degrade to a safe `deny` rather than skipping the send-back entirely.
    let verdict: PermissionVerdict
    try {
      verdict = await handlePermission(parsed.data, {
        config,
        allowlist,
        daemon,
        sessionId,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      process.stderr.write(
        `[claudegram/channel-server] handlePermission error: ${message}\n`,
      )
      verdict = { behavior: 'deny', reason: 'internal_error' }
    }

    process.stderr.write(
      `[claudegram/channel-server] permission verdict: behavior=${verdict.behavior}` +
        (verdict.behavior === 'deny' && verdict.reason ? ` reason=${verdict.reason}` : '') +
        ` category=${parsed.data.category} title="${parsed.data.title}"\n`,
    )

    // ── Verdict send-back ──────────────────────────────────────────────────
    // JSON-RPC 2.0 forbids replying to a notification.  We instead emit a
    // separate server→client notification so Claude Code can unblock the
    // permission prompt.
    //
    // The `server.notification()` method sends arbitrary JSON-RPC
    // notification frames to the connected client.  Per MCP SDK 1.29.0, this
    // call will silently no-op if the transport is not connected, so it is
    // safe to call unconditionally here.
    try {
      // `server.notification()` is typed to the SDK's ServerNotification union,
      // which does not include our custom extension method.  We use a
      // `as unknown as` cast to emit the raw JSON-RPC notification frame;
      // the SDK's runtime path is method-agnostic for outbound notifications.
      type CustomNotification = {
        method: string
        params?: Record<string, unknown>
      }
      await (server.notification as (n: CustomNotification) => Promise<void>)({
        method: 'claude/channel/permission/result',
        params: {
          correlationId,
          verdict,
        },
      })
    } catch (notifyErr) {
      // Sending the result notification is best-effort; if it fails (e.g.,
      // client already disconnected) we log and continue rather than treating
      // it as a fatal error.  The correlationId is included so operators can
      // tie the failure to the specific permission decision that lost its
      // verdict send-back (otherwise indistinguishable from any other prompt).
      const message = notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
      process.stderr.write(
        `[claudegram/channel-server] failed to send permission result notification (correlationId=${correlationId ?? '<none>'}): ${message}\n`,
      )
    }
  } catch (err) {
    // Last-resort guard.  Do NOT re-throw — the SDK message loop must continue.
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(
      `[claudegram/channel-server] notification handler error: ${message}\n`,
    )
  }
}

// ─── Transport ───────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()

process.stderr.write('[claudegram/channel-server] connecting to stdio transport\n')

server.connect(transport).then(() => {
  process.stderr.write('[claudegram/channel-server] ready — waiting for MCP messages on stdin\n')
}).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`[claudegram/channel-server] fatal: failed to connect transport: ${message}\n`)
  process.exit(1)
})

// ─── Uncaught error guard ─────────────────────────────────────────────────────

process.on('uncaughtException', (err: Error) => {
  process.stderr.write(
    `[claudegram/channel-server] uncaughtException: ${err.message}\n${err.stack ?? ''}\n`,
  )
  process.exit(1)
})

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  process.stderr.write(`[claudegram/channel-server] unhandledRejection: ${message}\n`)
  process.exit(1)
})
