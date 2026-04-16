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
// SessionRegistry doesn't expose getActiveSessions() yet; provide a minimal
// adapter that satisfies SessionRegistryPort until Phase 3C adds it.
const registryPort = {
  getActiveSessions(): readonly { readonly sessionId: string; readonly sessionName: string }[] {
    return registry.getAll().map((s) => ({
      sessionId: s.sessionId,
      sessionName: s.name,
    }))
  },
}

const botHandle = startBot(
  {
    token: config.TELEGRAM_BOT_TOKEN,
    allowlist: config.TELEGRAM_ALLOWLIST,
  },
  {
    // DecisionQueue satisfies DecisionQueuePort structurally:
    //   - on(event, listener): this  ← unknown (port says `unknown`)
    //   - off(event, listener): this ← unknown
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
