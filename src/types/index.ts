// ─── Core Types for Pollinations Chat ───

/** Generation mode the user can select per message */
export type GenerationMode = 'text' | 'image' | 'video' | 'audio';

/** Authentication state */
export interface AuthState {
  apiKey: string;
  valid: boolean;
  isPro: boolean;
  tier: string;
  nextResetAt: string | null;
}

/** Capabilities a model may support */
export interface ModelCapabilities {
  vision: boolean;
  audio: boolean;
  streaming: boolean;
  webSearch: boolean;
  deepThink: boolean;
  codeExecution: boolean;
}

/** Pricing info from Pollinations model metadata */
export interface ModelPricing {
  currency: string;
  promptTextTokens?: number;
  promptImageTokens?: number;
  promptCachedTokens?: number;
  promptAudioTokens?: number;
  completionTextTokens?: number;
  completionImageTokens?: number;
  completionVideoSeconds?: number;
  completionVideoTokens?: number;
  completionAudioSeconds?: number;
  completionAudioTokens?: number;
}

/** Unified model info (text + image models merged) */
export interface PollinationsModel {
  id: string;
  name: string;
  description: string;
  type: 'text' | 'image' | 'video' | 'audio';
  inputModalities: string[];
  outputModalities: string[];
  paidOnly: boolean;
  pricing: ModelPricing;
  capabilities: ModelCapabilities;
  maxInputTokens: number;
  maxOutputTokens: number;
  contextLength: number;
  aliases: string[];
}

/** Attachment on a chat message */
export interface MessageAttachment {
  id: string;
  type: 'image' | 'video' | 'audio' | 'file';
  name: string;
  mimeType: string;
  dataUrl: string;       // base64 data URL
  sizeBytes: number;
}

/** A single chat message */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  mode: GenerationMode;
  attachments: MessageAttachment[];
  timestamp: number;
  model?: string;
  tokensUsed?: number;
  pollenSpent?: number;
  isPartial?: boolean;   // true while streaming
  isError?: boolean;
}

/** A chat session (stored locally) */
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  createdAt: number;
  updatedAt: number;
  totalPollenSpent: number;
}

/** Exported chat format */
export interface ChatExport {
  version: '1.0';
  exportedAt: string;
  sessions: ChatSession[];
}

/** Usage record from Pollinations API */
export interface UsageRecord {
  timestamp: string;
  type: string;
  model: string;
  input_text_tokens: number;
  input_cached_tokens: number;
  input_audio_tokens: number;
  input_image_tokens: number;
  output_text_tokens: number;
  output_reasoning_tokens: number;
  output_audio_tokens: number;
  output_image_tokens: number;
  cost_usd: number;
  response_time_ms: number;
}

/** Account balance */
export interface AccountBalance {
  balance: number;
}

/** Account profile */
export interface AccountProfile {
  name: string | null;
  email: string | null;
  githubUsername: string | null;
  tier: string;
  createdAt: string;
  nextResetAt: string | null;
}

/** API Key info */
export interface ApiKeyInfo {
  valid: boolean;
  type: 'publishable' | 'secret';
  name: string | null;
  expiresAt: string | null;
  expiresIn: number | null;
  permissions: {
    models: string[] | null;
    account: string[] | null;
  };
  pollenBudget: number | null;
  rateLimitEnabled: boolean;
}

/** Notification type */
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  duration?: number;
}

/** App settings stored locally */
export interface AppSettings {
  showUsageIcon: boolean;
  autoFetchUsage: boolean;
  autoReadBalance: boolean;
  selectedModel: string;
  systemPrompt: string;
  temperature: number;
  creativity: number;
  enablePromptEnhancement: boolean;
  theme: 'dark';
}

/** OpenAI-compatible streaming chunk */
export interface StreamDelta {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  user_tier?: string;
}
