/**
 * ThemeToggle — two flavours:
 *  • variant="icon"      compact cycling button (header)
 *  • variant="segmented" System / Light / Dark control (settings)
 */

import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '../hooks/useTheme';
import type { ThemePreference } from '../types';

function SunIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
    </svg>
  );
}
function MoonIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}
function SystemIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path strokeLinecap="round" d="M8 20h8m-4-4v4" />
    </svg>
  );
}

const ICONS: Record<ThemePreference, (p: { className?: string }) => JSX.Element> = {
  light: SunIcon,
  dark: MoonIcon,
  system: SystemIcon,
};

export default function ThemeToggle({ variant = 'icon' }: { variant?: 'icon' | 'segmented' }) {
  const { preference, setPreference, cycle } = useTheme();

  if (variant === 'segmented') {
    const opts: { value: ThemePreference; label: string }[] = [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ];
    return (
      <div className="inline-flex items-center gap-1 rounded-full bg-secondary p-1 border border-border">
        {opts.map((o) => {
          const Icon = ICONS[o.value];
          const active = preference === o.value;
          return (
            <button
              key={o.value}
              onClick={() => setPreference(o.value)}
              className={`relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active ? 'text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={active}
            >
              {active && (
                <motion.span
                  layoutId="theme-seg-active"
                  className="absolute inset-0 rounded-full bg-primary"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" />
                {o.label}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  const Icon = ICONS[preference];
  const nextLabel =
    preference === 'light' ? 'dark' : preference === 'dark' ? 'system' : 'light';
  return (
    <button
      onClick={cycle}
      className="relative p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
      title={`Theme: ${preference} (click for ${nextLabel})`}
      aria-label={`Switch theme, currently ${preference}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={preference}
          initial={{ opacity: 0, rotate: -45, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 45, scale: 0.6 }}
          transition={{ duration: 0.18 }}
          className="block"
        >
          <Icon className="w-5 h-5" />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
