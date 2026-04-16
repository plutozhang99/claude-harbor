import { Bot, InlineKeyboard } from 'grammy'
import { parseCallbackData } from '@claudegram/shared'
import type { Decision, RequestId } from '@claudegram/shared'
import type { DecisionQueuePort, SessionRegistryPort, DecisionEventListener } from './queue-port'
import { renderPermissionMessage } from './render'
import { formatAnsweredText } from './format-answered'

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
 * Runtime dependencies injected into the bot at construction time.
 * Using structural ports (not concrete class imports) keeps the dependency
 * direction clean: daemon → bot, never bot → daemon.
 */
export interface BotDeps {
  readonly queue: DecisionQueuePort
  readonly registry: SessionRegistryPort
}

export interface BotHandle {
  start(): Promise<void>
  /**
   * Gracefully stops the bot. Unsubscribes from queue events before stopping
   * grammy to prevent races where a Telegram API call fires after the bot has
   * stopped polling.
   *
   * No-op (does NOT throw) if the bot was never started — this matches
   * grammy's tolerant `bot.stop()` semantics but makes the contract explicit
   * for callers.
   */
  stop(): Promise<void>
  /**
   * Escape hatch returning the underlying grammy Bot instance. Reserved for
   * integration tests that need to introspect grammy state. Production code
   * should not depend on this.
   */
  getBot(): Bot
}

// ─── Internal types ────────────────────────────────────────────────────────────

/** Per-decision state stored while the decision is pending. */
interface MessageRecord {
  /** The chat_id the message was sent to. */
  chatId: number
  /** The message_id returned by sendMessage, needed for editMessageText. */
  messageId: number
  /**
   * The rendered message text as originally sent. Stored so that:
   *   - 'answered' edit can produce formatAnsweredText(originalText, optionLabel)
   *   - 'expired' / 'cancelled' edits can produce consistent output
   * Avoids re-rendering (which would need the original RenderInput) and keeps
   * the stored text perfectly in sync with what Telegram received.
   */
  text: string
}

/**
 * Construct a bot handle. The grammy Bot is created eagerly (with allowlist
 * middleware and event subscriptions registered) so {@link BotHandle.getBot}
 * always returns a fully-wired instance, but no network calls are made until
 * `start()`.
 *
 * ## Single-user chat_id strategy (Phase 3B / v0.1)
 *
 * PRD F4 targets a single-user, single-bot deployment. When a 'created' event
 * arrives, the bot sends the Telegram message to `config.allowlist[0]` — the
 * first (and typically only) allowlisted user ID. This is the canonical chat_id
 * for v0.1. If future phases need broadcast-to-all semantics, replace the
 * `targetChatId` constant with a loop over `config.allowlist`.
 *
 * ## Middleware order (important — must stay in this order):
 *   1. Allowlist gate — silently drops any update whose `from.id` is not in
 *      the allowlist. This must be registered first so no handler below can
 *      run for unauthorized users.
 *   2. callback_query handler — parses callback_data, calls queue.answer, and
 *      lets the 'answered' event handler edit the Telegram message.
 *
 * @param config - bot token + allowlist
 * @param deps   - queue port (for events + answer) and registry port
 */
