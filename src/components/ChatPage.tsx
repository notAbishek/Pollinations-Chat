/**
 * ChatPage — main orchestrator.
 *
 * Responsibilities
 * ────────────────
 * • Session sidebar (new / switch / delete)
 * • Model selection
 * • Streaming generation pipeline (AbortController)
 * • Pollen-balance gating
 * • Post-generation usage fetch
 * • Wires all sub-components together
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { v4 as uuid } from 'uuid';
import type {
  PollinationsModel,
  ChatMessage,
  AppSettings,
  AccountBalance,
  GenerationMode,
  MessageAttachment,
  AuthState,
} from '../types';
import {
  streamGeneration,
  getBalance,
  getUsage,
  generateImage,
  generateVideo,
  generateAudioDirect,
  transcribeAudio,
  validateApiKey,
  PollinationsError,
} from '../lib/pollinations';
import { estimateTokens, getTokenMeterColor } from '../lib/tokenizer';
import { computePollenCost, hasSufficientPollen, formatPollen } from '../lib/pollenMath';
import {
  buildEnhancedPrompt,
  computeEffectiveTemperature,
  shouldEnhancePrompt,
} from '../lib/promptEnhancement';
import { getSettings, saveSettings as persistSettings } from '../lib/storage';
import { useLocalSession } from '../hooks/useLocalSession';
import { useTokenMeter } from '../hooks/useTokenMeter';
import MessageList from './MessageList';
import Composer from './Composer';
import ModelInfoPanel from './ModelInfoPanel';
import AccountStatus from './AccountStatus';
import ThemeToggle from './ThemeToggle';
import Settings from './Settings';

interface ChatPageProps {
  auth: AuthState;
  models: PollinationsModel[];
  notifySuccess: (msg: string) => string;
  notifyError: (msg: string) => string;
  onLogout: () => void;
}

export default function ChatPage({
  auth,
  models,
  notifySuccess,
  notifyError,
  onLogout,
}: ChatPageProps) {
  const apiKey = auth.apiKey;
  /* ── session management ─────────────────────────────── */
  const {
    sessions,
    activeSession,
    activeSessionId,
    getSessionById,
    createSession,
    switchSession,
    addMessage,
    updateMessage,
    renameSession,
    deleteSession,
    deleteMessage,
    deleteMessagesFrom,
    importSessions,
    clearAll,
    flushPersist,
    setOnPersistError,
  } = useLocalSession();

  /* ── state ──────────────────────────────────────────── */
  const [selectedModel, setSelectedModel] = useState<PollinationsModel | null>(
    models.find((m) => m.name === 'openai') ?? models[0] ?? null,
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [balance, setBalance] = useState<AccountBalance | null>(null);
  const [pollenBudget, setPollenBudget] = useState<number | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    showUsageIcon: true,
    autoFetchUsage: true,
    autoReadBalance: true,
    selectedModel: 'openai',
    systemPrompt: '',
    temperature: 0.7,
    creativity: 0.5,
    enablePromptEnhancement: false,
    theme: 'dark',
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const abortRef = useRef<AbortController | null>(null);

  /* ── token meter ────────────────────────────────────── */
  const messages = activeSession?.messages ?? [];
  const maxInput = selectedModel?.maxInputTokens ?? 128_000;
  const tokenMeter = useTokenMeter(messages, maxInput, settings.systemPrompt);

  /* ── load settings from storage ─────────────────────── */
  useEffect(() => {
    getSettings().then((s) => setSettings(s));
  }, []);

  /* ── surface local-save failures as toasts ──────────── */
  useEffect(() => {
    setOnPersistError(notifyError);
  }, [setOnPersistError, notifyError]);

  /* ── fetch balance on mount & periodically ──────────── */
  const refreshBalance = useCallback(async () => {
    try {
      const b = await getBalance(apiKey);
      setBalance(b);
    } catch {
      /* silent */
    }
  }, [apiKey]);

  useEffect(() => {
    refreshBalance();
    const iv = setInterval(refreshBalance, 120_000);
    return () => clearInterval(iv);
  }, [refreshBalance]);

  /* ── fetch per-key pollen budget (distinct from wallet balance) ── */
  useEffect(() => {
    let cancelled = false;
    validateApiKey(apiKey)
      .then((info) => {
        if (!cancelled) setPollenBudget(info.pollenBudget ?? null);
      })
      .catch(() => {
        /* non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  /* ── model change ───────────────────────────────────── */
  const handleModelChange = (modelId: string) => {
    const model = models.find((m) => m.id === modelId || m.name === modelId);
    if (model) setSelectedModel(model);
  };

  /* ── settings persistence ───────────────────────────── */
  const handleUpdateSettings = async (patch: Partial<AppSettings>) => {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    await persistSettings(updated);
  };

  /* ── error handling ─────────────────────────────────── */
  const handleError = useCallback((err: unknown) => {
    if (err instanceof PollinationsError) {
      switch (err.status) {
        case 401:
          notifyError('Your session has expired. Please sign in again.');
          break;
        case 402:
          notifyError('Insufficient pollen balance. Please top up your account.');
          break;
        case 403:
          notifyError('This model requires a higher tier. Try a different model.');
          break;
        case 429:
          notifyError('Too many requests. Please wait a moment and try again.');
          break;
        case 0:
          notifyError('Unable to connect. Please check your internet connection.');
          break;
        default:
          notifyError('Something went wrong. Please try again.');
      }
    } else {
      notifyError('An unexpected error occurred. Please try again.');
    }
  }, [notifyError]);

  /* ── post-generation tasks ──────────────────────────── */
  const postGenerationTasks = useCallback(async () => {
    if (settings.autoReadBalance) refreshBalance();
    if (settings.autoFetchUsage) {
      try {
        await getUsage(apiKey);
      } catch {
        /* silent */
      }
    }
  }, [settings.autoReadBalance, settings.autoFetchUsage, refreshBalance, apiKey]);

  /* ── send / stream ──────────────────────────────────── */
  const handleSend = useCallback(async (text: string, mode: GenerationMode, attachments: MessageAttachment[]) => {
    if (!selectedModel || (!text.trim() && attachments.length === 0)) return;

    // Pollen gate
    if (settings.autoReadBalance && balance) {
      const cost = computePollenCost(selectedModel.pricing, estimateTokens(text), 0);
      if (!hasSufficientPollen(balance.balance, cost)) {
        notifyError(
          `Insufficient pollen. Need ${formatPollen(cost)}, have ${formatPollen(balance.balance)}.`,
        );
        return;
      }
    }

    // Ensure an active session
    const sessionId = activeSessionId ?? (await createSession(selectedModel.name)).id;

    // User message
    const userMsg: ChatMessage = {
      id: uuid(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      mode,
      model: selectedModel.name,
      attachments,
    };
    addMessage(sessionId, userMsg);

    // Determine effective mode based on model type
    // If the model only supports certain output, ensure mode matches
    const modelType = selectedModel.type;
    let effectiveMode = mode;
    if (modelType === 'image') effectiveMode = 'image';
    else if (modelType === 'video') effectiveMode = 'video';
    else if (modelType === 'audio') effectiveMode = 'audio';
    else if (modelType === 'text' && mode !== 'text') {
      // Text-only model can't generate images/video/audio — fall back to text
      effectiveMode = 'text';
    }

    // ─── image mode ────────────────────────────────────
    if (effectiveMode === 'image') {
      setIsStreaming(true);

      // Placeholder loading message
      const imgMsgId = uuid();
      addMessage(sessionId, {
        id: imgMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        mode: 'image',
        model: selectedModel.name,
        attachments: [],
        isPartial: true,
      });

      try {
        const imgBlob = await generateImage(apiKey, text, selectedModel.name, {
          seed: Math.floor(Math.random() * 2147483647),
        });
        const imgUrl = URL.createObjectURL(imgBlob);
        updateMessage(sessionId, imgMsgId, {
          content: 'Image generated successfully.',
          isPartial: false,
          attachments: [{
            id: uuid(),
            type: 'image',
            name: 'generated.png',
            mimeType: 'image/png',
            dataUrl: imgUrl,
            sizeBytes: imgBlob.size,
          }],
        });
      } catch (err) {
        const friendlyMsg = extractFriendlyError(err, selectedModel.name, 'image');
        handleError(err);
        updateMessage(sessionId, imgMsgId, {
          content: friendlyMsg,
          isPartial: false,
          isError: true,
        });
      } finally {
        setIsStreaming(false);
        postGenerationTasks();
      }
      return;
    }

    // ─── video mode ────────────────────────────────────
    if (effectiveMode === 'video') {
      setIsStreaming(true);

      // Placeholder loading message
      const vidMsgId = uuid();
      addMessage(sessionId, {
        id: vidMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        mode: 'video',
        model: selectedModel.name,
        attachments: [],
        isPartial: true,
      });

      try {
        const videoBlob = await generateVideo(apiKey, text, selectedModel.name, {
          seed: Math.floor(Math.random() * 2147483647),
        });
        const videoUrl = URL.createObjectURL(videoBlob);
        updateMessage(sessionId, vidMsgId, {
          content: 'Video generated successfully.',
          isPartial: false,
          attachments: [{
            id: uuid(),
            type: 'video',
            name: 'generated.mp4',
            mimeType: 'video/mp4',
            dataUrl: videoUrl,
            sizeBytes: videoBlob.size,
          }],
        });
      } catch (err) {
        const friendlyMsg = extractFriendlyError(err, selectedModel.name, 'video');
        handleError(err);
        updateMessage(sessionId, vidMsgId, {
          content: friendlyMsg,
          isPartial: false,
          isError: true,
        });
      } finally {
        setIsStreaming(false);
        postGenerationTasks();
      }
      return;
    }

    // ─── audio mode ────────────────────────────────────
    if (effectiveMode === 'audio') {
      setIsStreaming(true);

      const audioMsgId = uuid();
      addMessage(sessionId, {
        id: audioMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        mode: 'audio',
        model: selectedModel.name,
        attachments: [],
        isPartial: true,
      });

      try {
        const audioBlob = await generateAudioDirect(apiKey, text, selectedModel.name, {
          voice: 'alloy',
        });
        const audioUrl = URL.createObjectURL(audioBlob);
        updateMessage(sessionId, audioMsgId, {
          content: 'Audio generated successfully.',
          isPartial: false,
          attachments: [{
            id: uuid(),
            type: 'audio',
            name: 'generated.mp3',
            mimeType: 'audio/mpeg',
            dataUrl: audioUrl,
            sizeBytes: audioBlob.size,
          }],
        });
      } catch (err) {
        const friendlyMsg = extractFriendlyError(err, selectedModel.name, 'audio');
        handleError(err);
        updateMessage(sessionId, audioMsgId, {
          content: friendlyMsg,
          isPartial: false,
          isError: true,
        });
      } finally {
        setIsStreaming(false);
        postGenerationTasks();
      }
      return;
    }

    // ─── transcription (speech-to-text) ────────────────
    // STT models (whisper, scribe, universal-2/-3-pro) take audio in and return
    // text — route them to /v1/audio/transcriptions, never the TTS endpoint.
    if (selectedModel.capabilities.transcription) {
      setIsStreaming(true);
      const transMsgId = uuid();
      addMessage(sessionId, {
        id: transMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        mode: 'text',
        model: selectedModel.name,
        attachments: [],
        isPartial: true,
      });

      const audioAtt = attachments.find((a) => a.type === 'audio');
      if (!audioAtt) {
        updateMessage(sessionId, transMsgId, {
          content: '**Transcription needs an audio file**\n\nAttach an audio file (the 📎 button) and send again to transcribe it with this speech-to-text model.',
          isPartial: false,
          isError: true,
        });
        setIsStreaming(false);
        await flushPersist();
        return;
      }

      try {
        const blob = await (await fetch(audioAtt.dataUrl)).blob();
        const transcript = await transcribeAudio(apiKey, blob, selectedModel.name, audioAtt.name);
        updateMessage(sessionId, transMsgId, {
          content: transcript || '*(No speech detected in the audio.)*',
          isPartial: false,
        });
      } catch (err) {
        handleError(err);
        updateMessage(sessionId, transMsgId, {
          content: extractFriendlyError(err, selectedModel.name, 'transcription'),
          isPartial: false,
          isError: true,
        });
      } finally {
        setIsStreaming(false);
        await flushPersist();
        postGenerationTasks();
      }
      return;
    }

    // ─── text / streaming ──────────────────────────────
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    // Build context
    const apiMessages: { role: string; content: string | Array<{ type: string;[k: string]: unknown }> }[] = [];

    const enhancementEnabled = shouldEnhancePrompt(
      settings.enablePromptEnhancement,
      effectiveMode,
    );

    // Always inject a markdown formatting instruction
    const markdownInstruction = 'Format your responses using Markdown. Use headings, bullet points, numbered lists, code blocks with language tags, bold, italic, tables, and other Markdown formatting as appropriate to make responses clear and well-structured.';
    const enhancementInstruction = enhancementEnabled
      ? 'When possible, improve prompt clarity, infer missing structure, and provide a concise, high-quality answer while preserving the user\'s intent.'
      : '';
    const systemContent = settings.systemPrompt
      ? [settings.systemPrompt, markdownInstruction, enhancementInstruction].filter(Boolean).join('\n\n')
      : [markdownInstruction, enhancementInstruction].filter(Boolean).join('\n\n');
    apiMessages.push({ role: 'system', content: systemContent });

    // Build history from the LIVE session (addMessage above already appended
    // userMsg) rather than the render-time `activeSession`. This avoids
    // resending deleted turns / duplicating the user message on regenerate/edit.
    const liveSession = getSessionById(sessionId);
    const allMessages = liveSession?.messages ?? [userMsg];
    allMessages.forEach((m) => {
      // Check if message has image attachments — send as multimodal content
      const imageAttachments = m.attachments?.filter((a) => a.type === 'image') ?? [];
      if (m.role === 'user' && imageAttachments.length > 0) {
        const outgoingText = m.id === userMsg.id && enhancementEnabled
          ? buildEnhancedPrompt(m.content)
          : m.content;
        const contentParts: Array<{ type: string;[k: string]: unknown }> = [
          { type: 'text', text: outgoingText },
        ];
        for (const att of imageAttachments) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: att.dataUrl },
          });
        }
        apiMessages.push({ role: m.role, content: contentParts });
      } else {
        const outgoingText = m.role === 'user' && m.id === userMsg.id && enhancementEnabled
          ? buildEnhancedPrompt(m.content)
          : m.content;
        apiMessages.push({ role: m.role, content: outgoingText });
      }
    });

    const effectiveTemperature = computeEffectiveTemperature(
      settings.temperature,
      settings.creativity,
    );

    // Placeholder assistant message
    const assistantId = uuid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      mode: 'text',
      model: selectedModel.name,
      attachments: [],
      isPartial: true,
    };
    addMessage(sessionId, assistantMsg);

    let accum = '';
    let accumReasoning = '';
    const reasoningStart = Date.now();
    let rafId: number | null = null;
    let renderPending = false;

    // Coalesce many token deltas into ~1 render/frame to avoid jank; the hook
    // additionally debounces the IndexedDB writes underneath.
    const scheduleRender = () => {
      if (renderPending) return;
      renderPending = true;
      rafId = requestAnimationFrame(() => {
        renderPending = false;
        rafId = null;
        updateMessage(sessionId, assistantId, {
          content: accum,
          reasoning: accumReasoning || undefined,
          tokensUsed: estimateTokens(accum),
          isPartial: true,
        });
      });
    };
    const cancelScheduled = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      renderPending = false;
    };

    try {
      await streamGeneration(
        apiKey,
        {
          model: selectedModel.name,
          messages: apiMessages,
          temperature: effectiveTemperature,
          ...(selectedModel.capabilities.deepThink
            ? { reasoning_effort: 'medium' as const }
            : {}),
        },
        {
          onContent: (chunk) => {
            accum += chunk;
            scheduleRender();
          },
          onReasoning: (chunk) => {
            accumReasoning += chunk;
            scheduleRender();
          },
          onDone: (usage) => {
            cancelScheduled();
            updateMessage(sessionId, assistantId, {
              content: accum,
              reasoning: accumReasoning || undefined,
              reasoningMs: accumReasoning ? Date.now() - reasoningStart : undefined,
              tokensUsed: usage?.completion_tokens ?? estimateTokens(accum),
              isPartial: false,
            });
          },
          signal: controller.signal,
        },
      );
    } catch (err) {
      cancelScheduled();
      if ((err as Error).name === 'AbortError') {
        updateMessage(sessionId, assistantId, {
          content: accum + (accum ? '\n\n' : '') + '*[Generation cancelled]*',
          reasoning: accumReasoning || undefined,
          isPartial: false,
        });
      } else {
        handleError(err);
        if (!accum) {
          const friendlyMsg = extractFriendlyError(err, selectedModel.name, 'text');
          updateMessage(sessionId, assistantId, {
            content: friendlyMsg,
            isPartial: false,
            isError: true,
          });
        } else {
          // Keep the partial answer we already streamed.
          updateMessage(sessionId, assistantId, {
            content: accum,
            reasoning: accumReasoning || undefined,
            isPartial: false,
          });
        }
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      await flushPersist();
      postGenerationTasks();
    }
  }, [
    selectedModel,
    settings,
    balance,
    activeSessionId,
    getSessionById,
    createSession,
    addMessage,
    updateMessage,
    notifyError,
    apiKey,
    handleError,
    postGenerationTasks,
    flushPersist,
  ]);

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  /* ── extract friendly error message ─────────────────── */
  const extractFriendlyError = (err: unknown, modelName: string, mode: string): string => {
    const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);
    if (err instanceof PollinationsError) {
      // Try to extract message from embedded JSON
      let cleaned = err.message;
      try {
        const parsed = JSON.parse(cleaned);
        cleaned = parsed.message ?? parsed.error ?? cleaned;
      } catch { /* not JSON */ }
      // Strip HTML tags from error messages
      cleaned = cleaned.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      // Check for common error patterns
      if (err.status === 502 || err.status === 503 || cleaned.includes('Bad Gateway') || cleaned.includes('Service Unavailable')) {
        return `**${modeLabel} generation failed**\n\nThe model **${modelName}** is currently unavailable or experiencing issues. Please try again later or use a different model.`;
      }
      if (err.status === 500 || cleaned.includes('Internal Server Error')) {
        return `**${modeLabel} generation failed**\n\nThe model **${modelName}** encountered an internal error. This usually means the model is temporarily down. Please try a different model.`;
      }
      if (err.status === 429) {
        return `**${modeLabel} generation failed**\n\nRate limit exceeded. Please wait a moment and try again.`;
      }
      if (err.status === 402) {
        return `**${modeLabel} generation failed**\n\nInsufficient pollen balance. Please top up your account.`;
      }
      if (err.status === 400 || cleaned.toLowerCase().includes('bad request') || cleaned.toLowerCase().includes('requires')) {
        return `**${modeLabel} generation failed**\n\nThe model **${modelName}** can't process this request: ${cleaned.slice(0, 200)}`;
      }
      // Generic cleaned message
      return `**${modeLabel} generation failed**\n\nModel **${modelName}** returned an error: ${cleaned.slice(0, 200)}${cleaned.length > 200 ? '...' : ''}`;
    }
    if (err instanceof Error) {
      const cleaned = err.message.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      return `**${modeLabel} generation failed**\n\nModel **${modelName}** is not responding. Please try a different model.\n\n_${cleaned.slice(0, 150)}_`;
    }
    return `**${modeLabel} generation failed**\n\nAn unexpected error occurred with **${modelName}**. Please try again or use a different model.`;
  };

  /* ── message actions (hover toolbar) ────────────────── */
  const handleRegenerate = useCallback(async (assistantMessageId: string) => {
    const session = getSessionById(activeSessionId);
    if (!activeSessionId || !session || isStreaming) return;
    // Find the assistant message and the user message before it
    const msgIndex = session.messages.findIndex((m) => m.id === assistantMessageId);
    if (msgIndex <= 0) return;
    const userMsg = session.messages[msgIndex - 1];
    if (userMsg.role !== 'user') return;

    // Delete the assistant message (and everything after it) — then resend.
    await deleteMessagesFrom(activeSessionId, assistantMessageId);
    handleSend(userMsg.content, userMsg.mode, userMsg.attachments);
  }, [activeSessionId, getSessionById, isStreaming, deleteMessagesFrom, handleSend]);

  const handleEditAndRegenerate = useCallback(async (userMessageId: string, newContent: string) => {
    const session = getSessionById(activeSessionId);
    if (!activeSessionId || !session || isStreaming) return;
    const msgIndex = session.messages.findIndex((m) => m.id === userMessageId);
    if (msgIndex === -1) return;
    const originalMsg = session.messages[msgIndex];

    // Delete the user message and everything after it — then resend the edit.
    await deleteMessagesFrom(activeSessionId, userMessageId);
    handleSend(newContent, originalMsg.mode, originalMsg.attachments);
  }, [activeSessionId, getSessionById, isStreaming, deleteMessagesFrom, handleSend]);

  const handleCopyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content);
    notifySuccess('Copied to clipboard');
  }, [notifySuccess]);

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!activeSessionId) return;
    await deleteMessage(activeSessionId, messageId);
  }, [activeSessionId, deleteMessage]);

  /* ── new chat ───────────────────────────────────────── */
  const handleNewChat = async () => {
    await createSession(selectedModel?.name ?? 'openai');
    setSidebarOpen(false);
  };

  /* ── sidebar ────────────────────────────────────────── */
  const sidebar = (
    <>
      {/* Collapsed strip — desktop only */}
      {sidebarCollapsed && (
        <div className="hidden lg:flex flex-col items-center w-12 flex-shrink-0 bg-card border-r border-border py-3 gap-2">
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="p-1.5 rounded-md hover:bg-accent transition-colors"
            title="Open chat list"
          >
            <svg className="w-5 h-5 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </button>
          <button
            onClick={handleNewChat}
            className="p-1.5 rounded-md hover:bg-accent transition-colors"
            title="New chat"
          >
            <svg className="w-4 h-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      )}

      {/* Full sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-30 bg-card border-r border-border transform transition-all duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0 w-72' : '-translate-x-full w-72'
          } lg:translate-x-0 lg:static lg:block ${sidebarCollapsed ? 'lg:hidden' : 'lg:w-72'
          }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-foreground text-sm">Chats</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={handleNewChat}
              className="p-1.5 rounded-md hover:bg-accent transition-colors"
              title="New chat"
            >
              <svg className="w-4 h-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
            <button
              onClick={() => {
                setSidebarCollapsed(true);
                setSidebarOpen(false);
              }}
              className="hidden lg:block p-1.5 rounded-md hover:bg-accent transition-colors"
              title="Collapse chat list"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-y-auto h-[calc(100%-57px)] p-2 space-y-1">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-1.5 p-2 rounded-md cursor-pointer transition-colors text-sm ${s.id === activeSession?.id
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50 text-muted-foreground'
                }`}
            >
              {renamingId === s.id ? (
                <input
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => {
                    if (renameText.trim()) renameSession(s.id, renameText.trim());
                    setRenamingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (renameText.trim()) renameSession(s.id, renameText.trim());
                      setRenamingId(null);
                    }
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  className="flex-1 bg-secondary border border-border rounded px-2 py-0.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
              ) : (
                <button
                  className="flex-1 text-left truncate"
                  onClick={() => {
                    switchSession(s.id);
                    setSidebarOpen(false);
                  }}
                >
                  {s.title}
                </button>
              )}
              {renamingId !== s.id && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(s.id);
                      setRenameText(s.title);
                    }}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 active:opacity-100 p-1 hover:text-foreground transition-all touch-action-manipulation"
                    title="Rename chat"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSession(s.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 active:opacity-100 p-1 hover:text-destructive transition-all touch-action-manipulation"
                    title="Delete chat"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          ))}

          {sessions.length === 0 && (
            <p className="text-xs text-muted-foreground text-center mt-8">
              No chats yet. Start a conversation!
            </p>
          )}
        </div>
      </div>
    </>
  );

  /* ── render ─────────────────────────────────────────── */
  return (
    <div className="flex h-dvh bg-background text-foreground overflow-hidden">
      {sidebar}

      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Header — unified bar with model selection and capabilities */}
        <header className="sticky top-0 z-10 flex-shrink-0 flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 sm:py-3 bg-background/95 backdrop-blur-sm border-b border-border/40">
          <button
            className="lg:hidden p-2 rounded-lg bg-secondary border border-border/50 hover:bg-accent transition-colors flex-shrink-0 text-foreground"
            onClick={() => setSidebarOpen(true)}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-full bg-brand-gradient flex-shrink-0 shadow-[0_0_10px_hsl(var(--primary)/0.6)]" />
            <span className="text-lg sm:text-xl font-bold text-brand-gradient">
              <span className="sm:hidden">P.AI</span>
              <span className="hidden sm:inline">Pollinations.AI</span>
            </span>
          </span>

          {selectedModel && (
            <>
              <div className="w-px h-5 bg-border/50 hidden sm:block" />
              <ModelInfoPanel
                model={selectedModel}
                currentInputTokens={tokenMeter.totalInputTokens}
              />
            </>
          )}

          <div className="flex-1" />

          {settings.showUsageIcon && (
            <AccountStatus
              visible={settings.showUsageIcon}
              balance={balance}
              tier={auth.tier}
              isPro={auth.isPro}
              nextResetAt={auth.nextResetAt}
              pollenBudget={pollenBudget}
              onRefresh={refreshBalance}
            />
          )}

          {/* Token meter — mobile header only */}
          {tokenMeter.usageRatio > 0 && (
            <div className="relative flex-shrink-0 sm:hidden">
              <svg className="w-7 h-7 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--secondary))" strokeWidth="3" />
                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" className={getTokenMeterColor(tokenMeter.totalInputTokens, tokenMeter.maxInputTokens)} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${Math.min(tokenMeter.usageRatio, 1) * 94.25} 94.25`} style={{ transition: 'stroke-dasharray 0.3s ease' }} />
              </svg>
              <span className={`absolute inset-0 flex items-center justify-center text-[7px] font-mono ${tokenMeter.isOverLimit ? 'text-destructive' : 'text-muted-foreground'}`}>
                {Math.min(Math.round(tokenMeter.usageRatio * 100), 100)}%
              </span>
            </div>
          )}

          <ThemeToggle />

          <button
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            title="Settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </header>

        {/* Messages + Composer layout  */}
        {messages.length === 0 ? (
          /* ── Empty state: composer centered ── */
          <div className="flex-1 flex flex-col items-center justify-center min-h-0 px-4">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="text-center mb-5 sm:mb-8"
            >
              <div className="mx-auto mb-4 w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-brand-gradient flex items-center justify-center shadow-[0_8px_30px_hsl(var(--primary)/0.35)]">
                <svg className="w-7 h-7 sm:w-8 sm:h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-xl sm:text-2xl font-bold text-brand-gradient">What can I help with?</p>
              <p className="text-sm text-muted-foreground mt-1.5">
                Chat, or generate images, video &amp; audio — powered by Pollinations.
              </p>
            </motion.div>
            <div className="w-full max-w-2xl">
              <Composer
                model={selectedModel}
                models={models}
                onSelectModel={handleModelChange}
                onSend={handleSend}
                onCancel={handleCancel}
                isStreaming={isStreaming}
                tokenInfo={{
                  totalInputTokens: tokenMeter.totalInputTokens,
                  maxInputTokens: tokenMeter.maxInputTokens,
                  isOverLimit: tokenMeter.isOverLimit,
                  usageRatio: tokenMeter.usageRatio,
                }}
                onTextChange={tokenMeter.updateComposerText}
              />
            </div>
          </div>
        ) : (
          <>
            {/* Messages — scrollable container */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <MessageList
                messages={messages}
                isStreaming={isStreaming}
                onRegenerate={handleRegenerate}
                onEditAndRegenerate={handleEditAndRegenerate}
                onCopy={handleCopyMessage}
                onDelete={handleDeleteMessage}
              />
            </div>

            {/* Composer — fixed at bottom, unaffected by content above */}
            <div className="flex-shrink-0 sticky bottom-0 z-10 bg-background">
              <Composer
                model={selectedModel}
                models={models}
                onSelectModel={handleModelChange}
                onSend={handleSend}
                onCancel={handleCancel}
                isStreaming={isStreaming}
                tokenInfo={{
                  totalInputTokens: tokenMeter.totalInputTokens,
                  maxInputTokens: tokenMeter.maxInputTokens,
                  isOverLimit: tokenMeter.isOverLimit,
                  usageRatio: tokenMeter.usageRatio,
                }}
                onTextChange={tokenMeter.updateComposerText}
              />
            </div>
          </>
        )}
      </div>

      {/* Settings modal */}
      <AnimatePresence>
        {settingsOpen && (
          <Settings
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            sessions={sessions}
            onImport={importSessions}
            onClearAll={clearAll}
            onClose={() => setSettingsOpen(false)}
            onLogout={onLogout}
            notifySuccess={notifySuccess}
            notifyError={notifyError}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
