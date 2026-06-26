/**
 * ModelInfoPanel — inline header components for model selection, capabilities, and detail popup.
 * Renders as a fragment to be placed inside the unified header bar.
 */

import { useState, useRef, useEffect, type ReactNode } from 'react';
import type { PollinationsModel } from '../types';
import { computePollenCost, formatPollen } from '../lib/pollenMath';

interface ModelInfoPanelProps {
  model: PollinationsModel;
  currentInputTokens: number;
}

export default function ModelInfoPanel({
  model,
  currentInputTokens,
}: ModelInfoPanelProps) {
  return (
    <>
      {/* Model detail popup — shows capabilities, In/Out/Pollen on click */}
      <ModelDetailPopup model={model} currentInputTokens={currentInputTokens} />

      {model.paidOnly && (
        <span className="text-[10px] bg-brand-gradient text-white px-1.5 py-0.5 rounded-full font-medium hidden sm:inline">
          PRO
        </span>
      )}
    </>
  );
}

/* ── Capability badge with SVG child ──────────────────── */

function CapBadge({
  label,
  active,
  children,
}: {
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors ${active
        ? 'bg-primary/15 text-primary'
        : 'bg-transparent text-muted-foreground/40'
        }`}
      title={label}
    >
      {children}
    </span>
  );
}

/* ── Detail popup for token limits & estimated cost ───── */

function ModelDetailPopup({
  model,
  currentInputTokens,
}: {
  model: PollinationsModel;
  currentInputTokens: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const estimatedCost = computePollenCost(model.pricing, currentInputTokens, 500);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        title="Model details"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-0 bg-popover border border-border rounded-lg shadow-xl p-3.5 z-50 min-w-[230px] max-w-[calc(100vw-2rem)] animate-fade-in">
          <p className="text-xs font-semibold text-popover-foreground mb-1 truncate">{model.name}</p>
          {model.description && (
            <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed line-clamp-2">{model.description}</p>
          )}

          {/* Capability badges */}
          <div className="flex flex-wrap items-center gap-1 mb-3">
            <CapBadge label="Text" active={model.outputModalities.includes('text')}>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h12" />
              </svg>
            </CapBadge>
            <CapBadge label="Image" active={model.outputModalities.includes('image')}>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </CapBadge>
            <CapBadge label="Video" active={model.outputModalities.includes('video')}>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </CapBadge>
            <CapBadge label="Vision" active={model.capabilities.vision}>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </CapBadge>
            <CapBadge label="Search" active={model.capabilities.webSearch}>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </CapBadge>
            <CapBadge label="Think" active={model.capabilities.deepThink}>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </CapBadge>
          </div>

          <div className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
                Max Input
              </span>
              <span className="font-mono text-popover-foreground">{model.maxInputTokens.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                Max Output
              </span>
              <span className="font-mono text-popover-foreground">{model.maxOutputTokens.toLocaleString()}</span>
            </div>
            <div className="border-t border-border pt-2.5 flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Est. Cost
              </span>
              <span className="font-mono text-popover-foreground">{formatPollen(estimatedCost)} pollen</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
