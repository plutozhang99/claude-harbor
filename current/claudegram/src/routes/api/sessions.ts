import type { RouterCtx } from '../../http.js';
import { jsonResponse } from '../../http.js';
import type { ApiSessionsResponse, ApiError } from './types.js';

const METHOD_NOT_ALLOWED: ApiError = { ok: false, error: 'method not allowed' };

export function handleApiSessions(
  req: Request,
  deps: Pick<RouterCtx, 'sessRepo' | 'logger'>,
): Promise<Response> | Response {
  if (req.method !== 'GET') {
    return jsonResponse(405, METHOD_NOT_ALLOWED);
  }

  try {
    const sessions = deps.sessRepo.findAll();
    const body: ApiSessionsResponse = { ok: true, sessions };
    return jsonResponse(200, body);
  } catch (err: unknown) {
    deps.logger.error('sessions_list_failed', { err: String(err) });
    return jsonResponse(500, { ok: false, error: 'internal error' });
  }
}
