import { z } from 'zod'
import type { Result } from '@claudegram/shared'

// ─── Schema ──────────────────────────────────────────────────────────────────

const ChannelConfigSchema = z.object({
  CLAUDEGRAM_SESSION_NAME: z.string().min(1, 'required'),
  // Treat empty string as undefined so that `.default(...)` fires when the
  // variable is set but blank (mirrors the daemon/src/config.ts pattern).
  CLAUDEGRAM_DAEMON_URL: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z
      .string()
      .url()
      .refine((u) => /^https?:\/\//.test(u), 'must be http or https')
      .default('http://localhost:3582'),
  ),
})

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>

// ─── Pure validation ──────────────────────────────────────────────────────────

/**
 * Parse env vars into a typed Result.  Does NOT touch process state.
 * Prefer this in tests; the entry point uses {@link loadChannelConfig}.
 */
export function parseChannelConfig(
  env: NodeJS.ProcessEnv = process.env,
): Result<ChannelConfig, string[]> {
  const result = ChannelConfigSchema.safeParse(env)
  if (!result.success) {
    return {
      ok: false,
      error: result.error.errors.map((e) => {
        const path = e.path.length > 0 ? e.path.join('.') : '(root)'
        return `${path}: ${e.message}`
      }),
    }
  }
  return { ok: true, data: result.data }
}

// ─── Boot-time loader ─────────────────────────────────────────────────────────

/**
 * Validates env and exits with code 1 on any error.
 * Intended for the channel-server entry point only.
 * Tests should call {@link parseChannelConfig} instead.
 */
export function loadChannelConfig(env: NodeJS.ProcessEnv = process.env): ChannelConfig {
  const result = parseChannelConfig(env)
  if (!result.ok) {
    const lines = result.error.map((l) => `  ✗ ${l}`).join('\n')
    process.stderr.write(
      `[claudegram/channel-server] Invalid environment configuration:\n${lines}\n\n` +
        `Required: CLAUDEGRAM_SESSION_NAME\n` +
        `Optional: CLAUDEGRAM_DAEMON_URL (default http://localhost:3582)\n`,
    )
    process.exit(1)
  }
  return result.data
}
