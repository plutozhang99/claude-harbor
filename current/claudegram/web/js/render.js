/**
 * DOM renderer that reacts to store 'change' events and updates the UI.
 */

/**
 * Format a timestamp string or epoch ms into HH:MM:SS.
 * @param {string|number} ts
 * @returns {string}
 */
function formatTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/**
 * @param {{ store: ReturnType<import('./store.js').createStore>, onSelectSession: (id: string) => void }} opts
 */
export function createRenderer({ store, onSelectSession }) {
  const sessionListEl = document.getElementById('session-list');
  const messagesEl = document.getElementById('messages');
  const composeTextEl = document.getElementById('compose-text');
  const sendBtnEl = document.getElementById('send-btn');
  const composeFormEl = document.getElementById('compose');

  let prevMessageCount = 0;

  // Wire compose textarea to enable/disable send button
  composeTextEl?.addEventListener('input', updateSendBtn);

  // P1 stub: form submit is a no-op — replies arrive in P2
  composeFormEl?.addEventListener('submit', (e) => {
    e.preventDefault();
    // TODO(P2): send reply via POST /api/messages
  });

  function updateSendBtn() {
    if (!sendBtnEl || !composeTextEl) return;
    const hasText = composeTextEl.value.trim().length > 0;
    const hasSession = store.state.activeId !== null;
    sendBtnEl.disabled = !(hasText && hasSession);
  }

  function renderSessions() {
    if (!sessionListEl) return;
    const { sessions, activeId } = store.state;

    if (sessions.size === 0) {
      sessionListEl.innerHTML = '<li class="session-placeholder" role="presentation">no sessions yet</li>';
      return;
    }

    // Remove placeholder if present
    const placeholder = sessionListEl.querySelector('.session-placeholder');
    if (placeholder) placeholder.remove();

    const existingIds = new Set();
    for (const li of sessionListEl.querySelectorAll('li[data-session-id]')) {
      existingIds.add(li.dataset.sessionId);
    }

    for (const [id, session] of sessions) {
      const isActive = id === activeId;
      let li = sessionListEl.querySelector(`li[data-session-id="${CSS.escape(id)}"]`);
      if (!li) {
        li = document.createElement('li');
        li.dataset.sessionId = id;
        li.setAttribute('role', 'option');
        li.setAttribute('tabindex', '0');
        li.addEventListener('click', () => onSelectSession(id));
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectSession(id);
          }
        });
        sessionListEl.appendChild(li);
      }

      li.setAttribute('aria-selected', String(isActive));
      li.classList.toggle('active', isActive);

      const unread = session.unread_count ?? 0;
      const badge = unread > 0 ? ` <span class="unread-badge" aria-label="${unread} unread">${unread}</span>` : '';
      li.innerHTML = `<span class="session-name">${escapeHtml(session.name ?? id)}</span>${badge}`;
    }

    // Remove stale entries
    for (const li of sessionListEl.querySelectorAll('li[data-session-id]')) {
      if (!sessions.has(li.dataset.sessionId)) li.remove();
    }
  }

  function renderMessages() {
    if (!messagesEl) return;
    const { activeId, messagesBySession } = store.state;
    if (!activeId) {
      prevMessageCount = 0;
      messagesEl.innerHTML = '';
      return;
    }

    const messages = messagesBySession.get(activeId) ?? [];
    const isNewLive = messages.length > prevMessageCount && prevMessageCount > 0;
    prevMessageCount = messages.length;

    // Full re-render (simple approach for P1 — virtualisation is P2+)
    messagesEl.innerHTML = '';
    for (const msg of messages) {
      const li = document.createElement('li');
      li.dataset.from = msg.direction;
      li.dataset.msgId = String(msg.id);
      li.innerHTML =
        `<span class="msg-meta">` +
        `<span class="ts">${escapeHtml(formatTime(msg.ts ?? msg.ingested_at))}</span>` +
        `<span class="who">${escapeHtml(msg.direction === 'inbound' ? 'them' : 'you')}</span>` +
        `</span>` +
        `<span class="msg-body">${escapeHtml(String(msg.content ?? ''))}</span>`;
      messagesEl.appendChild(li);
    }

    if (isNewLive) {
      messagesEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } else if (messages.length > 0) {
      messagesEl.lastElementChild?.scrollIntoView({ block: 'end' });
    }
  }

  function render() {
    renderSessions();
    renderMessages();
    updateSendBtn();
  }

  store.on('change', render);

  return { render };
}

/**
 * Minimal HTML escaping to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
