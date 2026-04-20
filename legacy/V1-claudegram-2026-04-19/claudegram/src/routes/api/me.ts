import type { RouterCtx } from '../../http.js';
import { jsonResponse } from '../../http.js';
import type { ApiMeResponse, ApiError } from './types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FALLBACK_EMAIL = 'local@dev';
const CF_HEADER = 'Cf-Access-Authenticated-User-Email';

const METHOD_NOT_ALLOWED: ApiError = { ok: false, error: 'method not allowed' };

export function handleApiMe(
  req: Request,
  deps: Pick<RouterCtx, 'config'>,
): Promise<Response> | Response {
  if (req.method !== 'GET') {
    return jsonResponse(405, METHOD_NOT_ALLOWED);
  }

  if (deps.config.trustCfAccess) {
    const raw = req.headers.get(CF_HEADER);
    if (raw !== null && EMAIL_RE.test(raw)) {
      const body: ApiMeResponse = { ok: true, email: raw };
      return jsonResponse(200, body);
    }
  }

  const body: ApiMeResponse = { ok: true, email: FALLBACK_EMAIL };
  return jsonResponse(200, body);
}
