/**
 * Composer — text input + mode dropdown + attachments + token meter + send.
 */

import { useState, useEffect, useRef, useCallback, useMemo, type ChangeEvent, type KeyboardEvent } from 'react';
import { motion } from 'motion/react';
import { v4 as uuid } from 'uuid';
import type { GenerationMode, MessageAttachment, PollinationsModel } from '../types';
import { getTokenMeterColor } from '../lib/tokenizer';

interface ComposerProps {
  onSend: (text: string, mode: GenerationMode, attachments: MessageAttachment[]) => void;
  onCancel?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  /** Current model for capability checks */
  model: PollinationsModel | null;
  /** All available models for the picker */
  models: PollinationsModel[];
  /** Called when user picks a model */
  onSelectModel: (id: string) => void;
  /** Token meter data */
  tokenInfo: {
    totalInputTokens: number;
    maxInputTokens: number;
    isOverLimit: boolean;
    usageRatio: number;
  };
  /** Called when composer text changes (for live token counting) */
  onTextChange?: (text: string) => void;
}

const MODE_OPTIONS: { value: GenerationMode; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
];

export default function Composer({
  onSend,
  onCancel,
  disabled,
  isStreaming,
  model,
  models,
  onSelectModel,
  tokenInfo,
  onTextChange,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<GenerationMode>('text');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    onTextChange?.(e.target.value);

    // Auto-resize textarea
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if (tokenInfo.isOverLimit) return;

    onSend(trimmed, effectiveMode, attachments);
    setText('');
    setAttachments([]);
    onTextChange?.('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && !isStreaming) handleSend();
    }
  };

  const handleFileUpload = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      for (const file of Array.from(files)) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const type = file.type.startsWith('image/')
            ? 'image'
            : file.type.startsWith('video/')
              ? 'video'
              : file.type.startsWith('audio/')
                ? 'audio'
                : 'file';

          const att: MessageAttachment = {
            id: uuid(),
            type: type as MessageAttachment['type'],
            name: file.name,
            mimeType: file.type,
            dataUrl,
            sizeBytes: file.size,
          };
          setAttachments((prev) => [...prev, att]);
        };
        reader.onerror = () => {
          // Silently skip files that fail to read
        };
        reader.readAsDataURL(file);
      }
      // Reset file input
      e.target.value = '';
    },
    [],
  );

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  // Get supported modes for current model
  const supportedModes = getSupportedModes(model);

  // Filter mode if current mode not supported
  const effectiveMode = supportedModes.includes(mode) ? mode : supportedModes[0] ?? 'text';

  // Close mode menu on outside click
  useEffect(() => {
    if (!showModeMenu) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setShowModeMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [showModeMenu]);

  // Reset mode when model changes to the model's primary type
  useEffect(() => {
    if (!model) return;
    // For image/video/audio models, force the mode to the model's native type
    if (model.type === 'image' || model.type === 'video' || model.type === 'audio') {
      setMode(model.type as GenerationMode);
    } else {
      // For text models, reset to text
      setMode('text');
    }
  }, [model]);

  // Speech-to-text models take an audio file as input.
  const isTranscription = !!model?.capabilities.transcription;

  const acceptTypes = isTranscription
    ? 'audio/*'
    : effectiveMode === 'image'
      ? 'image/*'
      : effectiveMode === 'video'
        ? 'video/*'
        : effectiveMode === 'audio'
          ? 'audio/*'
          : 'image/*,video/*,*/*';

  // Determine if attachment button should be enabled
  // Enable for vision (image input) and speech-to-text (audio input) models.
  const attachmentEnabled = model ? (
    model.capabilities.vision ||
    model.inputModalities.includes('image') ||
    model.type === 'image' ||
    isTranscription ||
    model.inputModalities.includes('audio')
  ) : false;

  const meterColor = getTokenMeterColor(
    tokenInfo.totalInputTokens,
    tokenInfo.maxInputTokens,
  );

  return (
    <div className="px-2 sm:px-6 pb-3 pt-1 sm:pb-4 sm:pt-2 bg-background pb-safe">
      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-1 bg-muted border border-border rounded-md px-2 py-1 text-xs text-muted-foreground"
            >
              {att.type === 'image' && (
                <img src={att.dataUrl} alt="" className="w-8 h-8 rounded object-cover" />
              )}
              <span className="max-w-[100px] truncate">{att.name}</span>
              <button
                onClick={() => removeAttachment(att.id)}
                className="text-muted-foreground hover:text-destructive ml-1"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Token meter */}
      {tokenInfo.isOverLimit && (
        <p className="text-xs text-destructive mb-2">
          Over token limit — oldest messages will be truncated when you send.
        </p>
      )}

      {/* Floating input pill */}
      <div className="flex items-center gap-1.5 sm:gap-2 ">
        <div className="flex-1 min-w-0 flex items-end gap-0 bg-secondary border border-border rounded-full px-1 sm:px-1.5 py-1 transition-all focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30">
          {/* Attachment (+) button — inside left, disabled for non-vision models */}
          <button
            onClick={() => attachmentEnabled && fileInputRef.current?.click()}
            disabled={!attachmentEnabled}
            className={`flex-shrink-0 w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full transition-colors ${attachmentEnabled
              ? 'hover:bg-accent text-muted-foreground hover:text-foreground'
              : 'text-muted-foreground/30 cursor-not-allowed'
              }`}
            title={attachmentEnabled ? 'Attach file' : 'This model does not support file input'}
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptTypes}
            multiple
            onChange={handleFileUpload}
            className="hidden"
          />

          {/* Text input */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={isTranscription ? 'Attach an audio file to transcribe…' : 'Ask anything'}
            disabled={disabled}
            rows={1}
            className="flex-1 min-w-0 resize-none bg-transparent px-1.5 sm:px-2 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none max-h-[120px]"
          />

          {/* Inline model picker — floating right */}
          <InlineModelPicker
            models={models}
            selected={model}
            onSelect={onSelectModel}
          />

          {/* Mode selector */}
          <div className="relative flex-shrink-0" ref={modeMenuRef}>
            <button
              onClick={() => setShowModeMenu(!showModeMenu)}
              className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
              title={`Mode: ${effectiveMode}`}
            >
              <ModeIcon mode={effectiveMode} />
            </button>
            {showModeMenu && (
              <div className="absolute bottom-full mb-2 right-0 bg-popover border border-border rounded-lg shadow-lg py-1 z-10 min-w-[130px]">
                {MODE_OPTIONS.filter((m) => supportedModes.includes(m.value)).map((m) => (
                  <button
                    key={m.value}
                    onClick={() => {
                      setMode(m.value);
                      setShowModeMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center gap-2 ${effectiveMode === m.value ? 'text-foreground' : 'text-muted-foreground'
                      }`}
                  >
                    <ModeIcon mode={m.value} /> {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Send / Cancel button — inside right */}
          {isStreaming ? (
            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={onCancel}
              className="flex-shrink-0 w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors"
              title="Stop generation"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </motion.button>
          ) : (
            <motion.button
              whileTap={{ scale: 0.88 }}
              onClick={handleSend}
              disabled={disabled || (!text.trim() && attachments.length === 0)}
              className="flex-shrink-0 w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center rounded-full bg-brand-gradient text-white shadow-[0_2px_10px_hsl(var(--primary)/0.4)] disabled:shadow-none disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              title="Send message"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                <path d="M7 11L12 6L17 11M12 6V18" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.button>
          )}
        </div>

        {/* Token meter circle — right side (desktop only, shown in header on mobile) */}
        {tokenInfo.usageRatio > 0 && (
          <div className="group relative flex-shrink-0 self-center hidden sm:block">
            <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
              <circle
                cx="18" cy="18" r="15"
                fill="none"
                stroke="hsl(var(--secondary))"
                strokeWidth="3"
              />
              <circle
                cx="18" cy="18" r="15"
                fill="none"
                stroke="currentColor"
                className={meterColor}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${Math.min(tokenInfo.usageRatio, 1) * 94.25} 94.25`}
                style={{ transition: 'stroke-dasharray 0.3s ease' }}
              />
            </svg>
            <span className={`absolute inset-0 flex items-center justify-center text-[8px] font-mono ${tokenInfo.isOverLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
              {Math.min(Math.round(tokenInfo.usageRatio * 100), 100)}%
            </span>
            <div className="absolute bottom-full mb-2 right-0 hidden group-hover:block bg-popover border border-border rounded-lg shadow-lg px-3 py-2 z-20 whitespace-nowrap">
              <p className={`text-xs font-mono ${tokenInfo.isOverLimit ? 'text-destructive' : 'text-foreground'}`}>
                {tokenInfo.totalInputTokens.toLocaleString()} / {tokenInfo.maxInputTokens.toLocaleString()} tokens
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Inline model picker (inside pill) ────────────────── */

const TYPE_ORDER: string[] = ['text', 'image', 'video', 'audio'];
const TYPE_LABELS: Record<string, string> = { text: 'Text', image: 'Image', video: 'Video', audio: 'Audio' };

function InlineModelPicker({
  models,
  selected,
  onSelect,
}: {
  models: PollinationsModel[];
  selected: PollinationsModel | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.aliases.some((a: string) => a.toLowerCase().includes(q)) ||
        m.type.toLowerCase().includes(q),
    );
  }, [models, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, PollinationsModel[]>();
    for (const t of TYPE_ORDER) {
      const items = filtered.filter((m) => m.type === t);
      if (items.length > 0) map.set(t, items);
    }
    return map;
  }, [filtered]);

  if (!selected) return null;

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 sm:px-2.5 h-8 sm:h-9 rounded-full hover:bg-accent transition-colors text-xs text-muted-foreground hover:text-foreground whitespace-nowrap max-w-[100px] sm:max-w-[140px]"
        title={selected.name}
      >
        <ModelTypeIcon type={selected.type} />
        <span className="truncate">{selected.name}</span>
        <svg className="w-2.5 h-2.5 flex-shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full mb-2 right-0 bg-popover border border-border rounded-lg shadow-xl z-50 w-72 max-w-[calc(100vw-2rem)] animate-fade-in overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 bg-secondary rounded-md px-2.5 py-1.5">
              <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                className="flex-1 bg-transparent text-xs text-foreground placeholder-muted-foreground outline-none"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="max-h-72 overflow-y-auto py-1">
            {grouped.size === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No models found</p>
            )}
            {[...grouped.entries()].map(([type, items]) => (
              <div key={type}>
                <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {TYPE_LABELS[type] ?? type} Models
                </div>
                {items.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      onSelect(m.id);
                      setOpen(false);
                      setSearch('');
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent transition-colors ${selected && m.id === selected.id ? 'bg-accent/60 text-accent-foreground' : 'text-popover-foreground'
                      }`}
                  >
                    <ModelTypeIcon type={m.type} />
                    <span className="flex-1 truncate">{m.name}</span>
                    {m.paidOnly && (
                      <span className="text-[9px] bg-brand-gradient text-white px-1 py-0.5 rounded font-medium flex-shrink-0">PRO</span>
                    )}
                    {selected && m.id === selected.id && (
                      <svg className="w-3.5 h-3.5 text-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelTypeIcon({ type }: { type: string }) {
  const cls = 'w-3.5 h-3.5 flex-shrink-0';
  switch (type) {
    case 'text':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h12" /></svg>;
    case 'image':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
    case 'video':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>;
    case 'audio':
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>;
    default:
      return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h12" /></svg>;
  }
}

function getSupportedModes(model: PollinationsModel | null): GenerationMode[] {
  if (!model) return ['text'];

  // Image-only, video-only, and audio-only models: only offer their native mode
  if (model.type === 'image') return ['image'];
  if (model.type === 'video') return ['video'];
  if (model.type === 'audio') return ['audio'];

  // Text models: offer text + any additional output modalities
  const modes: GenerationMode[] = ['text'];
  const outputs = model.outputModalities.map((m) => m.toLowerCase());
  if (outputs.includes('image')) modes.push('image');
  if (outputs.includes('video')) modes.push('video');
  if (outputs.includes('audio')) modes.push('audio');

  return [...new Set(modes)];
}

function ModeIcon({ mode }: { mode: GenerationMode }) {
  const cls = 'w-4 h-4';
  switch (mode) {
    case 'text':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      );
    case 'image':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case 'video':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      );
    case 'audio':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
        </svg>
      );
  }
}
