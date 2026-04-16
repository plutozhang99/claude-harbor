import { Hono } from 'hono'
import { acquirePidLock, releasePidLock } from './pid'
import { SessionRegistry } from './registry'
import { createSessionRoutes } from './routes/sessions'
import type { HealthResponse, ErrorResponse } from '@claudegram/shared'

const PORT = parseInt(process.env.CLAUDEGRAM_PORT ?? '3582', 10)
const registry = new SessionRegistry()

// Acquire PID lock — exit immediately if the daemon is already running
try {
  acquirePidLock()
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : 'Unknown error'
  process.stderr.write(`[claudegram-daemon] Failed to start: ${msg}\n`)
  process.exit(1)
}

// Graceful shutdown handlers
function shutdown(): void {
  releasePidLock()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

const app = new Hono()

// Mount session routes
app.route('/api/sessions', createSessionRoutes(registry))

// GET /api/health
app.get('/api/health', (c) => {
  const body: HealthResponse = {
    ok: true,
    uptime: registry.uptimeSeconds(),
    sessions: registry.getAll().length,
    pendingDecisions: 0, // Phase 1C will fill this in
  }
  return c.json(body)
})

// 404 fallback
app.notFound((c) => {
  const err: ErrorResponse = { error: 'INTERNAL_ERROR', message: 'Not found' }
  return c.json(err, 404)
})

export default {
  port: PORT,
  hostname: '127.0.0.1',
  fetch: app.fetch,
}
