/**
 * Browser notification stub for P1.
 * Permission prompting and actual notifications are implemented in P3.
 */

/**
 * @returns {{
 *   requestPermission(): NotificationPermission,
 *   notifyNewMessage(sessionId: string, message: object): void
 * }}
 */
export function createNotifier() {
  /**
   * Returns current permission state without prompting the user.
   * P3 will call Notification.requestPermission() here.
   * @returns {NotificationPermission}
   */
  function requestPermission() {
    if (typeof Notification === 'undefined') return 'denied';
    return Notification.permission;
  }

  /**
   * No-op in P1. P3 will fire browser notifications here.
   * @param {string} _sessionId
   * @param {object} _message
   */
  function notifyNewMessage(_sessionId, _message) {
    // TODO(P3): show browser notification for new messages in background tabs
  }

  return { requestPermission, notifyNewMessage };
}
