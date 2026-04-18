import type { Database } from '../db/client.js';
import { jsonResponse } from '../http.js';

const METHOD_NOT_ALLOWED = { ok: false, error: 'method not allowed' } as const;
const DB_UNAVAILABLE = { ok: false, error: 'database unavailable' } as const;

/**
 * Handles all requests to /health.
 * Method check is done here so the dispatcher only needs a single
 * entry point regardless of the HTTP verb.
 */
export function handleHealth(req: Request, deps: { readonly db: Database }): Response {
  if (req.method !== 'GET') {
    return jsonResponse(405, METHOD_NOT_ALLOWED);
  }

  try {
    const row = deps.db.query('SELECT 1 AS ok').get() as { ok: number } | null;
    if (row?.ok === 1) {
      return jsonResponse(200, { ok: true });
    }
    return jsonResponse(503, DB_UNAVAILABLE);
  } catch {
    return jsonResponse(503, DB_UNAVAILABLE);
  }
}
