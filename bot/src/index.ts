import { Bot } from 'grammy'
import { parseCallbackData } from '@claudegram/shared'

/**
 * Telegram user IDs are stored as `number` (JavaScript safe-integer range, up to 2^53-1).
 * Current Telegram IDs are 32-bit. If Telegram ever ships >2^53 user IDs,
 * migrate to bigint/string at this boundary.
 *
 * Why number (and not bigint/string) today:
 *   - grammy's entire API uses `number` for user IDs
 *   - switching to string forces a conversion at every boundary, polluting the bot
 *   - the MAX_SAFE_INTEGER guard in daemon/src/config.ts blocks alias attacks
 *
 * Naming: this is `ClaudegramBotConfig` (not `BotConfig`) to avoid shadowing
 * grammy's own `BotConfig` interface from `grammy/out/bot.d.ts`. Reviewers seeing
 * `import { BotConfig }` would otherwise wonder which one is meant.
 */
export interface ClaudegramBotConfig {
  readonly token: string
  readonly allowlist: readonly number[]
}

/**
 * Back-compat alias. Prefer {@link ClaudegramBotConfig} in new code; this exists
 * so a stale `import { BotConfig } from '@claudegram/bot'` keeps compiling.
 *
 * @deprecated Use {@link ClaudegramBotConfig} — `BotConfig` shadows grammy's own
 *             type and will be removed in a future phase.
 */
export type BotConfig = ClaudegramBotConfig

/**
 * Phase 3A keeps generics as unknown defaults. Phase 3B will wire structural
 * interfaces for DecisionQueue / SessionRegistry.
 */
export interface BotDeps<Q = unknown, R = unknown> {
  readonly queue?: Q // Phase 3B: typed as DecisionQueue via structural interface
  readonly registry?: R // Phase 3B: typed as SessionRegistry
}

export interface BotHandle {
  start(): Promise<void>
  /**
   * Gracefully stops the bot. No-op (does NOT throw) if the bot was never
   * started — this matches grammy's tolerant `bot.stop()` semantics but makes
   * the contract explicit for callers.
   */
  stop(): Promise<void>
  /**
   * Escape hatch returning the underlying grammy Bot instance. Reserved for
   * integration tests that need to introspect grammy state. Production code
   * should not depend on this.
   */
  getBot(): Bot
}

/**
 * Construct a bot handle. The grammy Bot is created eagerly (with allowlist
 * middleware and callback_query handler registered) so {@link BotHandle.getBot}
 * always returns a fully-wired instance, but no network calls are made until
 * `start()`.
 *
 * Middleware order (important — must stay in this order):
 *   1. Allowlist gate — silently drops any update whose `from.id` is not in
 *      the allowlist. This must be registered first so no handler below can
 *      run for unauthorized users.
 *   2. callback_query handler — parses callback_data via parseCallbackData and
 *      logs the result to stderr. Phase 3B will replace the log+stub ack with a
 *      real queue.answer call.
 *
 * @typeParam Q  - queue dependency type (Phase 3B: DecisionQueue)
 * @typeParam R  - registry dependency type (Phase 3B: SessionRegistry)
 * @param config - bot token + allowlist
 * @param _deps  - reserved for Phase 3B wiring (queue, registry); unused in 3A
 */
export function startBot<Q = unknown, R = unknown>(
  config: ClaudegramBotConfig,
  _deps?: BotDeps<Q, R>,
): BotHandle {
  const bot = new Bot(config.token)
  const allowlistSet = new Set(config.allowlist)

  // ── 1. Allowlist middleware ────────────────────────────────────────────────
  // Must be registered FIRST. Silent discard for unauthorized users — no reply,
  // no error, just drop the update. `next()` is called only for allowlisted IDs.
  //
  // Note on `ctx.from.id`: grammy already types this as `number` (see
  // ClaudegramBotConfig JSDoc above for the size-limit rationale), so no
  // Number() coercion is needed.
  bot.use(async (ctx, next) => {
    const fromId = ctx.from?.id
    if (fromId === undefined || !allowlistSet.has(fromId)) {
      // For callback_query updates we MUST acknowledge — otherwise Telegram
      // shows the loading spinner on the user's button for up to 60 seconds.
      // Use an empty payload (no toast) so we don't reveal allowlist behavior
      // to a probing unauthorized user.
      if (ctx.callbackQuery !== undefined) {
        try {
          await ctx.answerCallbackQuery()
        } catch {
          // Best-effort — ignore network/Telegram failures here.
        }
      }
      // Silently drop — do not call next()
      return
    }
    await next()
  })

  // ── 2. callback_query handler ──────────────────────────────────────────────
  // Phase 3A: parse + log only. Phase 3B will call queue.answer here.
  bot.on('callback_query:data', async (ctx) => {
    const raw = ctx.callbackQuery.data
    const parsed = parseCallbackData(raw)

    if (!parsed.ok) {
      switch (parsed.error) {
        case 'wrong_prefix':
          // Not our callback — silently acknowledge to remove Telegram's
          // loading spinner on the button.
          await ctx.answerCallbackQuery()
          return

        case 'invalid_format':
        case 'too_long':
          process.stderr.write(
            `[bot] callback_query parse error: ${parsed.error} — raw="${raw}"\n`,
          )
          await ctx.answerCallbackQuery({ text: 'Invalid request' })
          return
      }
    }

    // Success path — log parsed data; Phase 3B replaces this with queue.answer
    process.stderr.write(
      `[bot] callback_query received: requestId=${parsed.data.requestId} optionId=${parsed.data.optionId}\n`,
    )
    await ctx.answerCallbackQuery({ text: 'Received (Phase 3A stub)' })
  })

  // ── BotHandle ──────────────────────────────────────────────────────────────
  return {
    async start(): Promise<void> {
      await bot.start()
    },
    async stop(): Promise<void> {
      if (bot.isRunning()) {
        await bot.stop()
      }
    },
    getBot(): Bot {
      return bot
    },
  }
}
