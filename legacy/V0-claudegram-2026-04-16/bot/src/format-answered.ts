/**
 * Returns the "answered" version of a permission message by appending the
 * chosen option label to the original message body.
 *
 * Used by Phase 3B after a callback_query is handled: the bot edits the
 * original Telegram message, replacing the inline keyboard with a plain
 * "Answered: <label>" line.
 *
 * Format (per PRD F2, lines 134-141):
 * ```
 * <originalText>
 *
 * Answered: <optionLabel>
 * ```
 *
 * Pure function — no I/O, no grammy calls.
 *
 * @param originalText  - The full text of the permission message as sent.
 * @param optionLabel   - The human-readable label of the chosen button,
 *                        e.g. "Yes", "Yes, all edits", "No".
 */
export function formatAnsweredText(
  originalText: string,
  optionLabel: string,
): string {
  return `${originalText}\n\nAnswered: ${optionLabel}`
}
