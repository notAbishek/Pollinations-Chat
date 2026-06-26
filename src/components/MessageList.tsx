/**
 * MessageList — chat messages with streaming, a hover/long-press action toolbar,
 * full Markdown (GFM + math) with theme-aware syntax highlighting, a collapsible
 * reasoning panel, and a click-to-zoom media lightbox.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ChatMessage } from '../types';
import { useTheme } from '../hooks/useTheme';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming?: boolean;
  onRegenerate?: (messageId: string) => void;
  onEditAndRegenerate?: (messageId: string, newContent: string) => void;
  onCopy?: (content: string) => void;
  onDelete?: (messageId: string) => void;
}

export default function MessageList({ messages, isStreaming, onRegenerate, onEditAndRegenerate, onCopy, onDelete }: MessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distanceFromBottom > 80;
  }, []);

  const lastMessageContent = messages[messages.length - 1]?.content;
  useEffect(() => {
    if (!userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, lastMessageContent]);

  const lastMsg = messages[messages.length - 1];
  const showTypingIndicator =
    isStreaming && lastMsg?.role === 'assistant' && !lastMsg.content && !lastMsg.reasoning;

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto px-3 sm:px-4 pt-6 pb-6 space-y-4"
    >
      {messages.map((msg) => {
        if (msg.isPartial && !msg.content && !msg.reasoning) return null;
        return (
          <MessageBubble
            key={msg.id}
            message={msg}
            onRegenerate={onRegenerate}
            onEditAndRegenerate={onEditAndRegenerate}
            onCopy={onCopy}
            onDelete={onDelete}
          />
        );
      })}

      {showTypingIndicator && <TypingIndicator />}

      <div ref={bottomRef} />
    </div>
  );
}

/* ── Typing / loading indicator ───────────────────────────────── */
function TypingIndicator() {
  return (
    <div className="flex justify-start animate-fade-in">
      <div className="bg-card border border-border rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm max-w-[92%] sm:max-w-[80%]">
        <div className="space-y-2.5 mb-2">
          <div className="h-3 rounded-full w-48 shimmer" />
          <div className="h-3 rounded-full w-36 shimmer" />
          <div className="h-3 rounded-full w-52 shimmer" />
        </div>
        <div className="flex items-center gap-1.5 pt-1 text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

/* ── Code block: theme-aware highlighting + copy ──────────────── */
function CodeBlock({ className, children, ...props }: HTMLAttributes<HTMLElement> & { children?: ReactNode }) {
  const { resolved } = useTheme();
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const code = String(children).replace(/\n$/, '');

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (match) {
    return (
      <div className="relative my-3 max-w-full overflow-hidden rounded-lg border border-border bg-muted">
        <div className="flex items-center justify-between px-3 sm:px-4 py-1.5 text-xs text-muted-foreground border-b border-border">
          <span className="font-mono">{match[1]}</span>
          <button onClick={handleCopy} className="flex items-center gap-1 hover:text-foreground transition-colors">
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                Copy
              </>
            )}
          </button>
        </div>
        <SyntaxHighlighter
          style={resolved === 'dark' ? oneDark : oneLight}
          language={match[1]}
          PreTag="div"
          customStyle={{ margin: 0, background: 'transparent', padding: '1rem', fontSize: '0.85rem' }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <code className="bg-muted text-foreground px-1.5 py-0.5 rounded text-[0.85em] font-mono" {...props}>
      {children}
    </code>
  );
}

/* Shared markdown component map */
const MARKDOWN_COMPONENTS: Components = {
  code: CodeBlock,
  pre: ({ children }) => <>{children}</>,
  table: ({ children }) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
};

/* ── Reasoning ("thinking") panel ─────────────────────────────── */
function ReasoningPanel({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const hasReasoning = !!message.reasoning;
  const prevPartial = useRef<boolean | undefined>(message.isPartial);

  // Depend on the boolean (not the growing reasoning string) so this only runs on
  // real transitions — a user collapse mid-stream is no longer fought back.
  useEffect(() => {
    if (message.isPartial && hasReasoning) setOpen(true);
    if (prevPartial.current && !message.isPartial) setOpen(false);
    prevPartial.current = message.isPartial;
  }, [message.isPartial, hasReasoning]);

  if (!message.reasoning) return null;
  const label = message.isPartial
    ? 'Thinking…'
    : message.reasoningMs
      ? `Thought for ${(message.reasoningMs / 1000).toFixed(1)}s`
      : 'Reasoning';

  return (
    <div className="mb-2 rounded-lg border border-accent3/40 bg-accent3/5 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-accent3"
      >
        <svg className={`w-3.5 h-3.5 ${message.isPartial ? 'animate-pulse-dot' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <span className="flex-1 text-left">{label}</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="px-3 pb-2.5 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
              {message.reasoning}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── MessageBubble ────────────────────────────────────────────── */
const MessageBubble = memo(function MessageBubble({
  message,
  onRegenerate,
  onEditAndRegenerate,
  onCopy,
  onDelete,
}: {
  message: ChatMessage;
  onRegenerate?: (messageId: string) => void;
  onEditAndRegenerate?: (messageId: string, newContent: string) => void;
  onCopy?: (content: string) => void;
  onDelete?: (messageId: string) => void;
}) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchMoved = useRef(false);

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.style.height = 'auto';
      editRef.current.style.height = editRef.current.scrollHeight + 'px';
    }
  }, [editing]);

  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const handleTouchStart = useCallback(() => {
    touchMoved.current = false;
    longPressTimer.current = setTimeout(() => {
      if (!touchMoved.current) {
        setMobileActionsOpen(true);
        if (navigator.vibrate) navigator.vibrate(30);
      }
    }, 500);
  }, []);
  const handleTouchMove = useCallback(() => {
    touchMoved.current = true;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);
  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
          System: {message.content.slice(0, 100)}
        </div>
      </div>
    );
  }

  const handleCopy = () => {
    if (onCopy) onCopy(message.content);
    else navigator.clipboard.writeText(message.content);
  };

  const handleEditSubmit = () => {
    const trimmed = editText.trim();
    if (trimmed && onEditAndRegenerate) onEditAndRegenerate(message.id, trimmed);
    setEditing(false);
  };

  return (
    <div className={`group flex animate-msg-in ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="relative max-w-[92%] sm:max-w-[80%] min-w-0"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onContextMenu={(e) => { if ('ontouchstart' in window) e.preventDefault(); }}
      >
        {/* Hover action toolbar — desktop only */}
        {!message.isPartial && (
          <div className={`absolute -top-8 ${isUser ? 'right-0' : 'left-0'} hidden sm:block opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10`}>
            <div className="flex items-center gap-0.5 bg-popover border border-border rounded-lg shadow-lg px-1 py-0.5">
              <ToolbarButton title="Copy message" onClick={handleCopy} path="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              {isUser && onEditAndRegenerate && (
                <ToolbarButton title="Edit & regenerate" onClick={() => { setEditText(message.content); setEditing(true); }} path="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              )}
              {!isUser && onRegenerate && (
                <ToolbarButton title="Regenerate response" onClick={() => onRegenerate(message.id)} path="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              )}
              {onDelete && (
                <ToolbarButton title="Delete message" danger onClick={() => onDelete(message.id)} path="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              )}
            </div>
          </div>
        )}

        {/* Message bubble */}
        <div
          className={`rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 shadow-sm overflow-hidden ${
            isUser
              ? 'bg-primary text-primary-foreground rounded-br-md'
              : 'bg-card border border-border text-card-foreground rounded-bl-md'
          } ${message.isError ? 'border-destructive bg-destructive/10' : ''}`}
        >
          {/* Reasoning panel (assistant) */}
          {!isUser && <ReasoningPanel message={message} />}

          {/* Attachments */}
          {message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.attachments.map((att) => (
                <div key={att.id} className="inline-block">
                  {att.type === 'image' ? (
                    <div className="relative group/img inline-block">
                      <img
                        src={att.dataUrl}
                        alt={att.name}
                        loading="lazy"
                        onClick={() => setLightbox(att.dataUrl)}
                        className={`rounded-lg object-contain cursor-zoom-in ${
                          isUser
                            ? 'max-w-[75vw] max-h-[300px] sm:max-w-[400px] sm:max-h-[350px]'
                            : 'max-w-full max-h-[60vh] sm:max-h-[500px] w-auto'
                        }`}
                      />
                      {!isUser && (
                        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity duration-150 z-10">
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const response = await fetch(att.dataUrl);
                                const blob = await response.blob();
                                const pngBlob = await createImageBitmap(blob).then((bmp) => {
                                  const canvas = document.createElement('canvas');
                                  canvas.width = bmp.width;
                                  canvas.height = bmp.height;
                                  canvas.getContext('2d')!.drawImage(bmp, 0, 0);
                                  return new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
                                });
                                await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
                              } catch {
                                await navigator.clipboard.writeText(att.dataUrl);
                              }
                            }}
                            className="p-1.5 bg-black/60 hover:bg-black/80 rounded-md text-white/90 hover:text-white transition-colors backdrop-blur-sm"
                            title="Copy image"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          </button>
                          <a
                            href={att.dataUrl}
                            download={att.name || 'image.png'}
                            onClick={(e) => e.stopPropagation()}
                            className="p-1.5 bg-black/60 hover:bg-black/80 rounded-md text-white/90 hover:text-white transition-colors backdrop-blur-sm"
                            title="Download image"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          </a>
                        </div>
                      )}
                    </div>
                  ) : att.type === 'audio' ? (
                    <div className="w-full min-w-[240px] max-w-full">
                      <audio controls preload="metadata" src={att.dataUrl} className="w-full rounded-lg" style={{ minHeight: '44px' }}>
                        Your browser does not support audio playback.
                      </audio>
                      <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" /></svg>
                        {att.name}
                      </p>
                    </div>
                  ) : att.type === 'video' ? (
                    <video controls src={att.dataUrl} className={`rounded-lg ${isUser ? 'max-w-[200px] sm:max-w-[250px]' : 'max-w-full max-h-[60vh] sm:max-h-[500px] w-auto'}`} />
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      {att.name}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Content */}
          {editing ? (
            <div className="space-y-2">
              <textarea
                ref={editRef}
                value={editText}
                onChange={(e) => {
                  setEditText(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSubmit(); }
                  if (e.key === 'Escape') setEditing(false);
                }}
                className="w-full bg-secondary text-foreground rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                rows={1}
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditing(false)} className="px-3 py-1 text-xs rounded-md hover:bg-accent text-muted-foreground">Cancel</button>
                <button onClick={handleEditSubmit} className="px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90">Save &amp; Submit</button>
              </div>
            </div>
          ) : (
            <div className={`${isUser ? 'text-sm whitespace-pre-wrap' : 'prose-chat'} ${message.isPartial && !isUser ? 'streaming-fade-in' : ''}`}>
              {isUser ? (
                message.content
              ) : (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={MARKDOWN_COMPONENTS}
                >
                  {message.content}
                </ReactMarkdown>
              )}
              {message.isPartial && <span className="streaming-caret" />}
            </div>
          )}

          {/* Metadata */}
          {!message.isPartial && (
            <div className={`flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-0.5 mt-1.5 sm:mt-2 text-[11px] sm:text-xs ${isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
              <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
              {message.model && <span>· {message.model}</span>}
              {message.tokensUsed !== undefined && <span>· {message.tokensUsed} tokens</span>}
              {message.pollenSpent !== undefined && message.pollenSpent > 0 && (
                <span>· {message.pollenSpent.toFixed(5)} pollen</span>
              )}
            </div>
          )}
        </div>

        {/* Mobile long-press overlay */}
        <AnimatePresence>
          {mobileActionsOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 sm:hidden"
              onClick={() => setMobileActionsOpen(false)}
              style={{ touchAction: 'none' }}
            >
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
              <div className="relative z-10 flex flex-col items-center justify-center h-full px-5" onClick={(e) => e.stopPropagation()}>
                <div className={`w-full max-w-sm rounded-xl px-4 py-3 shadow-2xl ring-1 ring-white/10 ${isUser ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-card-foreground'}`}>
                  <p className="text-sm whitespace-pre-wrap line-clamp-[8]">{message.content}</p>
                  {message.attachments.length > 0 && (
                    <p className="text-xs mt-1 opacity-60">{message.attachments.length} attachment(s)</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
                  <MobileAction label="Copy" onClick={() => { handleCopy(); setMobileActionsOpen(false); }} path="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  {isUser && onEditAndRegenerate && (
                    <MobileAction label="Edit" onClick={() => { setEditText(message.content); setEditing(true); setMobileActionsOpen(false); }} path="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  )}
                  {!isUser && onRegenerate && (
                    <MobileAction label="Retry" onClick={() => { onRegenerate(message.id); setMobileActionsOpen(false); }} path="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  )}
                  {onDelete && (
                    <MobileAction label="Delete" danger onClick={() => { onDelete(message.id); setMobileActionsOpen(false); }} path="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  )}
                </div>
                <p className="text-center text-xs text-white/50 mt-4">Tap anywhere to dismiss</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Lightbox */}
        <AnimatePresence>
          {lightbox && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
              onClick={() => setLightbox(null)}
            >
              <motion.img
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.9 }}
                src={lightbox}
                alt=""
                className="max-w-full max-h-full rounded-lg object-contain shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={() => setLightbox(null)}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});

/* ── Small helpers ────────────────────────────────────────────── */
function ToolbarButton({ title, onClick, path, danger }: { title: string; onClick: () => void; path: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-md transition-colors text-muted-foreground ${danger ? 'hover:bg-destructive/20 hover:text-destructive' : 'hover:bg-accent hover:text-foreground'}`}
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} /></svg>
    </button>
  );
}

function MobileAction({ label, onClick, path, danger }: { label: string; onClick: () => void; path: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm transition-colors ${danger ? 'bg-destructive/10 border border-destructive/30 text-destructive active:bg-destructive/20' : 'bg-card border border-border text-foreground active:bg-accent'}`}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} /></svg>
      {label}
    </button>
  );
}
