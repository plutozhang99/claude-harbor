import { InlineKeyboard } from 'grammy'
import {
  PERMISSION_OPTION_IDS,
  type PermissionCategory,
  type RequestId,
  encodeCallbackData,
  type Result,
} from '@claudegram/shared'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PermissionMessage {
  readonly text: string
  readonly keyboard: InlineKeyboard
}

export type RenderError = 'callback_encode_failed' | 'message_too_long'

/**
 * Telegram's hard limit on outgoing message text size (UTF-8 bytes).
 * Exceeding this returns HTTP 400 from sendMessage. We check at render time so
 * the failure surfaces with a structured error close to the root cause, instead
 * of as a grammy network exception in the Phase 3B reply path.
 */
const TELEGRAM_MAX_MESSAGE_BYTES = 4096

export interface RenderInput {
  readonly requestId: RequestId
  readonly sessionName: string
  readonly category: PermissionCategory
  /** Short question or action label, e.g. "Overwrite architecture_overview.md?" */
  readonly title: string
  /** Detailed context — may be multi-line, e.g. a file path or shell command */
  readonly description: string
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Maps a PermissionCategory to the human-readable type label used in the
 * permission message header (e.g. "Edit", "Bash", "MCP").
 */
function categoryTypeLabel(category: PermissionCategory): string {
  switch (category) {
    case 'file_edit':
      return 'Edit'
    case 'bash':
      return 'Bash'
    case 'mcp_tool':
      return 'MCP'
  }
}

/**
 * Returns the three button labels for the 3-button permission UX.
 * Order: [Yes, Yes-all, No] — matches PERMISSION_OPTION_IDS ('yes' | 'yes_all' | 'no').
 */
function categoryButtonLabels(
  category: PermissionCategory,
): readonly [string, string, string] {
  switch (category) {
    case 'file_edit':
      return ['Yes', 'Yes, all edits', 'No']
    case 'bash':
      return ['Yes', 'Yes, all Bash', 'No']
    case 'mcp_tool':
      return ['Yes', 'Yes, all MCP', 'No']
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the Telegram message text and InlineKeyboard for a permission prompt.
 *
 * Pure function — no I/O, no grammy network calls (InlineKeyboard construction
 * is purely in-memory).
 *
 * Message format (per PRD F2):
 * ```
 * [<sessionName>] <Type> Permission
 *
 * <title>
 *
 * <description>
 * ```
 *
 * Failure modes:
 * - `'message_too_long'`     — text exceeds TELEGRAM_MAX_MESSAGE_BYTES (4096 UTF-8 bytes).
 * - `'callback_encode_failed'` — any of the three encodeCallbackData calls failed
 *                                 (e.g. requestId unexpectedly long).
 */
export function renderPermissionMessage(
  input: RenderInput,
): Result<PermissionMessage, RenderError> {
  const { requestId, sessionName, category, title, description } = input
  const typeLabel = categoryTypeLabel(category)
  const buttonLabels = categoryButtonLabels(category)

  // Build the text first and check Telegram's 4096-byte limit before doing any
  // callback encoding work — fast-fail on the most likely overflow source
  // (long descriptions / titles) without wasting cycles on encoding.
  const text = `[${sessionName}] ${typeLabel} Permission\n\n${title}\n\n${description}`
  if (new TextEncoder().encode(text).byteLength > TELEGRAM_MAX_MESSAGE_BYTES) {
    return { ok: false, error: 'message_too_long' }
  }

  // Encode callback_data for each button in PERMISSION_OPTION_IDS order.
  // We need all three before building anything so we can fail atomically.
  const encodedResults = PERMISSION_OPTION_IDS.map((optionId) =>
    encodeCallbackData(requestId, optionId),
  )

  for (const result of encodedResults) {
    if (!result.ok) {
      return { ok: false, error: 'callback_encode_failed' }
    }
  }

  // All encodes succeeded — extract the callback_data strings.
  // The `as` cast is safe: we verified ok:true for every entry above.
  const [yesCbData, yesAllCbData, noCbData] = encodedResults.map(
    (r) => (r as { ok: true; data: string }).data,
  )

  const keyboard = new InlineKeyboard()
    .text(buttonLabels[0], yesCbData)
    .text(buttonLabels[1], yesAllCbData)
    .text(buttonLabels[2], noCbData)

  return { ok: true, data: { text, keyboard } }
}
