import { Hono } from 'hono'
import { z } from 'zod'
import { normalize } from 'path'
import type {
  RegisterSessionResponse,
  ListSessionsResponse,
  ErrorResponse,
} from '@claudegram/shared'
import { SessionRegistry } from '../registry'
import type { SessionId } from '@claudegram/shared'

const registerSchema = z.object({
  name: z.string().min(1).max(64),
  projectPath: z.string().min(1).refine(
    (p) => !p.includes('\x00') && p === normalize(p) && p.startsWith('/'),
    { message: 'projectPath must be an absolute, normalised path with no null bytes.' }
  ),
})

const uuidSchema = z.string().uuid()

export function createSessionRoutes(registry: SessionRegistry): Hono {
  const app = new Hono()

  // POST / — register a new session
  app.post('/', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      process.stderr.write('[claudegram-daemon] Received malformed JSON on POST /api/sessions\n')
      const err: ErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: 'Invalid JSON body.',
      }
      return c.json(err, 400)
    }

    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      const err: ErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: parsed.error.issues.map((i) => i.message).join('; '),
      }
      return c.json(err, 400)
    }

    const result = registry.register(parsed.data)
    if (!result.ok) {
      return c.json(result.error, 409)
    }

    const response: RegisterSessionResponse = {
      sessionId: result.data.sessionId,
      name: result.data.name,
    }
    return c.json(response, 201)
  })

  // DELETE /:sessionId — unregister a session
  app.delete('/:sessionId', (c) => {
    const rawId = c.req.param('sessionId')
    const parsed = uuidSchema.safeParse(rawId)
    if (!parsed.success) {
      const err: ErrorResponse = { error: 'SESSION_NOT_FOUND', message: 'Invalid session ID.' }
      return c.json(err, 404)
    }
    const result = registry.unregister(parsed.data as SessionId)
    if (!result.ok) {
      return c.json(result.error, 404)
    }
    return new Response(null, { status: 204 })
  })

  // GET / — list all sessions
  app.get('/', (c) => {
    const response: ListSessionsResponse = {
      sessions: registry.getAll(),
    }
    return c.json(response, 200)
  })

  return app
}
