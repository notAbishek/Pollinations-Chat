/**
 * IndexedDB-based local storage for chat sessions, settings, and the API key,
 * using the `idb` library.
 *
 * ⚠️ Data is stored locally in your browser only. Clearing the browser loses it.
 *
 * Threat model for the API key: it lives in origin-isolated IndexedDB. Unlike a
 * non-HttpOnly cookie it is NOT auto-attached to requests (no CSRF surface) and
 * is only read by this app's code. A client-only app cannot fully hide a key
 * from a successful XSS; the markdown renderer is configured to not execute raw
 * HTML to keep that surface small. For full secrecy, proxy generation through a
 * backend so the key never reaches the browser.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { ChatSession, AppSettings } from '../types';

const DB_NAME = 'pollinations-chat';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const SETTINGS_STORE = 'settings';
const API_KEY_ID = 'api-key';
const LEGACY_API_KEY_COOKIE = 'pollinations_api_key';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          const store = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
        }
      },
      blocked() {
        console.warn('[storage] DB open blocked by another tab');
      },
    }).catch((err) => {
      // Don't cache a rejected promise forever — allow a later retry.
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

// ─── Session CRUD ────────────────────────────────────────────────

/** Persist a session. Throws on failure so callers can surface the error. */
export async function saveSession(session: ChatSession): Promise<void> {
  const db = await getDB();
  await db.put(SESSIONS_STORE, session);
}

export async function getSession(id: string): Promise<ChatSession | undefined> {
  try {
    const db = await getDB();
    return await db.get(SESSIONS_STORE, id);
  } catch {
    console.warn('[storage] Failed to get session');
    return undefined;
  }
}

export async function getAllSessions(): Promise<ChatSession[]> {
  try {
    const db = await getDB();
    const sessions = await db.getAll(SESSIONS_STORE);
    return sessions.sort(
      (a: ChatSession, b: ChatSession) => b.updatedAt - a.updatedAt,
    );
  } catch {
    console.warn('[storage] Failed to get all sessions');
    return [];
  }
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(SESSIONS_STORE, id);
}

export async function clearAllSessions(): Promise<void> {
  const db = await getDB();
  await db.clear(SESSIONS_STORE);
}

// ─── Settings ────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  showUsageIcon: true,
  autoFetchUsage: true,
  autoReadBalance: true,
  selectedModel: 'openai',
  systemPrompt: 'You are a helpful assistant.',
  temperature: 0.7,
  creativity: 0.5,
  enablePromptEnhancement: false,
  theme: 'system',
};

export async function getSettings(): Promise<AppSettings> {
  try {
    const db = await getDB();
    const row = await db.get(SETTINGS_STORE, 'app-settings');
    if (!row) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...row.value };
  } catch {
    console.warn('[storage] Failed to get settings, using defaults');
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<void> {
  try {
    const db = await getDB();
    // Atomic read-modify-write in a single transaction (no last-writer-wins race).
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    const row = await store.get('app-settings');
    const current: Partial<AppSettings> = row?.value ?? {};
    await store.put({
      key: 'app-settings',
      value: { ...DEFAULT_SETTINGS, ...current, ...settings },
    });
    await tx.done;
  } catch {
    console.warn('[storage] Failed to save settings');
  }
}

// ─── API Key (origin-isolated IndexedDB) ─────────────────────────

export async function saveApiKey(apiKey: string): Promise<void> {
  const db = await getDB();
  await db.put(SETTINGS_STORE, { key: API_KEY_ID, value: apiKey });
}

export async function getApiKey(): Promise<string | null> {
  try {
    const db = await getDB();
    const row = await db.get(SETTINGS_STORE, API_KEY_ID);
    if (row?.value) return row.value as string;

    // One-time migration: an older build stored the key in a cookie.
    const cookieKey = readLegacyCookieKey();
    if (cookieKey) {
      await saveApiKey(cookieKey);
      clearLegacyCookieKey();
      return cookieKey;
    }
    return null;
  } catch {
    console.warn('[storage] Failed to get API key');
    return null;
  }
}

export async function clearApiKey(): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(SETTINGS_STORE, API_KEY_ID);
  } catch {
    console.warn('[storage] Failed to clear API key');
  }
  clearLegacyCookieKey();
}

function readLegacyCookieKey(): string | null {
  try {
    for (const cookie of document.cookie.split(';')) {
      const [name, ...valueParts] = cookie.trim().split('=');
      if (name === LEGACY_API_KEY_COOKIE) {
        return decodeURIComponent(valueParts.join('=')) || null;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function clearLegacyCookieKey(): void {
  try {
    document.cookie = `${LEGACY_API_KEY_COOKIE}=;path=/;max-age=0;SameSite=Strict`;
  } catch {
    /* ignore */
  }
}

// ─── Last active session ─────────────────────────────────────────

export async function setLastActiveSession(id: string): Promise<void> {
  try {
    const db = await getDB();
    await db.put(SETTINGS_STORE, { key: 'last-session', value: id });
  } catch {
    console.warn('[storage] Failed to set last active session');
  }
}

export async function getLastActiveSession(): Promise<string | null> {
  try {
    const db = await getDB();
    const row = await db.get(SETTINGS_STORE, 'last-session');
    return row?.value ?? null;
  } catch {
    console.warn('[storage] Failed to get last active session');
    return null;
  }
}
