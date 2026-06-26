/**
 * AuthScreen — API key entry & validation.
 *
 * Flow:
 * 1. User enters API key
 * 2. Validate using GET /account/key
 * 3. Fetch profile to determine tier (pro/normal)
 * 4. On success, call onAuth with AuthState
 */

import { useState } from 'react';
import type { AuthState } from '../types';
import { validateApiKey, getProfile, PollinationsError } from '../lib/pollinations';
import { saveApiKey } from '../lib/storage';
import { isPaidTier } from '../lib/tier';

const AUTHORIZE_URL = 'https://enter.pollinations.ai/authorize';

interface AuthScreenProps {
  onAuth: (auth: AuthState) => void;
  /** Error from auto-auth (e.g. expired redirect key) */
  autoAuthError?: string | null;
}

export default function AuthScreen({ onAuth, autoAuthError }: AuthScreenProps) {
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(autoAuthError ?? null);
  const [step, setStep] = useState<string>('');
  const [showManualEntry, setShowManualEntry] = useState(false);

  const handleSignInWithPollinations = () => {
    const redirectUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({
      redirect_url: redirectUrl,
      permissions: 'profile,balance,usage',
    });
    window.location.href = `${AUTHORIZE_URL}?${params.toString()}`;
  };

  const handleValidate = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError('Please enter an API key');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Step 1: Validate key
      setStep('Validating API key...');
      const keyInfo = await validateApiKey(trimmed);

      if (!keyInfo.valid) {
        setError('API key is invalid or expired');
        setLoading(false);
        return;
      }

      // Step 2: Fetch profile to determine tier
      setStep('Checking account status...');
      let tier = 'anonymous';
      let nextResetAt: string | null = null;
      let isPro = false;

      try {
        const profile = await getProfile(trimmed);
        tier = profile.tier;
        nextResetAt = profile.nextResetAt ?? null;
        isPro = isPaidTier(tier); // only flower/nectar are paid
      } catch {
        // Profile unavailable — cannot confirm a paid tier, so default to free.
        isPro = false;
      }

      // Step 3: Save key and enter app
      await saveApiKey(trimmed);

      onAuth({
        apiKey: trimmed,
        valid: true,
        isPro,
        tier,
        nextResetAt,
      });
    } catch (err) {
      if (err instanceof PollinationsError) {
        if (err.code === 'network_error' || err.status === 0) {
          setError('Unable to connect. Please check your internet connection.');
        } else if (err.code === 'invalid_key' || err.status === 401) {
          setError('That API key is invalid or expired. Please check it and try again.');
        } else {
          setError(err.message || 'Unable to validate your API key. Please try again.');
        }
      } else {
        setError('Unable to validate your API key. Please try again.');
      }
    } finally {
      setLoading(false);
      setStep('');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md animate-slide-up">
        {/* Logo / title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-gradient mb-4 shadow-[0_8px_30px_hsl(var(--primary)/0.4)]">
            <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" strokeLinecap="round" />
              <path d="M8 10h.01M16 10h.01M9 16s1.5 2 3 2 3-2 3-2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-brand-gradient">Pollinations Chat</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Sign in to get started
          </p>
        </div>

        {/* Sign in card */}
        <div className="bg-card rounded-2xl border border-border p-6 shadow-xl">
          {/* Primary: Sign in with Pollinations (BYOP OAuth) */}
          <button
            onClick={handleSignInWithPollinations}
            disabled={loading}
            className="w-full py-3 px-4 bg-brand-gradient text-white font-medium rounded-lg hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity flex items-center justify-center gap-2 shadow-[0_4px_16px_hsl(var(--primary)/0.35)]"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" strokeLinecap="round" />
              <path d="M8 10h.01M16 10h.01M9 16s1.5 2 3 2 3-2 3-2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sign in with Pollinations
          </button>

          <p className="mt-3 text-xs text-muted-foreground text-center">
            You&apos;ll be redirected to enter.pollinations.ai to sign in with GitHub
          </p>

          {/* Divider */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-card text-muted-foreground">or enter key manually</span>
            </div>
          </div>

          {/* Collapsible manual key entry */}
          {!showManualEntry ? (
            <button
              onClick={() => setShowManualEntry(true)}
              className="w-full py-2 px-4 text-sm text-muted-foreground border border-border rounded-md hover:bg-secondary transition-colors"
            >
              I already have an API key
            </button>
          ) : (
            <>
          <label htmlFor="api-key" className="block text-sm font-medium text-foreground mb-2">
            API Key
          </label>
          <input
            id="api-key"
            type="password"
            placeholder="sk_... or pk_..."
            className="w-full px-4 py-2.5 bg-secondary border border-border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background transition"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !loading && handleValidate()}
            disabled={loading}
            autoFocus
          />

          {step && (
            <p className="mt-3 text-sm text-muted-foreground flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {step}
            </p>
          )}

          <button
            onClick={handleValidate}
            disabled={loading || !apiKey.trim()}
            className="mt-4 w-full py-2.5 px-4 bg-primary text-primary-foreground font-medium rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Validating...' : 'Validate & Enter'}
          </button>

          <p className="mt-4 text-xs text-muted-foreground text-center">
            Get your API key at{' '}
            <a
              href="https://enter.pollinations.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline hover:text-foreground/80"
            >
              enter.pollinations.ai
            </a>
          </p>
            </>
          )}

          {error && (
            <p className="mt-3 text-sm text-destructive flex items-center gap-1.5">
              <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              {error}
            </p>
          )}
        </div>

        {/* Privacy note */}
        <p className="mt-6 text-xs text-muted-foreground text-center">
          Your key is stored locally in your browser only. It is sent exclusively to
          gen.pollinations.ai.
        </p>
      </div>
    </div>
  );
}
