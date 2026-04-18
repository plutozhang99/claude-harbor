import { z } from 'zod';
import type { RouterCtx } from '../../http.js';
import { jsonResponse } from '../../http.js';
import type { ApiMessagesResponse, ApiError } from './types.js';

const METHOD_NOT_ALLOWED: ApiError = { ok: false, error: 'method not allowed' };

const querySchema = z.object({
  session_id: z.string().min(1).max(256),
  before: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().optional(),
});

export async function handleApiMessages(
  req: Request,
  deps: Pick<RouterCtx, 'msgRepo' | 'logger'>,
): Promise<Response> {
  if (req.method !== 'GET') {
    return jsonResponse(405, METHOD_NOT_ALLOWED);
  }

  const url = new URL(req.url);
  const raw = {
    session_id: url.searchParams.get('session_id') ?? undefined,
    before: url.searchParams.get('before') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  };

  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(400, {
      ok: false,
      error: 'invalid query',
      issues: parsed.error.issues,
    });
  }

  const { session_id, before, limit } = parsed.data;

  try {
    const result = deps.msgRepo.findBySessionPage(session_id, {
      before_id: before,
      limit,
    });
    const body: ApiMessagesResponse = { ok: true, messages: result.messages, has_more: result.has_more };
    return jsonResponse(200, body);
  } catch (err: unknown) {
    deps.logger.error('messages_list_failed', { err: String(err), session_id });
    return jsonResponse(500, { ok: false, error: 'internal error' });
  }
}
