/**
 * In-memory application store with event emission.
 * All mutations return new state; the map references are replaced, not mutated.
 */

/**
 * @returns {{
 *   state: { me: null|object, sessions: Map, messagesBySession: Map, hasMoreBySession: Map, activeId: null|string },
 *   on(evt: string, handler: Function): void,
 *   off(evt: string, handler: Function): void,
 *   setActive(sessionId: string): void,
 *   applySessions(sessions: object[]): void,
 *   applyMessages(sessionId: string, messages: object[], has_more: boolean): void,
 *   applyLiveMessage(sessionId: string, message: object): void,
 *   applySessionUpdate(session: object): void,
 *   hydrateMessages(sessionId: string, fetcher: Function): Promise<void>
 * }}
 */
export function createStore() {
  const state = {
    me: null,
    sessions: new Map(),
    messagesBySession: new Map(),
    hasMoreBySession: new Map(),
    activeId: null,
  };

  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  function emit(evt) {
    const set = listeners.get(evt);
    if (!set) return;
    for (const fn of set) {
      try { fn(state); } catch (e) { console.error('store listener error', e); }
    }
  }

  function on(evt, handler) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(handler);
  }

  function off(evt, handler) {
    listeners.get(evt)?.delete(handler);
  }

  function setActive(sessionId) {
    state.activeId = sessionId;
    // clear unread for newly active session
    const session = state.sessions.get(sessionId);
    if (session) {
      state.sessions = new Map(state.sessions);
      state.sessions.set(sessionId, { ...session, unread_count: 0 });
    }
    emit('change');
  }

  function applySessions(sessions) {
    state.sessions = new Map(sessions.map((s) => [s.id, s]));
    emit('change');
  }

  function applyMessages(sessionId, messages, has_more) {
    state.messagesBySession = new Map(state.messagesBySession);
    state.messagesBySession.set(sessionId, messages);
    state.hasMoreBySession = new Map(state.hasMoreBySession);
    state.hasMoreBySession.set(sessionId, has_more);
    emit('change');
  }

  function applyLiveMessage(sessionId, message) {
    // Only append if session is already hydrated
    if (!state.messagesBySession.has(sessionId)) return;

    const prev = state.messagesBySession.get(sessionId);
    state.messagesBySession = new Map(state.messagesBySession);
    state.messagesBySession.set(sessionId, [...prev, message]);

    // Bump unread count if not the active session
    if (sessionId !== state.activeId) {
      const session = state.sessions.get(sessionId);
      if (session) {
        state.sessions = new Map(state.sessions);
        state.sessions.set(sessionId, {
          ...session,
          unread_count: (session.unread_count ?? 0) + 1,
        });
      }
    }

    emit('change');
  }

  function applySessionUpdate(session) {
    state.sessions = new Map(state.sessions);
    const existing = state.sessions.get(session.id) ?? {};
    state.sessions.set(session.id, { ...existing, ...session });
    emit('change');
  }

  /** @type {Set<string>} */
  const hydrating = new Set();

  async function hydrateMessages(sessionId, fetcher) {
    if (state.messagesBySession.has(sessionId)) return;
    if (hydrating.has(sessionId)) return;
    hydrating.add(sessionId);
    try {
      const { messages, has_more } = await fetcher(sessionId);
      applyMessages(sessionId, messages, has_more);
    } finally {
      hydrating.delete(sessionId);
    }
  }

  return {
    state,
    on,
    off,
    setActive,
    applySessions,
    applyMessages,
    applyLiveMessage,
    applySessionUpdate,
    hydrateMessages,
  };
}
