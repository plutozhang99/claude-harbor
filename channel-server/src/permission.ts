import { z } from 'zod'
import { PERMISSION_CATEGORIES } from '@claudegram/shared'
import type { PermissionNotification, PermissionVerdict } from '@claudegram/shared'
import type { ISessionPermissionAllowlist } from './allowlist.js'
import type { ChannelConfig } from './config.js'

// ─── Field length budgets ────────────────────────────────────────────────────
// Bounded to prevent a compromised Claude Code process from sending unbounded
// payloads that would cause stderr DoS here or daemon body bloat in Phase 2B.

const MAX_TITLE_LEN = 256
const MAX_DESCRIPTION_LEN = 4096
const MAX_TOOL_NAME_LEN = 128
const MAX_SESSION_ID_LEN = 128

// ─── Handler context ──────────────────────────────────────────────────────────

export interface PermissionContext {
  readonly config: ChannelConfig
  readonly allowlist: ISessionPermissionAllowlist
}

// ─── Decision handler ─────────────────────────────────────────────────────────

/**
 * Handles a single `claude/channel/permission` notification.
 *
 * Phase 2A behaviour:
 *   1. If the category is in the session allowlist (set by an earlier yes_all),
 *      return `allow` immediately without contacting the daemon.
 *   2. Otherwise return a `deny` stub — Phase 2B replaces this with a real
 *      HTTP POST to the daemon followed by long-polling for the verdict.
 *
 * Phase 2B TODO:
 *   - POST `PermissionNotification` to `ctx.config.CLAUDEGRAM_DAEMON_URL`
 *     at `POST /api/decisions` (see shared/types.ts CreateDecisionRequest).
 *   - Long-poll `GET /api/decisions/:requestId` until answered/expired.
 *   - Map answer string to PermissionVerdict:
 *       "yes"     → { behavior: 'allow' }
 *       "yes_all" → allowlist.add(category); { behavior: 'allow' }
 *       "no"      → { behavior: 'deny' }
 */
export async function handlePermission(
  notification: PermissionNotification,
  ctx: PermissionContext,
): Promise<PermissionVerdict> {
  // Fast path — category already approved for this session lifetime.
  if (ctx.allowlist.has(notification.category)) {
    return { behavior: 'allow' }
  }

  // Phase 2B will replace this stub with real HTTP relay to the daemon.
  return { behavior: 'deny', reason: 'channel_server_not_fully_wired_phase_2b_pending' }
}

// ─── MCP notification → typed notification helper ────────────────────────────

/**
 * Parses and validates the raw `claude/channel/permission` notification
 * payload into a {@link PermissionNotification}.  Returns a typed Result so
 * callers can handle validation failures without throwing.
 *
 * All string fields are length-bounded — see field budgets at top of file.
 * The schema is `.strict()` so unknown keys are rejected (defence-in-depth
 * against a compromised Claude Code process smuggling extra fields downstream).
 */
export function parsePermissionNotification(
  params: unknown,
): { ok: true; data: PermissionNotification } | { ok: false; error: string } {
  const schema = z
    .object({
      category: z.enum(PERMISSION_CATEGORIES),
      title: z.string().min(1).max(MAX_TITLE_LEN),
      description: z.string().min(1).max(MAX_DESCRIPTION_LEN),
      toolName: z.string().max(MAX_TOOL_NAME_LEN).optional(),
      sessionId: z.string().max(MAX_SESSION_ID_LEN).optional(),
    })
    .strict()

  const result = schema.safeParse(params)

  if (!result.success) {
    return {
      ok: false,
      error: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
    }
  }

  return { ok: true, data: result.data }
}
