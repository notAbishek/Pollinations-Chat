/**
 * IndexedDB-based local storage for chat sessions using the `idb` library.
 *
 * ⚠️ DATABASE IS NOT AVAILABLE — chats are stored locally only.
 * If you clear your browser, data will be lost. Use Export to backup.
 */

import { openDB, type IDBPDatabase } from 'idb';
import type { ChatSession, AppSettings } from '../types';

const DB_NAME = 'pollinations-chat';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const SETTINGS_STORE = 'settings';

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
    });
  }
  return dbPromise;
}

// ─── Session CRUD ────────────────────────────────────────────────

export async function saveSession(session: ChatSession): Promise<void> {
  try {
    const db = await getDB();
    await db.put(SESSIONS_STORE, session);
  } catch {
    console.warn('[storage] Failed to save session');
  }
}

export async function getSession(id: string): Promise<ChatSession | undefined> {
  try {
    const db = await getDB();
    return db.get(SESSIONS_STORE, id);
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
  try {
    const db = await getDB();
    await db.delete(SESSIONS_STORE, id);
  } catch {
    console.warn('[storage] Failed to delete session');
  }
}

export async function clearAllSessions(): Promise<void> {
  try {
    const db = await getDB();
    await db.clear(SESSIONS_STORE);
  } catch {
    console.warn('[storage] Failed to clear sessions');
  }
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
  theme: 'dark',
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
    const current = await getSettings();
    await db.put(SETTINGS_STORE, {
      key: 'app-settings',
      value: { ...current, ...settings },
    });
  } catch {
    console.warn('[storage] Failed to save settings');
  }
}

// ─── API Key (stored in cookies) ─────────────────────────────────

const API_KEY_COOKIE = 'pollinations_api_key';

export async function saveApiKey(apiKey: string): Promise<void> {
  try {
    const maxAge = 365 * 24 * 60 * 60; // 1 year
    const secure = window.location.protocol === 'https:' ? ';Secure' : '';
    document.cookie = `${API_KEY_COOKIE}=${encodeURIComponent(apiKey)};path=/;max-age=${maxAge};SameSite=Strict${secure}`;
  } catch {
    console.warn('[storage] Failed to save API key to cookie');
  }
}

export async function getApiKey(): Promise<string | null> {
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, ...valueParts] = cookie.trim().split('=');
      if (name === API_KEY_COOKIE) {
        const value = decodeURIComponent(valueParts.join('='));
        return value || null;
      }
    }
    // Migration: check IndexedDB for existing key and migrate to cookie
    try {
      const db = await getDB();
      const row = await db.get(SETTINGS_STORE, 'api-key');
      if (row?.value) {
        await saveApiKey(row.value); // Migrate to cookie
        await db.delete(SETTINGS_STORE, 'api-key'); // Remove from IDB
        return row.value;
      }
    } catch {
      // IDB migration failed, not critical
    }
    return null;
  } catch {
    console.warn('[storage] Failed to get API key from cookie');
    return null;
  }
}

export async function clearApiKey(): Promise<void> {
  try {
    document.cookie = `${API_KEY_COOKIE}=;path=/;max-age=0;SameSite=Strict`;
    // Also clean up any old IDB entry
    try {
      const db = await getDB();
      await db.delete(SETTINGS_STORE, 'api-key');
    } catch {
      // Not critical
    }
  } catch {
    console.warn('[storage] Failed to clear API key cookie');
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
