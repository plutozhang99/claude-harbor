import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Notification } from '@modelcontextprotocol/sdk/types.js'
import type { PermissionVerdict } from '@claudegram/shared'
import { loadChannelConfig } from './config.js'
import { SessionPermissionAllowlist } from './allowlist.js'
import { handlePermission, parsePermissionNotification } from './permission.js'

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// Fail fast on bad environment; loadChannelConfig calls process.exit(1) if
// CLAUDEGRAM_SESSION_NAME is missing or CLAUDEGRAM_DAEMON_URL is invalid.
const config = loadChannelConfig()

process.stderr.write(
  `[claudegram/channel-server] starting — session="${config.CLAUDEGRAM_SESSION_NAME}" daemon="${config.CLAUDEGRAM_DAEMON_URL}"\n`,
)

// ─── Session-scoped state ─────────────────────────────────────────────────────

const allowlist = new SessionPermissionAllowlist()

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
 * In Phase 2A this is a stub that always returns deny (unless the category is
 * already in the allowlist).  Phase 2B will replace the stub with a real HTTP
 * relay to the daemon and long-polling for the verdict.
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

    // Inner try/catch around handlePermission: contract requires that we
    // always have a verdict to act on (Phase 2B will use this to send the
    // result back to Claude Code).  A throw inside handlePermission must
    // degrade to a safe `deny` rather than skipping the response entirely.
    let verdict: PermissionVerdict
    try {
      verdict = await handlePermission(parsed.data, { config, allowlist })
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
    // Phase 2B: send verdict back to Claude Code via SDK response path.
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
