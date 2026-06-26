/**
 * Export / Import chat sessions as JSON or Markdown.
 */

import type { ChatSession, ChatExport, ChatMessage, MessageAttachment } from '../types';

// ─── Export ──────────────────────────────────────────────────────

export function exportJSON(sessions: ChatSession[]): string {
  const data: ChatExport = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    sessions,
  };
  return JSON.stringify(data, null, 2);
}

export function exportMarkdown(sessions: ChatSession[]): string {
  const lines: string[] = [];
  lines.push('# Pollinations Chat Export');
  lines.push(`_Exported at ${new Date().toISOString()}_\n`);

  for (const session of sessions) {
    lines.push(`## ${session.title}`);
    lines.push(`**Model:** ${session.model} | **Created:** ${new Date(session.createdAt).toLocaleString()}`);
    // Defensive: sessions read straight from IndexedDB may predate these fields.
    lines.push(`**Pollen spent:** ${(session.totalPollenSpent ?? 0).toFixed(5)}\n`);
    lines.push('---\n');

    for (const msg of session.messages ?? []) {
      const roleLabel =
        msg.role === 'user' ? '**You**' :
        msg.role === 'assistant' ? '**Assistant**' :
        '**System**';
      const timestamp = new Date(msg.timestamp).toLocaleTimeString();
      lines.push(`### ${roleLabel} _(${timestamp})_\n`);
      lines.push(msg.content);
      lines.push('');

      if ((msg.attachments ?? []).length > 0) {
        lines.push('**Attachments:**');
        for (const att of msg.attachments ?? []) {
          if (att.type === 'image') {
            lines.push(`![${att.name}](${att.dataUrl})`);
          } else {
            lines.push(`- ${att.name} (${att.type}, ${(att.sizeBytes / 1024).toFixed(1)}KB)`);
          }
        }
        lines.push('');
      }
    }
    lines.push('\n---\n');
  }

  return lines.join('\n');
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Append to DOM (required by Firefox) and defer revoke past the click tick.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ─── Import ──────────────────────────────────────────────────────

export function importJSON(raw: string): ChatSession[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON format');
  }

  // ChatExport envelope
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    'sessions' in parsed
  ) {
    return normalizeSessions((parsed as ChatExport).sessions);
  }

  // Or a raw array of sessions
  if (Array.isArray(parsed)) {
    return normalizeSessions(parsed);
  }

  throw new Error('Unrecognized import format: expected { version, sessions } or array of sessions');
}

export function importMarkdown(md: string): ChatSession[] {
  // Parse the markdown back into a session structure
  const sessions: ChatSession[] = [];
  const sessionBlocks = md.split(/^## /m).filter(Boolean);

  // Skip the header block
  const startIdx = sessionBlocks[0]?.startsWith('# Pollinations') ? 1 : 0;

  for (let i = startIdx; i < sessionBlocks.length; i++) {
    const block = sessionBlocks[i];
    const titleMatch = block.match(/^(.+)\n/);
    const title = titleMatch?.[1]?.trim() ?? `Imported Chat ${i}`;

    const messages: ChatMessage[] = [];
    const msgBlocks = block.split(/^### /m).filter(Boolean);

    for (const msgBlock of msgBlocks.slice(1)) {
      // Parse role
      let role: 'user' | 'assistant' | 'system' = 'user';
      if (msgBlock.startsWith('**Assistant**')) role = 'assistant';
      else if (msgBlock.startsWith('**System**')) role = 'system';

      // Extract content (skip the first line which is the header)
      const contentLines = msgBlock.split('\n').slice(1);
      const content = contentLines
        .filter((l) => !l.startsWith('**Attachments:**') && !l.startsWith('!['))
        .join('\n')
        .trim();

      if (content) {
        messages.push({
          id: crypto.randomUUID(),
          role,
          content,
          mode: 'text',
          attachments: [],
          timestamp: Date.now(),
        });
      }
    }

    if (messages.length > 0) {
      sessions.push({
        id: crypto.randomUUID(),
        title,
        messages,
        model: 'openai',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        totalPollenSpent: 0,
      });
    }
  }

  if (sessions.length === 0) {
    throw new Error('No valid chat sessions found in Markdown');
  }

  return sessions;
}

/* ── Normalization / validation ──────────────────────────────────
 * Untrusted import data is coerced into well-formed sessions/messages with
 * safe defaults so it can never poison IndexedDB or crash render paths that
 * assume `attachments` is an array or `totalPollenSpent` is numeric.
 */

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

const asNumber = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const ATTACH_TYPES = ['image', 'video', 'audio', 'file'];
const MODES = ['text', 'image', 'video', 'audio'];

function normalizeAttachment(raw: unknown): MessageAttachment | null {
  const a = rec(raw);
  if (typeof a.dataUrl !== 'string') return null;
  return {
    id: typeof a.id === 'string' ? a.id : crypto.randomUUID(),
    type: (ATTACH_TYPES.includes(a.type as string) ? a.type : 'file') as MessageAttachment['type'],
    name: typeof a.name === 'string' ? a.name : 'attachment',
    mimeType: typeof a.mimeType === 'string' ? a.mimeType : '',
    dataUrl: a.dataUrl,
    sizeBytes: asNumber(a.sizeBytes, 0),
  };
}

function normalizeMessage(raw: unknown, now: number): ChatMessage | null {
  const m = rec(raw);
  const role = m.role === 'assistant' || m.role === 'system' ? m.role : 'user';
  const content = typeof m.content === 'string' ? m.content : '';
  const attachments = Array.isArray(m.attachments)
    ? (m.attachments.map(normalizeAttachment).filter(Boolean) as MessageAttachment[])
    : [];
  if (!content && attachments.length === 0) return null;
  return {
    id: typeof m.id === 'string' ? m.id : crypto.randomUUID(),
    role,
    content,
    mode: (MODES.includes(m.mode as string) ? m.mode : 'text') as ChatMessage['mode'],
    attachments,
    timestamp: asNumber(m.timestamp, now),
    model: typeof m.model === 'string' ? m.model : undefined,
    tokensUsed: m.tokensUsed != null ? asNumber(m.tokensUsed, 0) : undefined,
    pollenSpent: m.pollenSpent != null ? asNumber(m.pollenSpent, 0) : undefined,
    isError: !!m.isError,
  };
}

function normalizeSession(raw: unknown, now: number): ChatSession | null {
  const s = rec(raw);
  if (!Array.isArray(s.messages)) return null;
  const messages = s.messages.map((m) => normalizeMessage(m, now)).filter(Boolean) as ChatMessage[];
  return {
    id: typeof s.id === 'string' ? s.id : crypto.randomUUID(),
    title: typeof s.title === 'string' && s.title.trim() ? s.title : 'Imported Chat',
    messages,
    model: typeof s.model === 'string' ? s.model : 'openai',
    createdAt: asNumber(s.createdAt, now),
    updatedAt: asNumber(s.updatedAt, now),
    totalPollenSpent: asNumber(s.totalPollenSpent, 0),
  };
}

export function normalizeSessions(raw: unknown): ChatSession[] {
  if (!Array.isArray(raw)) throw new Error('Invalid export: expected an array of sessions');
  const now = Date.now();
  const out = raw.map((s) => normalizeSession(s, now)).filter(Boolean) as ChatSession[];
  // An empty export is valid (returns []); a non-empty file with no salvageable
  // session is treated as a bad import.
  if (raw.length > 0 && out.length === 0) {
    throw new Error('No valid chat sessions found');
  }
  return out;
}
