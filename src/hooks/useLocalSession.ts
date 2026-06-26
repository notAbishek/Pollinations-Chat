/**
 * Hook: manage chat sessions in IndexedDB with auto-restore.
 *
 * Persistence is performed OUTSIDE React state updaters (updaters stay pure, so
 * StrictMode's double-invoke can't double-write). Streaming updates are
 * debounced so we don't serialize the whole session to IndexedDB on every
 * token; call flushPersist() to force the final write. Save failures are
 * surfaced via the callback registered with setOnPersistError().
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import type { ChatSession, ChatMessage } from '../types';
import {
  saveSession,
  getAllSessions,
  deleteSession as deleteSessionFromDB,
  clearAllSessions as clearAllSessionsFromDB,
  getLastActiveSession,
  setLastActiveSession,
} from '../lib/storage';

const PERSIST_DEBOUNCE_MS = 400;

export function useLocalSession() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Mirror of `sessions` so mutations can compute the next state purely from a ref.
  const sessionsRef = useRef<ChatSession[]>([]);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Persistence error sink (wired to a toast by the consumer).
  const onPersistError = useRef<(msg: string) => void>(() => {});
  const setOnPersistError = useCallback((fn: (msg: string) => void) => {
    onPersistError.current = fn;
  }, []);

  // Debounced write buffer for the streaming hot path.
  const pendingWrites = useRef<Map<string, ChatSession>>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistNow = useCallback(async (session: ChatSession) => {
    try {
      await saveSession(session);
    } catch {
      onPersistError.current('Could not save your chat locally — storage may be full.');
    }
  }, []);

  const flushPersist = useCallback(async () => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const items = [...pendingWrites.current.values()];
    pendingWrites.current.clear();
    for (const s of items) await persistNow(s);
  }, [persistNow]);

  const schedulePersist = useCallback(
    (session: ChatSession) => {
      pendingWrites.current.set(session.id, session);
      if (flushTimer.current) return;
      flushTimer.current = setTimeout(() => {
        flushTimer.current = null;
        void flushPersist();
      }, PERSIST_DEBOUNCE_MS);
    },
    [flushPersist],
  );

  // Flush any pending writes when the tab is hidden/closed.
  useEffect(() => {
    const handler = () => {
      if (pendingWrites.current.size) void flushPersist();
    };
    window.addEventListener('pagehide', handler);
    document.addEventListener('visibilitychange', handler);
    return () => {
      window.removeEventListener('pagehide', handler);
      document.removeEventListener('visibilitychange', handler);
    };
  }, [flushPersist]);

  // Load sessions and restore last active.
  useEffect(() => {
    (async () => {
      const all = await getAllSessions();
      sessionsRef.current = all;
      setSessions(all);
      const lastId = await getLastActiveSession();
      if (lastId && all.some((s) => s.id === lastId)) {
        setActiveSessionId(lastId);
      } else if (all.length > 0) {
        setActiveSessionId(all[0].id);
      }
      setLoaded(true);
    })();
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  /** Read the current session straight from the live ref (avoids stale closures). */
  const getSessionById = useCallback(
    (id: string | null): ChatSession | undefined =>
      id ? sessionsRef.current.find((s) => s.id === id) : undefined,
    [],
  );

  /** Apply a pure transform to one session, update state + ref, return the new session. */
  const applyToSession = useCallback(
    (sessionId: string, transform: (s: ChatSession) => ChatSession): ChatSession | undefined => {
      const next = sessionsRef.current.map((s) =>
        s.id === sessionId ? transform(s) : s,
      );
      sessionsRef.current = next;
      setSessions(next);
      return next.find((s) => s.id === sessionId);
    },
    [],
  );

  const createSession = useCallback(
    async (model: string, title?: string): Promise<ChatSession> => {
      const session: ChatSession = {
        id: uuid(),
        title: title ?? 'New Chat',
        messages: [],
        model,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        totalPollenSpent: 0,
      };
      const next = [session, ...sessionsRef.current];
      sessionsRef.current = next;
      setSessions(next);
      setActiveSessionId(session.id);
      await persistNow(session);
      await setLastActiveSession(session.id);
      return session;
    },
    [persistNow],
  );

  const switchSession = useCallback(async (id: string) => {
    setActiveSessionId(id);
    await setLastActiveSession(id);
  }, []);

  const addMessage = useCallback(
    (sessionId: string, message: ChatMessage) => {
      const updated = applyToSession(sessionId, (s) => ({
        ...s,
        messages: [...s.messages, message],
        updatedAt: Date.now(),
        title:
          s.messages.length === 0 && message.role === 'user'
            ? message.content.slice(0, 50) + (message.content.length > 50 ? '…' : '')
            : s.title,
      }));
      if (updated) void persistNow(updated);
    },
    [applyToSession, persistNow],
  );

  /** Hot path during streaming — debounced persistence. */
  const updateMessage = useCallback(
    (sessionId: string, messageId: string, update: Partial<ChatMessage>) => {
      const updated = applyToSession(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => (m.id === messageId ? { ...m, ...update } : m)),
        updatedAt: Date.now(),
      }));
      if (updated) schedulePersist(updated);
    },
    [applyToSession, schedulePersist],
  );

  const updateSessionPollen = useCallback(
    (sessionId: string, pollenDelta: number) => {
      const updated = applyToSession(sessionId, (s) => ({
        ...s,
        totalPollenSpent: s.totalPollenSpent + pollenDelta,
        updatedAt: Date.now(),
      }));
      if (updated) void persistNow(updated);
    },
    [applyToSession, persistNow],
  );

  const renameSession = useCallback(
    (id: string, title: string) => {
      const updated = applyToSession(id, (s) => ({ ...s, title, updatedAt: Date.now() }));
      if (updated) void persistNow(updated);
    },
    [applyToSession, persistNow],
  );

  const deleteSessionById = useCallback(async (id: string) => {
    const next = sessionsRef.current.filter((s) => s.id !== id);
    sessionsRef.current = next;
    setSessions(next);
    // Fall back to the next remaining chat instead of dumping to empty state.
    setActiveSessionId((prev) => {
      if (prev !== id) return prev;
      const fallback = next[0]?.id ?? null;
      if (fallback) void setLastActiveSession(fallback);
      return fallback;
    });
    try {
      await deleteSessionFromDB(id);
    } catch {
      onPersistError.current('Could not delete the chat from local storage.');
    }
  }, []);

  const deleteMessage = useCallback(
    (sessionId: string, messageId: string) => {
      const updated = applyToSession(sessionId, (s) => ({
        ...s,
        messages: s.messages.filter((m) => m.id !== messageId),
        updatedAt: Date.now(),
      }));
      if (updated) void persistNow(updated);
    },
    [applyToSession, persistNow],
  );

  const deleteMessagesFrom = useCallback(
    async (sessionId: string, messageId: string) => {
      const updated = applyToSession(sessionId, (s) => {
        const idx = s.messages.findIndex((m) => m.id === messageId);
        if (idx === -1) return s;
        return { ...s, messages: s.messages.slice(0, idx), updatedAt: Date.now() };
      });
      if (updated) await persistNow(updated);
    },
    [applyToSession, persistNow],
  );

  const replaceMessageContent = useCallback(
    (sessionId: string, messageId: string, newContent: string) => {
      const updated = applyToSession(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === messageId ? { ...m, content: newContent } : m,
        ),
        updatedAt: Date.now(),
      }));
      if (updated) void persistNow(updated);
    },
    [applyToSession, persistNow],
  );

  const clearAll = useCallback(async () => {
    sessionsRef.current = [];
    setSessions([]);
    setActiveSessionId(null);
    try {
      await clearAllSessionsFromDB();
    } catch {
      onPersistError.current('Could not clear local storage.');
    }
  }, []);

  /** Import sessions, remapping ids that collide with live sessions. Returns counts. */
  const importSessions = useCallback(async (imported: ChatSession[]) => {
    const existingIds = new Set(sessionsRef.current.map((s) => s.id));
    let added = 0;
    let remapped = 0;
    for (const s of imported) {
      let session = s;
      if (existingIds.has(s.id)) {
        session = { ...s, id: uuid() };
        remapped++;
      }
      existingIds.add(session.id);
      try {
        await saveSession(session);
        added++;
      } catch {
        onPersistError.current('Some chats could not be saved during import.');
      }
    }
    const all = await getAllSessions();
    sessionsRef.current = all;
    setSessions(all);
    return { added, remapped };
  }, []);

  return {
    sessions,
    activeSession,
    activeSessionId,
    getSessionById,
    loaded,
    createSession,
    switchSession,
    addMessage,
    updateMessage,
    updateSessionPollen,
    renameSession,
    deleteSession: deleteSessionById,
    deleteMessage,
    deleteMessagesFrom,
    replaceMessageContent,
    importSessions,
    clearAll,
    flushPersist,
    setOnPersistError,
  };
}
