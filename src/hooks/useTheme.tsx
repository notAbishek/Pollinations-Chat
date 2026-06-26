/**
 * Theme system — light / dark / system, with a localStorage source of truth
 * (mirrored by the pre-paint script in index.html so there is no FOUC).
 *
 * Wrap the app in <ThemeProvider> and read the current theme with useTheme().
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { ThemePreference } from '../types';

const STORAGE_KEY = 'pollinations-theme';

interface ThemeContextValue {
  /** What the user chose: 'dark' | 'light' | 'system' */
  preference: ThemePreference;
  /** The theme actually applied right now: 'dark' | 'light' */
  resolved: 'dark' | 'light';
  setPreference: (pref: ThemePreference) => void;
  /** Convenience: cycle light → dark → system → light */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'dark' || v === 'light' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

function applyTheme(dark: boolean): void {
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0E0A14' : '#FBF7F0');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(
    readStoredPreference,
  );
  const [resolved, setResolved] = useState<'dark' | 'light'>(() =>
    preference === 'dark' || (preference === 'system' && systemPrefersDark())
      ? 'dark'
      : 'light',
  );

  // Apply theme whenever the preference (or, in system mode, the OS) changes.
  useEffect(() => {
    const resolve = () => {
      const dark =
        preference === 'dark' ||
        (preference === 'system' && systemPrefersDark());
      applyTheme(dark);
      setResolved(dark ? 'dark' : 'light');
    };
    resolve();

    if (preference !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', resolve);
    return () => mq.removeEventListener('change', resolve);
  }, [preference]);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      /* ignore */
    }
  }, []);

  const cycle = useCallback(() => {
    setPreference(
      preference === 'light'
        ? 'dark'
        : preference === 'dark'
          ? 'system'
          : 'light',
    );
  }, [preference, setPreference]);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference, cycle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
