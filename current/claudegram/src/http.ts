import type { Logger } from './logger.js';
import type { MessageRepo, SessionRepo } from './repo/types.js';
import type { Database } from './db/client.js';
import { handleHealth } from './routes/health.js';
import { handleIngest } from './routes/ingest.js';

export interface RouterCtx {
  readonly msgRepo: MessageRepo;
  readonly sessRepo: SessionRepo;
  readonly logger: Logger;
  readonly db: Database;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const NOT_FOUND = { ok: false, error: 'not found' } as const;

export async function dispatch(req: Request, ctx: RouterCtx): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Route: /health (all methods handled inside handleHealth)
  if (path === '/health') {
    return handleHealth(req, { db: ctx.db });
  }

  // Route: /ingest (POST only; all other methods → 405 via handleIngest)
  if (path === '/ingest') {
    return handleIngest(req, ctx);
  }

  // Reserved prefixes and all unknown paths → 404.
  if (path.startsWith('/api/') || path.startsWith('/web/')) {
    return jsonResponse(404, NOT_FOUND);
  }

  return jsonResponse(404, NOT_FOUND);
}