export function startBot(config: ClaudegramBotConfig, deps: BotDeps): BotHandle {
  const bot = new Bot(config.token)
  const allowlistSet = new Set(config.allowlist)

  /**
   * Canonical chat_id for outgoing messages (Phase 3B single-user model).
   * `config.allowlist` is validated non-empty by daemon/src/config.ts so
   * `config.allowlist[0]` is always defined at runtime. The `!` assertion below
   * is the only place this assumption is baked in — update it if the allowlist
   * ever becomes optional.
   */
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const targetChatId: number = config.allowlist[0]!

  /** Tracks sent Telegram messages for later edit. Keyed by RequestId. */
  const messageMap = new Map<RequestId, MessageRecord>()

  // ── Queue event handlers ────────────────────────────────────────────────────
  // Defined as named variables so they can be passed to both `on` and `off`,
  // preserving reference equality for correct unsubscription in BotHandle.stop.

  const onCreated: DecisionEventListener = (decision: Decision): void => {
    // Phase 3B only handles 'permission' decisions. A permission decision MUST
    // carry a `category` (set by the channel-server) so the bot can render
    // category-specific button labels ("Yes, all edits" vs "Yes, all Bash"
    // vs "Yes, all MCP"). Custom decisions (Phase F3) will be routed through
    // a separate render path.
    //
    // We do NOT default missing category to 'file_edit' — that would silently
    // mislabel Bash/MCP prompts. Instead we skip and log so the misconfiguration
    // is visible in stderr.
    if (decision.type !== 'permission' || decision.category === undefined) {
      process.stderr.write(
        `[bot] skipping decision (not a permission decision or missing category): ` +
          `type="${decision.type}" category="${decision.category ?? '<undefined>'}" ` +
          `requestId=${decision.requestId}\n`,
      )
      return
    }

    const rendered = renderPermissionMessage({
      requestId: decision.requestId,
      sessionName: decision.sessionName,
      category: decision.category,
      title: decision.title,
      description: decision.description,
    })

    if (!rendered.ok) {
      process.stderr.write(
        `[bot] render failed: ${rendered.error} for requestId=${decision.requestId}\n`,
      )
      return
    }

    const { text, keyboard } = rendered.data

    // Fire-and-forget: queue events are synchronous but Telegram API is async.
    // We start the async send without awaiting so the event listener returns
    // immediately (required — EventEmitter listeners must not return Promises;
    // an unhandled-rejection would crash the process with Node v15+ defaults).
    void (async () => {
      try {
        const result = await bot.api.sendMessage(targetChatId, text, {
          reply_markup: keyboard,
        })
        messageMap.set(decision.requestId, {
          chatId: targetChatId,
          messageId: result.message_id,
          text,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(
          `[bot] sendMessage failed for requestId=${decision.requestId}: ${msg}\n`,
        )
      }
    })()
  }

  /**
   * Edit the Telegram message for a terminal decision state.
   * @param decision   - The terminal decision (answered / expired / cancelled)
   * @param stateLabel - Human-readable label for the state, e.g. "Expired (no response)"
   */
  const editTerminal = (decision: Decision, stateLabel: string): void => {
    const record = messageMap.get(decision.requestId)
    if (!record) {
      // No record means sendMessage never succeeded (or this event fired for an
      // unknown decision). Nothing to edit.
      return
    }

    void (async () => {
      try {
        const newText = formatAnsweredText(record.text, stateLabel)
        await bot.api.editMessageText(record.chatId, record.messageId, newText, {
          // Pass an EMPTY InlineKeyboard to actually remove the buttons.
          //
          // Why not `reply_markup: undefined`? grammy's request serialiser drops
          // undefined fields via JSON.stringify, and Telegram interprets an
          // omitted reply_markup as "leave the existing keyboard unchanged".
          // The "Answered: X" text would appear, but the original Yes/No
          // buttons would still be clickable — letting the user submit a second
          // (now-rejected) answer.
          //
          // An empty InlineKeyboard serialises to `{ inline_keyboard: [] }`,
          // which Telegram treats as "replace with no buttons" — the buttons
          // disappear from the message.
          reply_markup: new InlineKeyboard(),
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        process.stderr.write(
          `[bot] editMessageText failed for requestId=${decision.requestId}: ${msg}\n`,
        )
      } finally {
        // Always delete, even on edit failure. The decision is in a terminal
        // state (answered / expired / cancelled) — its message will not be
        // edited again. If the user deleted the message or Telegram returned
        // an error, retrying via a later event would just fail the same way
        // and leak the record. Forgetting here keeps messageMap bounded.
        messageMap.delete(decision.requestId)
      }
    })()
  }

  const onAnswered: DecisionEventListener = (decision: Decision): void => {
    // Resolve the option label from the answered decision's options list.
    // decision.answer is the optionId (e.g. 'yes'); look up the label for display.
    let optionLabel = 'Unknown'
    if (decision.status === 'answered') {
      const option = decision.options.find((o) => o.id === decision.answer)
      optionLabel = option?.label ?? decision.answer
    }
    editTerminal(decision, optionLabel)
  }

  const onExpired: DecisionEventListener = (decision: Decision): void => {
    editTerminal(decision, 'Expired (no response)')
  }

  const onCancelled: DecisionEventListener = (decision: Decision): void => {
    editTerminal(decision, 'Cancelled')
  }

  // Subscribe to queue events immediately (before bot.start()).
  // The handlers use `bot.api` which is safe to call before `start()` since
  // grammy initialises the API client in the Bot constructor.
  deps.queue.on('created', onCreated)
  deps.queue.on('answered', onAnswered)
  deps.queue.on('expired', onExpired)
  deps.queue.on('cancelled', onCancelled)

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
  // Parses callback_data, calls deps.queue.answer, then ACKs the callback.
  // Message editing is handled by the 'answered' queue event listener above —
  // this keeps the two concerns (Telegram ACK vs. message edit) decoupled.
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

    const { requestId, optionId } = parsed.data

    // Call queue.answer. On success the 'answered' event fires synchronously
    // inside answer(), which triggers onAnswered → editTerminal (async, fire-
    // and-forget). This means the Telegram ACK below happens before the edit
    // completes, which is intentional — Telegram requires the ACK within 10s
    // and the edit is best-effort.
    const result = deps.queue.answer(requestId, optionId)

    if (!result.ok) {
      // Decision not found or no longer pending (already answered/expired/
      // cancelled). Show a toast so the user knows the action was a no-op.
      process.stderr.write(
        `[bot] queue.answer failed: ${result.error.error} — requestId=${requestId} optionId=${optionId}\n`,
      )
      await ctx.answerCallbackQuery({ text: 'Already handled' })
      return
    }

    // Success — ACK with a brief toast. The message edit happens via the
    // 'answered' event handler.
    await ctx.answerCallbackQuery({ text: 'OK' })
  })

  // ── BotHandle ──────────────────────────────────────────────────────────────
  return {
    async start(): Promise<void> {
      await bot.start()
    },
    async stop(): Promise<void> {
      // Unsubscribe from queue events BEFORE stopping the grammy bot.
      // This prevents a race where an in-flight 'created' event triggers a
      // sendMessage call after grammy has torn down its HTTP client.
      deps.queue.off('created', onCreated)
      deps.queue.off('answered', onAnswered)
      deps.queue.off('expired', onExpired)
      deps.queue.off('cancelled', onCancelled)

      if (bot.isRunning()) {
        await bot.stop()
      }
    },
    getBot(): Bot {
      return bot
    },
  }
}
