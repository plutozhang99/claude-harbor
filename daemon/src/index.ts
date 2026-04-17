import { Hono } from 'hono'
import { loadConfig } from './config'
import { acquirePidLock, releasePidLock } from './pid'
import { SessionRegistry } from './registry'
import { DecisionQueue } from './queue'
import { createSessionRoutes } from './routes/sessions'
import { createDecisionRoutes } from './routes/decisions'
import { startBot } from '@claudegram/bot'
import type { HealthResponse, ErrorResponse } from '@claudegram/shared'

// Validate environment configuration before anything else — exits with code 1 on failure
const config = loadConfig()
process.stderr.write('[claudegram-daemon] Config loaded\n')

const PORT = config.CLAUDEGRAM_PORT
const registry = new SessionRegistry()
const queue = new DecisionQueue()

// Acquire PID lock — exit immediately if the daemon is already running
try {
  acquirePidLock()
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : 'Unknown error'
  process.stderr.write(`[claudegram-daemon] Failed to start: ${msg}\n`)
  process.exit(1)
}

const app = new Hono()

// Mount session routes
app.route('/api/sessions', createSessionRoutes(registry))

// Mount decision routes
app.route('/api/decisions', createDecisionRoutes(queue, registry))

// GET /api/health
app.get('/api/health', (c) => {
  const body: HealthResponse = {
    ok: true,
    uptime: registry.uptimeSeconds(),
    sessions: registry.getAll().length,
    pendingDecisions: queue.pendingCount(),
  }
  return c.json(body)
})

// 404 fallback
app.notFound((c) => {
  const err: ErrorResponse = { error: 'INTERNAL_ERROR', message: 'Not found' }
  return c.json(err, 404)
})

// ── Bot setup ──────────────────────────────────────────────────────────────────
// Inline adapter that satisfies SessionRegistryPort structurally:
//   - getActiveSessions() maps Session.name → sessionName
//   - on/off delegate to the typed registry emitter so bot listeners receive
//     the correct SessionInfo shape (sessionId + sessionName only)
//
// The listener wrapper translates Session → SessionInfo at the boundary so
// the bot never depends on the full Session type from daemon/.
// We do NOT import SessionEventName/SessionEventListener from @claudegram/bot —
// that would flip the dependency direction (daemon → bot is already established;
// bot → daemon must never happen).  TypeScript's structural typing means the
// inline types below are assignment-compatible with the bot's port interface
// without an explicit import.
import type { Session } from '@claudegram/shared'

// Inline mirror of SessionRegistryPort's listener types (structural compatibility
// with bot/src/queue-port.ts SessionEventName / SessionEventListener).
type RegistryEventName = 'registered' | 'deregistered'
type RegistryEventListener = (session: { readonly sessionId: string; readonly sessionName: string }) => void

// Cache: maps user listener → per-event wrapped (Session→SessionInfo) listener.
//
// Key contract: caller must pass the SAME function reference to off() that was
// passed to on(). (Bot uses const onSessionRegistered/onSessionDeregistered for
// stable identity — see bot/src/index.ts.)
//
// Two-level structure (listener → event → wrapper) so the same function can be
// registered to BOTH 'registered' and 'deregistered' without the second on()
// overwriting the first wrapper. Bot today uses two distinct functions, but
// this adapter must not bake in that assumption.
const listenerWrappers = new Map<
  RegistryEventListener,
  Map<RegistryEventName, (session: Session) => void>
>()

const registryPort = {
  getActiveSessions(): readonly { readonly sessionId: string; readonly sessionName: string }[] {
    return registry.getAll().map((s) => ({
      sessionId: s.sessionId,
      sessionName: s.name,
    }))
  },
  on(event: RegistryEventName, listener: RegistryEventListener): void {
    const wrapper = (session: Session): void => {
      listener({ sessionId: session.sessionId, sessionName: session.name })
    }
    let perEvent = listenerWrappers.get(listener)
    if (perEvent === undefined) {
      perEvent = new Map()
      listenerWrappers.set(listener, perEvent)
    }
    perEvent.set(event, wrapper)
    registry.on(event, wrapper)
  },
  off(event: RegistryEventName, listener: RegistryEventListener): void {
    const perEvent = listenerWrappers.get(listener)
    if (perEvent === undefined) return
    const wrapper = perEvent.get(event)
    if (wrapper === undefined) return
    registry.off(event, wrapper)
    perEvent.delete(event)
    if (perEvent.size === 0) {
      listenerWrappers.delete(listener)
    }
  },
}

const botHandle = startBot(
  {
    token: config.TELEGRAM_BOT_TOKEN,
    allowlist: config.TELEGRAM_ALLOWLIST,
  },
  {
    // DecisionQueue satisfies DecisionQueuePort structurally:
    //   - on(event, listener): this  ← void (port says `void`; `this` is assignable to `void`)
    //   - off(event, listener): this ← void
    //   - answer(requestId, optionId): Result<Decision, ErrorResponse>
    // TypeScript verifies this at the call site without any import of
    // DecisionQueuePort in daemon — the port lives in bot/ only.
    queue,
    registry: registryPort,
  },
)

// Start bot after PID lock and HTTP server setup are complete.
// bot.start() performs a getMe() call and begins long-polling; it throws if
// Telegram rejects the token. We treat that as a fatal startup error.
try {
  await botHandle.start()
  process.stderr.write('[daemon] bot started\n')
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`[daemon] bot failed to start: ${msg}\n`)
  releasePidLock()
  process.exit(1)
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────
// Shutdown ordering (Phase 4C decision):
//   1. Stop bot (unsubscribe queue events, stop grammy polling) — prevents new
//      Telegram messages from arriving and new queue.answer calls from firing.
//   2. Destroy queue (cancel pending pollers, clear TTL timers) — safe because
//      bot is already stopped and won't receive more callback_query updates.
//   3. Release PID lock.
//
// HTTP server shutdown is handled implicitly: Bun's built-in server stops
// accepting new connections when the process exits. A future phase can add
// explicit server.stop() here if graceful drain is needed.
async function shutdown(): Promise<void> {
  process.stderr.write('[daemon] shutting down\n')
  try {
    await botHandle.stop()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[daemon] bot.stop error (ignored): ${msg}\n`)
  }
  queue.destroy()
  releasePidLock()
  process.exit(0)
}

process.on('SIGTERM', () => {
  void shutdown()
})
process.on('SIGINT', () => {
  void shutdown()
})

export default {
  port: PORT,
  hostname: '127.0.0.1',
  fetch: app.fetch,
}
