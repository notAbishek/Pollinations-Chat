/**
 * usePollinationsAuth — handles the BYOP (Bring Your Own Pollen) OAuth flow
 * with enter.pollinations.ai.
 *
 * Flow:
 * 1. Redirect user to enter.pollinations.ai/authorize
 * 2. User signs in (GitHub)
 * 3. Redirected back with #api_key=sk_... in URL fragment
 * 4. Extract key, validate, store, and auto-authenticate
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { AuthState } from '../types';
import { validateApiKey, getProfile, PollinationsError } from '../lib/pollinations';
import { saveApiKey, getApiKey } from '../lib/storage';
import { isPaidTier } from '../lib/tier';

const AUTHORIZE_URL = 'https://enter.pollinations.ai/authorize';

/**
 * Module-level capture of the API key (or error) from the URL hash.
 * This runs once at import time — before any React lifecycle —
 * so it survives React.StrictMode's unmount/remount cycle.
 */
let _capturedHashKey: string | null = null;
let _capturedHashError: string | null = null;

(function captureHashOnce() {
  const hash = window.location.hash;
  if (!hash || hash.length <= 1) return;
  const params = new URLSearchParams(hash.slice(1));
  const key = params.get('api_key');
  const err = params.get('error');
  if (key) {
    _capturedHashKey = key;
  } else if (err) {
    // e.g. #error=access_denied — surface it instead of silently dropping the user
    const desc = params.get('error_description');
    _capturedHashError =
      err === 'access_denied'
        ? 'Sign-in was cancelled or denied. Please try again.'
        : desc || `Sign-in failed (${err}). Please try again.`;
  }
  if (key || err) {
    // Clear the fragment immediately (the key especially must not linger in the URL)
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState(null, '', url.pathname + url.search);
  }
})();

interface UsePollinationsAuthReturn {
  /** Whether the hook is currently processing an auth redirect or stored key */
  loading: boolean;
  /** Auth state if resolved, null otherwise */
  authState: AuthState | null;
  /** Error message if auth failed */
  error: string | null;
  /** Redirect user to enter.pollinations.ai to sign in */
  signIn: (options?: SignInOptions) => void;
}

interface SignInOptions {
  /** Comma-separated model names to allow */
  models?: string;
  /** Pollen budget limit */
  budget?: number;
  /** Key expiry in days (default: 30) */
  expiry?: number;
  /** Account permissions: profile, balance, usage */
  permissions?: string;
}

/**
 * Validate an API key and build the full AuthState.
 */
async function resolveAuthState(apiKey: string): Promise<AuthState> {
  const keyInfo = await validateApiKey(apiKey);

  if (!keyInfo.valid) {
    throw new Error('API key is invalid or expired');
  }

  let tier = 'anonymous';
  let nextResetAt: string | null = null;
  let isPro = false;

  try {
    const profile = await getProfile(apiKey);
    tier = profile.tier;
    nextResetAt = profile.nextResetAt ?? null;
    isPro = isPaidTier(tier); // only flower/nectar are paid
  } catch {
    // Profile unavailable (e.g. key lacks the permission) — we cannot confirm a
    // paid tier, so default to free rather than guessing from key type.
    isPro = false;
  }

  return {
    apiKey,
    valid: true,
    isPro,
    tier,
    nextResetAt,
  };
}

/**
 * Hook that manages the full Pollinations BYOP auth lifecycle:
 * - Checks URL hash for api_key on mount (OAuth redirect)
 * - Falls back to stored key from IndexedDB
 * - Provides signIn() to initiate the OAuth flow
 */
export function usePollinationsAuth(): UsePollinationsAuthReturn {
  const [loading, setLoading] = useState(true);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initRan = useRef(false);

  useEffect(() => {
    // Prevent double-init in StrictMode
    if (initRan.current) return;
    initRan.current = true;

    async function init() {
      // 0. An OAuth error fragment (e.g. #error=access_denied) takes priority.
      const hashError = _capturedHashError;
      _capturedHashError = null;
      if (hashError) {
        setError(hashError);
        setLoading(false);
        return;
      }

      try {
        // 1. Check if we captured a key from the URL hash (OAuth redirect)
        const hashKey = _capturedHashKey;
        _capturedHashKey = null; // consume it

        if (hashKey) {
          // Save key to storage FIRST so it persists even if validation is slow
          await saveApiKey(hashKey);

          // Validate and resolve full auth state
          const auth = await resolveAuthState(hashKey);
          setAuthState(auth);
          setLoading(false);
          return;
        }

        // 2. Fall back to stored key
        const storedKey = await getApiKey();
        if (storedKey) {
          const auth = await resolveAuthState(storedKey);
          setAuthState(auth);
          setLoading(false);
          return;
        }

        // 3. No key found — user needs to sign in
        setLoading(false);
      } catch (err) {
        // Branch on structured error data, not human-readable copy.
        if (err instanceof PollinationsError) {
          if (err.code === 'network_error' || err.status === 0) {
            setError('Unable to connect. Please check your internet connection.');
          } else if (err.code === 'invalid_key' || err.status === 401) {
            setError('Your session has expired. Please sign in again.');
          } else {
            setError(err.message || 'Authentication failed. Please try signing in again.');
          }
        } else if (err instanceof Error && /expired|invalid/i.test(err.message)) {
          setError('Your session has expired. Please sign in again.');
        } else {
          setError('Authentication failed. Please try signing in again.');
        }
        setLoading(false);
      }
    }

    init();
  }, []);

  const signIn = useCallback((options?: SignInOptions) => {
    const redirectUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({ redirect_url: redirectUrl });

    if (options?.models) params.set('models', options.models);
    if (options?.budget) params.set('budget', String(options.budget));
    if (options?.expiry) params.set('expiry', String(options.expiry));
    if (options?.permissions) params.set('permissions', options.permissions);

    window.location.href = `${AUTHORIZE_URL}?${params.toString()}`;
  }, []);

  return { loading, authState, error, signIn };
}
