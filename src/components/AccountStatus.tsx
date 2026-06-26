/**
 * AccountStatus — header chip showing whether the user is on a PAID tier
 * (flower/nectar) vs free, plus pollen balance, per-key budget, and the
 * "free pollen refills in Xh" countdown.
 *
 * Paid/free is encoded in FORM + LABEL (crown icon + text), never colour alone,
 * so it survives colour-blindness. Balance alone can't prove paid standing
 * (it merges the free daily grant with purchased pollen) — so tier drives it.
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { AccountBalance } from '../types';
import { formatPollen } from '../lib/pollenMath';
import { tierMeta, formatRefill } from '../lib/tier';

interface AccountStatusProps {
  visible: boolean;
  balance: AccountBalance | null;
  tier: string;
  isPro: boolean;
  nextResetAt: string | null;
  pollenBudget?: number | null;
  lastUsage?: { tokensUsed: number; pollenSpent: number; model: string } | null;
  onRefresh: () => void;
}

function CrownIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 7l4 4 5-7 5 7 4-4-1.5 12h-15L3 7zm3.2 10h11.6l.4-3.2-2.7 2.1-3.5-4.9-3.5 4.9-2.7-2.1.4 3.2z" />
    </svg>
  );
}

export default function AccountStatus({
  visible,
  balance,
  tier,
  isPro,
  nextResetAt,
  pollenBudget,
  lastUsage,
  onRefresh,
}: AccountStatusProps) {
  const [open, setOpen] = useState(false);
  // Re-render every 60s so the refill countdown stays fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!nextResetAt) return;
    const iv = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(iv);
  }, [nextResetAt]);

  if (!visible) return null;

  const meta = tierMeta(tier);
  const paid = isPro || meta.paid;
  const refill = formatRefill(nextResetAt);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border text-sm transition-colors ${
          paid
            ? 'border-transparent bg-brand-gradient text-white shadow-[0_0_12px_hsl(var(--primary)/0.35)]'
            : 'border-border bg-secondary hover:bg-accent text-foreground'
        }`}
        title={paid ? `Paid tier — ${meta.label}` : `Free tier — ${meta.label}`}
        aria-label={`Account: ${paid ? 'paid' : 'free'} tier ${meta.label}`}
      >
        <span
          className={`flex items-center justify-center w-5 h-5 rounded-full ${
            paid ? 'bg-white/20' : 'bg-primary/15 text-primary'
          }`}
        >
          {paid ? (
            <CrownIcon className="w-3.5 h-3.5" />
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          )}
        </span>
        {balance && (
          <span className="font-mono text-xs tabular-nums">
            {formatPollen(balance.balance)}
          </span>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wide hidden sm:inline">
          {paid ? 'Paid' : 'Free'}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="absolute top-full right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] bg-popover border border-border rounded-xl shadow-xl p-4 z-50"
            >
              {/* Tier */}
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-muted-foreground">Account tier</span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    paid
                      ? 'bg-brand-gradient text-white'
                      : 'bg-secondary text-muted-foreground border border-border'
                  }`}
                >
                  {paid && <CrownIcon className="w-3 h-3" />}
                  {meta.label} · {paid ? 'Paid' : 'Free'}
                </span>
              </div>

              {/* Balance */}
              <div className="mb-3">
                <span className="text-xs text-muted-foreground">Pollen balance</span>
                <div className="text-lg font-mono tabular-nums text-popover-foreground">
                  {balance ? formatPollen(balance.balance) : '—'}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  One wallet for everything. Your daily grant is spent first and resets
                  each day; purchased pollen never expires.
                </p>
              </div>

              {/* Per-key budget */}
              {pollenBudget != null && (
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">This key's budget</span>
                  <span className="font-mono text-xs tabular-nums text-popover-foreground">
                    {formatPollen(pollenBudget)}
                  </span>
                </div>
              )}

              {/* Refill countdown */}
              {refill && (
                <div className="mb-3 flex items-center gap-1.5 text-xs text-warning">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Free pollen refills in {refill}
                </div>
              )}

              {/* Last generation */}
              {lastUsage && (
                <div className="border-t border-border pt-3 mb-3 space-y-1 text-xs text-muted-foreground">
                  <span className="text-muted-foreground">Last generation</span>
                  <div className="flex justify-between"><span>Model</span><span className="font-mono text-popover-foreground">{lastUsage.model}</span></div>
                  <div className="flex justify-between"><span>Tokens</span><span className="font-mono text-popover-foreground">{lastUsage.tokensUsed.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span>Pollen</span><span className="font-mono text-popover-foreground">{formatPollen(lastUsage.pollenSpent)}</span></div>
                </div>
              )}

              <button
                onClick={() => {
                  onRefresh();
                  setOpen(false);
                }}
                className="w-full text-center text-xs font-medium text-primary hover:underline"
              >
                Refresh balance
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
