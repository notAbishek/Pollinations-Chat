/**
 * App — root component.
 *
 * Manages authentication state and loads models on key validation.
 */

import { useState, useEffect, useCallback } from 'react';
import type { PollinationsModel, AuthState } from './types';
import { getAllModels } from './lib/pollinations';
import { saveApiKey, clearApiKey } from './lib/storage';
import { usePollinationsAuth } from './hooks/usePollinationsAuth';
import { useNotifications } from './hooks/useNotifications';
import AuthScreen from './components/AuthScreen';
import ChatPage from './components/ChatPage';
import Notifications from './components/Notifications';

const EMPTY_AUTH: AuthState = {
  apiKey: '',
  valid: false,
  isPro: false,
  tier: 'anonymous',
  nextResetAt: null,
};

export default function App() {
  const [authState, setAuthState] = useState<AuthState>(EMPTY_AUTH);
  const [models, setModels] = useState<PollinationsModel[]>([]);
  const [loading, setLoading] = useState(true);
  const {
    notifications,
    removeNotification,
    notifySuccess,
    notifyError,
    notifyInfo,
  } = useNotifications();

  // Auto-auth: handles OAuth redirect from enter.pollinations.ai
  const {
    loading: autoAuthLoading,
    authState: autoAuthState,
    error: autoAuthError,
  } = usePollinationsAuth();

  /* ── auto-auth resolved — apply it ──────────────────── */
  useEffect(() => {
    if (autoAuthLoading) return;

    if (autoAuthState) {
      // Auto-auth succeeded (either from redirect or stored key)
      (async () => {
        try {
          const allModels = await getAllModels(autoAuthState.apiKey);
          setModels(allModels);
        } catch {
          // Models fetch failed but auth is valid
        }
        setAuthState(autoAuthState);
        setLoading(false);
        notifySuccess(`Authenticated (${autoAuthState.tier} tier)`);
      })();
    } else {
      // No auto-auth — show auth screen
      setLoading(false);
    }
  }, [autoAuthLoading, autoAuthState, notifySuccess]);

  /* ── restore persisted key on mount (fallback, runs if auto-auth didn't find anything) ── */
  // Note: usePollinationsAuth already handles stored key restoration,
  // so this effect is now handled by the auto-auth hook above.

  /* ── auth success callback (receives full AuthState from AuthScreen) ── */
  const handleAuth = useCallback(
    async (auth: AuthState) => {
      await saveApiKey(auth.apiKey);
      try {
        const allModels = await getAllModels(auth.apiKey);
        setModels(allModels);
      } catch {
        notifyError('Failed to load models. Some features may be limited.');
      }
      setAuthState(auth);
      notifySuccess(`Authenticated (${auth.tier} tier)`);
    },
    [notifySuccess, notifyError],
  );

  /* ── logout ─────────────────────────────────────────── */
  const handleLogout = useCallback(async () => {
    await clearApiKey();
    setAuthState(EMPTY_AUTH);
    setModels([]);
    notifyInfo('Logged out');
  }, [notifyInfo]);

  /* ── loading state ──────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      </div>
    );
  }

  /* ── render ─────────────────────────────────────────── */
  return (
    <>
      {authState.valid && authState.apiKey ? (
        <ChatPage
          auth={authState}
          models={models}
          notifySuccess={notifySuccess}
          notifyError={notifyError}
          onLogout={handleLogout}
        />
      ) : (
        <AuthScreen onAuth={handleAuth} autoAuthError={autoAuthError} />
      )}

      <Notifications notifications={notifications} onDismiss={removeNotification} />
    </>
  );
}
