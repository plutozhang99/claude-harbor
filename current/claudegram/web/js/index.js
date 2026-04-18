/**
 * Boot orchestration for the claudegram PWA.
 * Wires together store, renderer, WebSocket client, and notifier.
 */

import { createWsClient } from './ws.js';
import { createStore } from './store.js';
import { createRenderer } from './render.js';
import { createNotifier } from './notify.js';

const store = createStore();
const renderer = createRenderer({ store, onSelectSession });
const notifier = createNotifier();
const ws = createWsClient(wsUrl());

ws.on('message', ({ session_id, message }) => {
  store.applyLiveMessage(session_id, message);
  if (session_id !== store.state.activeId) {
    notifier.notifyNewMessage(session_id, message);
  }
});

ws.on('session_update', ({ session }) => {
  store.applySessionUpdate(session);
});

// Boot sequence
(async () => {
  await fetchMe();
  await fetchSessions();
  if (store.state.sessions.size > 0) {
    const firstId = store.state.sessions.keys().next().value;
    await onSelectSession(firstId);
  }
})();

// Sidebar toggle
document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);

/**
 * Select a session: mark active and hydrate messages if not yet loaded.
 * @param {string} id
 */
async function onSelectSession(id) {
  store.setActive(id);
  await store.hydrateMessages(id, fetchMessages);
}

/**
 * Build the WebSocket URL from the current page origin.
 * @returns {string}
 */
function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/user-socket`;
}

/**
 * Toggle the sidebar open/closed via aria-expanded on the toggle button.
 */
function toggleSidebar() {
  const btn = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  if (!btn || !sidebar) return;
  const expanded = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!expanded));
  sidebar.classList.toggle('sidebar--open', !expanded);
}

/**
 * Fetch the current user and store in state.
 */
async function fetchMe() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { console.error('fetchMe: non-ok', res.status); return; }
    const data = await res.json();
    if (data.ok) store.state.me = data.email;
  } catch (e) {
    console.error('fetchMe error', e);
  }
}

/**
 * Fetch all sessions and populate the store.
 */
async function fetchSessions() {
  try {
    const res = await fetch('/api/sessions');
    if (!res.ok) { console.error('fetchSessions: non-ok', res.status); return; }
    const data = await res.json();
    if (data.ok) store.applySessions(data.sessions);
  } catch (e) {
    console.error('fetchSessions error', e);
  }
}

/**
 * Fetch messages for a given session.
 * @param {string} sessionId
 * @returns {Promise<{ messages: object[], has_more: boolean }>}
 */
async function fetchMessages(sessionId) {
  try {
    const res = await fetch(`/api/messages?session_id=${encodeURIComponent(sessionId)}`);
    if (!res.ok) { console.error('fetchMessages: non-ok', res.status); return { messages: [], has_more: false }; }
    const data = await res.json();
    if (data.ok) return { messages: data.messages, has_more: data.has_more };
  } catch (e) {
    console.error('fetchMessages error', e);
  }
  return { messages: [], has_more: false };
}
