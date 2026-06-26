/**
 * Pollinations API Client
 *
 * All communication with gen.pollinations.ai happens through this module.
 * Endpoints reference: https://github.com/pollinations/pollinations/blob/main/APIDOCS.md
 */

import type {
  PollinationsModel,
  ModelCapabilities,
  ModelPricing,
  AccountBalance,
  AccountProfile,
  ApiKeyInfo,
  UsageRecord,
  StreamDelta,
} from '../types';

const BASE = 'https://gen.pollinations.ai';

// ─── Helpers ─────────────────────────────────────────────────────

function headers(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

/** Wrap fetch so offline/DNS/CORS failures become a typed PollinationsError. */
async function safeFetch(url: string, init?: RequestInit) {
  try {
    return await fetch(url, init);
  } catch (err) {
    // Deliberate aborts (caller cancel or timeout) must propagate untouched.
    if ((err as Error)?.name === 'AbortError' || (err as Error)?.name === 'TimeoutError') {
      throw err;
    }
    // Network errors (offline, DNS, CORS)
    if (err instanceof TypeError) {
      throw new PollinationsError(
        'Unable to connect to the server. Please check your internet connection and try again.',
        0,
        'network_error',
      );
    }
    throw err;
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Best-effort timeout signal; undefined on browsers without AbortSignal.timeout. */
function timeoutSignal(ms: number): AbortSignal | undefined {
  try {
    return AbortSignal.timeout(ms);
  } catch {
    return undefined;
  }
}

/**
 * Retry an idempotent request with exponential backoff. Retries on network
 * errors and retryable HTTP statuses, honoring the Retry-After header.
 * Deliberate aborts are never retried.
 */
async function withRetry(
  fn: () => Promise<Response>,
  {
    attempts = 3,
    baseDelay = 500,
    retryNetworkErrors = true,
  }: { attempts?: number; baseDelay?: number; retryNetworkErrors?: boolean } = {},
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fn();
      if (RETRYABLE_STATUS.has(res.status) && i < attempts - 1) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const delay =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : baseDelay * 2 ** i;
        await sleep(delay);
        continue;
      }
      return res;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || (err as Error)?.name === 'TimeoutError') {
        throw err;
      }
      // Non-idempotent calls (the streaming POST) must NOT be re-sent on a network
      // error — the request may already have triggered a billable generation.
      if (!retryNetworkErrors) throw err;
      lastErr = err;
      if (i < attempts - 1) {
        await sleep(baseDelay * 2 ** i);
        continue;
      }
    }
  }
  throw lastErr;
}

/** GET JSON with timeout + retry, throwing a typed PollinationsError on failure. */
async function getJSON<T>(
  path: string,
  apiKey: string | undefined,
  opts: { timeoutMs?: number; errorMessage: string; errorCode: string },
): Promise<T> {
  const { timeoutMs = 15000, errorMessage, errorCode } = opts;
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;

  const res = await withRetry(() =>
    safeFetch(`${BASE}${path}`, { headers: h, signal: timeoutSignal(timeoutMs) }),
  );
  if (!res.ok) {
    if (res.status === 401) {
      throw new PollinationsError('Invalid or expired API key. Please sign in again.', 401, 'invalid_key');
    }
    const body = await res.json().catch(() => null);
    throw new PollinationsError(parseApiError(body, errorMessage), res.status, errorCode);
  }
  return res.json() as Promise<T>;
}

// ─── API Key Validation ──────────────────────────────────────────

/**
 * Validate an API key without making an expensive generation request.
 * Uses GET /account/key which returns key info + validity.
 */
export async function validateApiKey(apiKey: string): Promise<ApiKeyInfo> {
  const info = await getJSON<ApiKeyInfo>('/account/key', apiKey, {
    errorMessage: 'Unable to validate your API key. Please try again later.',
    errorCode: 'validation_failed',
  });
  // Runtime guard — schema drift or an edge-proxy HTML 200 must not silently
  // produce `valid: undefined` and lock out a valid user.
  if (!info || typeof info.valid !== 'boolean') {
    throw new PollinationsError('Unexpected response while validating your API key. Please try again.', 0, 'invalid_response');
  }
  return info;
}

// ─── Account ─────────────────────────────────────────────────────

export async function getBalance(apiKey: string): Promise<AccountBalance> {
  const b = await getJSON<AccountBalance>('/account/balance', apiKey, {
    errorMessage: 'Unable to fetch your balance. Please try again later.',
    errorCode: 'balance_failed',
  });
  if (!b || typeof b.balance !== 'number' || !Number.isFinite(b.balance)) {
    throw new PollinationsError('Received an invalid balance from the server.', 0, 'invalid_response');
  }
  return b;
}

export async function getProfile(apiKey: string): Promise<AccountProfile> {
  const p = await getJSON<AccountProfile>('/account/profile', apiKey, {
    errorMessage: 'Unable to fetch your profile. Please try again later.',
    errorCode: 'profile_failed',
  });
  if (!p || typeof p.tier !== 'string') {
    throw new PollinationsError('Received an invalid profile from the server.', 0, 'invalid_response');
  }
  return p;
}

export async function getUsage(
  apiKey: string,
): Promise<{ usage: UsageRecord[]; count: number }> {
  return getJSON('/account/usage', apiKey, {
    errorMessage: 'Unable to fetch usage data. Please try again later.',
    errorCode: 'usage_failed',
  });
}

// ─── Smoke Tests ─────────────────────────────────────────────────

/**
 * Minimal smoke test: sends a tiny chat completion request to verify
 * the key works with a given model.  Returns { ok, status, userTier }.
 */
export async function smokeTest(
  apiKey: string,
  modelName: string,
  prompt = 'hi',
): Promise<{ ok: boolean; status: number; userTier?: string; error?: string }> {
  try {
    const res = await safeFetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: headers(apiKey),
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4,
        stream: false,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return {
        ok: false,
        status: res.status,
        error: body?.error?.message ?? `HTTP ${res.status}`,
      };
    }
    const body = await res.json();
    return {
      ok: true,
      status: res.status,
      userTier: body.user_tier,
    };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

// ─── Model Discovery ─────────────────────────────────────────────

interface RawTextModel {
  name: string;
  aliases?: string[];
  pricing?: ModelPricing;
  description?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  paid_only?: boolean;
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
  // capabilities
  vision?: boolean;
  audio?: boolean;
  web_search?: boolean;
  deep_think?: boolean;
  code_execution?: boolean;
  // extra fields from API
  tools?: boolean;
  reasoning?: boolean;
  voices?: string[];
  is_specialized?: boolean;
}

interface RawImageModel {
  name: string;
  aliases?: string[];
  pricing?: ModelPricing;
  description?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  paid_only?: boolean;
}

interface RawAudioModel {
  name: string;
  aliases?: string[];
  pricing?: ModelPricing;
  description?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  paid_only?: boolean;
  voices?: string[];
}

function inferCapabilities(m: RawTextModel): ModelCapabilities {
  const inputs = m.input_modalities ?? [];
  const name = m.name.toLowerCase();
  return {
    vision: inputs.includes('image') || !!m.vision,
    audio:
      inputs.includes('audio') ||
      !!m.audio ||
      name.includes('audio'),
    streaming: true, // all text models support streaming via /v1/chat/completions
    webSearch:
      !!m.web_search ||
      name.includes('search') ||
      name.includes('perplexity'),
    deepThink:
      !!m.deep_think ||
      name.includes('deepseek') ||
      name.includes('reasoning'),
    codeExecution: !!m.code_execution || name.includes('coder'),
  };
}

/** Default token limits when metadata doesn't specify them */
function defaultTokenLimits(name: string): {
  maxInput: number;
  maxOutput: number;
} {
  const n = name.toLowerCase();
  if (n.includes('large')) return { maxInput: 128000, maxOutput: 8192 };
  if (n.includes('fast') || n.includes('mini'))
    return { maxInput: 32000, maxOutput: 4096 };
  return { maxInput: 64000, maxOutput: 4096 };
}

/**
 * A model is "paid" when any of its pricing fields is a positive number.
 * (The docs express paid-vs-free via pricing values, not a `paid_only` flag,
 * so we derive it from pricing and only fall back to the flag if present.)
 */
function isPaidPricing(p?: ModelPricing): boolean {
  if (!p) return false;
  const vals = [
    p.promptTextTokens, p.promptImageTokens, p.promptCachedTokens, p.promptAudioTokens,
    p.completionTextTokens, p.completionImageTokens, p.completionAudioTokens,
    p.completionVideoTokens, p.completionVideoSeconds, p.completionAudioSeconds,
  ];
  return vals.some((v) => Number(v) > 0);
}

/** Fetch a model list (array) with retry + timeout, throwing typed errors. */
async function fetchRawModels<T>(path: string, apiKey?: string): Promise<T[]> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) h.Authorization = `Bearer ${apiKey}`;
  const res = await withRetry(() =>
    safeFetch(`${BASE}${path}`, { headers: h, signal: timeoutSignal(15000) }),
  );
  if (!res.ok) {
    throw new PollinationsError(`Failed to load models (${res.status}).`, res.status, 'models_failed');
  }
  const data = await res.json().catch(() => null);
  if (!Array.isArray(data)) {
    throw new PollinationsError('The model list had an unexpected shape.', 0, 'invalid_response');
  }
  return data as T[];
}

export async function getTextModels(apiKey?: string): Promise<PollinationsModel[]> {
  const raw = await fetchRawModels<RawTextModel>('/text/models', apiKey);

  return raw.map((m) => {
    const limits = defaultTokenLimits(m.name);
    const maxInput = m.max_input_tokens ?? m.context_length ?? limits.maxInput;
    const maxOutput = m.max_output_tokens ?? limits.maxOutput;

    // Detect audio models based on output modalities or capabilities
    const outputs = m.output_modalities ?? ['text'];
    const isAudio = outputs.includes('audio') || !!m.audio || m.name.toLowerCase().includes('audio');

    return {
      id: m.name,
      name: m.name,
      description: m.description ?? '',
      type: isAudio ? ('audio' as const) : ('text' as const),
      inputModalities: m.input_modalities ?? ['text'],
      outputModalities: m.output_modalities ?? ['text'],
      paidOnly: m.paid_only ?? isPaidPricing(m.pricing),
      pricing: m.pricing ?? { currency: 'pollen' },
      capabilities: inferCapabilities(m),
      maxInputTokens: maxInput,
      maxOutputTokens: maxOutput,
      contextLength: maxInput + maxOutput,
      aliases: m.aliases ?? [],
    };
  });
}

export async function getImageModels(apiKey?: string): Promise<PollinationsModel[]> {
  const raw = await fetchRawModels<RawImageModel>('/image/models', apiKey);

  return raw.map((m) => {
    const outputs = m.output_modalities ?? ['image'];
    const isVideo = outputs.includes('video');
    return {
      id: m.name,
      name: m.name,
      description: m.description ?? '',
      type: isVideo ? ('video' as const) : ('image' as const),
      inputModalities: m.input_modalities ?? ['text'],
      outputModalities: outputs,
      paidOnly: m.paid_only ?? isPaidPricing(m.pricing),
      pricing: m.pricing ?? { currency: 'pollen' },
      capabilities: {
        vision: (m.input_modalities ?? []).includes('image'),
        audio: false,
        streaming: false,
        webSearch: false,
        deepThink: false,
        codeExecution: false,
      },
      maxInputTokens: 4096,
      maxOutputTokens: 1, // 1 image/video
      contextLength: 4097,
      aliases: m.aliases ?? [],
    };
  });
}

export async function getAudioModels(apiKey?: string): Promise<PollinationsModel[]> {
  const raw = await fetchRawModels<RawAudioModel>('/audio/models', apiKey);

  return raw.map((m) => {
    const inputs = m.input_modalities ?? ['text'];
    const outputs = m.output_modalities ?? ['audio'];
    // Speech-to-text (e.g. whisper, scribe, universal-2/-3-pro): audio in, text out.
    // These must NOT go to the text-to-audio endpoint — treat them as
    // text-producing transcription models instead.
    const isSTT = inputs.includes('audio') && outputs.includes('text') && !outputs.includes('audio');
    return {
      id: m.name,
      name: m.name,
      description: m.description ?? '',
      type: isSTT ? ('text' as const) : ('audio' as const),
      inputModalities: inputs,
      outputModalities: outputs,
      paidOnly: m.paid_only ?? isPaidPricing(m.pricing),
      pricing: m.pricing ?? { currency: 'pollen' },
      capabilities: {
        vision: false,
        audio: !isSTT, // TTS models produce audio; STT models consume it
        streaming: false,
        webSearch: false,
        deepThink: false,
        codeExecution: false,
        transcription: isSTT,
      },
      maxInputTokens: 4096,
      maxOutputTokens: isSTT ? 4096 : 1,
      contextLength: 4097,
      aliases: m.aliases ?? [],
    };
  });
}

/**
 * Fetch all models (text + image/video + audio) and return combined list.
 */
export async function getAllModels(apiKey?: string): Promise<PollinationsModel[]> {
  // allSettled: one failed endpoint must not blank the entire model picker.
  const results = await Promise.allSettled([
    getTextModels(apiKey),
    getImageModels(apiKey),
    getAudioModels(apiKey),
  ]);
  const [text, image, audio] = results.map((r) =>
    r.status === 'fulfilled' ? r.value : ([] as PollinationsModel[]),
  );
  // Filter out audio-type models from text list (they come from the audio endpoint)
  const filtered = text.filter((m) => m.type !== 'audio');
  const all = [...filtered, ...image, ...audio];
  if (all.length === 0) {
    throw new PollinationsError(
      'Could not load any models. Please check your connection and try again.',
      0,
      'models_failed',
    );
  }
  return all;
}

// ─── Streaming Generation ────────────────────────────────────────

export interface ChatCompletionPayload {
  model: string;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; [k: string]: unknown }>;
  }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  /** Reasoning models only — how much thinking budget to spend */
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';
  stream_options?: { include_usage: boolean };
}

export interface StreamHandlers {
  /** Called with each answer text delta */
  onContent: (text: string) => void;
  /** Called with each reasoning/"thinking" delta (reasoning models only) */
  onReasoning?: (text: string) => void;
  /** Called once when the stream ends, with final usage + tier */
  onDone: (usage?: StreamDelta['usage'], userTier?: string) => void;
  /** Optional cancellation signal */
  signal?: AbortSignal;
}

/**
 * Stream a chat completion from the Pollinations API (OpenAI-compatible SSE).
 *
 * The initial connection is retried on transient errors (429/5xx); the stream
 * itself is never retried mid-flight. The SSE parser tolerates spacing variants
 * (`data:[DONE]`), CRLF line endings, and reasoning deltas, and always releases
 * the reader on exit.
 */
export async function streamGeneration(
  apiKey: string,
  payload: ChatCompletionPayload,
  handlers: StreamHandlers,
): Promise<void> {
  const { onContent, onReasoning, onDone, signal } = handlers;

  const temperature =
    payload.temperature != null
      ? Math.max(0, Math.min(2, payload.temperature)) // clamp to documented 0–2
      : undefined;

  const body = {
    ...payload,
    temperature,
    stream: true,
    stream_options: { include_usage: true },
  };

  // Retry only the INITIAL connect, and only on retryable HTTP statuses (429/5xx);
  // never re-send on a network error (the POST may already be generating).
  const res = await withRetry(
    () =>
      safeFetch(`${BASE}/v1/chat/completions`, {
        method: 'POST',
        headers: headers(apiKey),
        body: JSON.stringify(body),
        signal,
      }),
    { retryNetworkErrors: false },
  );

  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new PollinationsError(
      parseApiError(errBody, `Generation failed (HTTP ${res.status}).`),
      res.status,
      errBody?.error?.code ?? '',
    );
  }

  // Guard against a JSON error returned with a 200 status (not an SSE stream).
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json') && !contentType.includes('event-stream')) {
    const errBody = await res.json().catch(() => null);
    throw new PollinationsError(
      parseApiError(errBody, 'This model does not support text streaming.'),
      200,
      errBody?.error?.code ?? 'unsupported_model',
    );
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new PollinationsError('The server returned an empty response. Please try again.', 0, 'empty_body');
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let lastUsage: StreamDelta['usage'] | undefined;
  let lastTier: string | undefined;

  // Parse a single `data:` line; returns true if it was the [DONE] sentinel.
  const handleLine = (raw: string): boolean => {
    const line = raw.replace(/\r$/, '').trim();
    if (!line || line.startsWith(':') || !line.startsWith('data:')) return false;
    const data = line.slice(5).trimStart(); // tolerate "data:" and "data: "
    if (data === '[DONE]') return true;
    try {
      const json: StreamDelta = JSON.parse(data);
      if (json.usage) lastUsage = json.usage;
      if (json.user_tier) lastTier = json.user_tier;
      const delta = json.choices?.[0]?.delta;
      if (delta?.content) onContent(delta.content);
      const reasoning = delta?.reasoning ?? delta?.reasoning_content;
      if (reasoning && onReasoning) onReasoning(reasoning);
    } catch {
      // skip malformed chunks
    }
    return false;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (handleLine(line)) {
          onDone(lastUsage, lastTier);
          return;
        }
      }
    }
    // Flush any bytes the decoder retained (incomplete trailing multibyte char).
    buffer += decoder.decode();
    // Flush a trailing event with no final newline.
    if (buffer && handleLine(buffer)) {
      onDone(lastUsage, lastTier);
      return;
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  // Exited without an explicit [DONE] — still finalize.
  onDone(lastUsage, lastTier);
}

// ─── Image Generation ────────────────────────────────────────────

export async function generateImage(
  apiKey: string,
  prompt: string,
  model = 'flux',
  options: Record<string, string | number | boolean> = {},
): Promise<Blob> {
  const params = new URLSearchParams({
    model,
    ...Object.fromEntries(
      Object.entries(options).map(([k, v]) => [k, String(v)]),
    ),
  });
  const url = `${BASE}/image/${encodeURIComponent(prompt)}?${params}`;
  const res = await safeFetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    // Try to extract a JSON error message
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const errBody = await res.json().catch(() => null);
      const msg = parseApiError(errBody, `Image generation failed: ${res.status}`);
      throw new PollinationsError(msg, res.status, typeof errBody?.error === 'object' ? errBody?.error?.code ?? '' : '');
    }
    throw new PollinationsError(`Image generation failed: ${res.status}`, res.status, '');
  }
  // Validate the response is actually binary media, not a JSON error with 200 status
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const errBody = await res.json().catch(() => null);
    const msg = parseApiError(errBody, 'Unexpected JSON response from image endpoint');
    throw new PollinationsError(msg, 200, typeof errBody?.error === 'object' ? errBody?.error?.code ?? '' : 'unexpected_json');
  }
  const blob = await res.blob();
  // Some APIs return JSON errors with wrong content-type — check small blobs
  if (blob.size < 10_000 && !blob.type.startsWith('image/')) {
    try {
      const text = await blob.text();
      const parsed = JSON.parse(text);
      if (parsed.error || parsed.message) {
        const msg = parseApiError(parsed, 'Image generation failed');
        throw new PollinationsError(msg, parsed.error === 'Bad Request' ? 400 : 500, '');
      }
    } catch (e) {
      if (e instanceof PollinationsError) throw e;
      // Not JSON — return the blob as-is
    }
  }
  return blob;
}

// ─── Video Generation ──────────────────────────────────────────

export async function generateVideo(
  apiKey: string,
  prompt: string,
  model = 'veo',
  options: Record<string, string | number | boolean> = {},
): Promise<Blob> {
  const params = new URLSearchParams({
    model,
    ...Object.fromEntries(
      Object.entries(options).map(([k, v]) => [k, String(v)]),
    ),
  });
  // Video models use the same /image/ endpoint on Pollinations
  const url = `${BASE}/image/${encodeURIComponent(prompt)}?${params}`;
  const res = await safeFetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const errBody = await res.json().catch(() => null);
      const msg = parseApiError(errBody, `Video generation failed: ${res.status}`);
      throw new PollinationsError(msg, res.status, typeof errBody?.error === 'object' ? errBody?.error?.code ?? '' : '');
    }
    throw new PollinationsError(`Video generation failed: ${res.status}`, res.status, '');
  }
  // Validate the response is actually binary media
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const errBody = await res.json().catch(() => null);
    const msg = parseApiError(errBody, 'Unexpected JSON response from video endpoint');
    throw new PollinationsError(msg, 200, typeof errBody?.error === 'object' ? errBody?.error?.code ?? '' : 'unexpected_json');
  }
  const blob = await res.blob();
  // Some APIs return JSON errors with wrong content-type — check small blobs
  if (blob.size < 10_000 && !blob.type.startsWith('video/')) {
    try {
      const text = await blob.text();
      const parsed = JSON.parse(text);
      if (parsed.error || parsed.message) {
        const msg = parseApiError(parsed, 'Video generation failed');
        throw new PollinationsError(msg, parsed.error === 'Bad Request' ? 400 : 500, '');
      }
    } catch (e) {
      if (e instanceof PollinationsError) throw e;
    }
  }
  return blob;
}

// ─── Audio Generation ────────────────────────────────────────────

export async function generateAudio(
  apiKey: string,
  text: string,
  voice = 'alloy',
  model = 'openai-audio',
): Promise<Blob> {
  const res = await safeFetch(`${BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      input: text,
      voice,
      model,
      response_format: 'mp3',
    }),
  });
  if (!res.ok) {
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const errBody = await res.json().catch(() => null);
      const msg = errBody?.error?.message ?? errBody?.message ?? `Audio generation failed: ${res.status}`;
      throw new PollinationsError(msg, res.status, errBody?.error?.code ?? '');
    }
    throw new PollinationsError(`Audio generation failed: ${res.status}`, res.status, '');
  }
  return res.blob();
}

/**
 * Generate audio via GET /audio/{text} — used for dedicated audio models
 * (TTS voices and music generation via elevenmusic).
 */
export async function generateAudioDirect(
  apiKey: string,
  text: string,
  model: string,
  options: { voice?: string; duration?: number; instrumental?: boolean } = {},
): Promise<Blob> {
  const params = new URLSearchParams({ model });
  if (options.voice) params.set('voice', options.voice);
  if (options.duration) params.set('duration', String(options.duration));
  if (options.instrumental !== undefined) params.set('instrumental', String(options.instrumental));

  // Send the key via the Authorization header — never the query string
  // (query params leak into logs, history, and Referer headers).
  const url = `${BASE}/audio/${encodeURIComponent(text)}?${params}`;
  const res = await safeFetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const errBody = await res.json().catch(() => null);
      const msg = parseApiError(errBody, `Audio generation failed: ${res.status}`);
      throw new PollinationsError(msg, res.status, typeof errBody?.error === 'object' ? errBody?.error?.code ?? '' : '');
    }
    throw new PollinationsError(`Audio generation failed: ${res.status}`, res.status, '');
  }
  return res.blob();
}

// ─── Transcription (speech-to-text) ──────────────────────────────

/**
 * Transcribe an audio file to text via POST /v1/audio/transcriptions
 * (OpenAI-compatible, multipart/form-data). Used by STT models like whisper,
 * scribe, universal-2 and universal-3-pro.
 */
export async function transcribeAudio(
  apiKey: string,
  file: Blob,
  model: string,
  filename = 'audio',
): Promise<string> {
  const form = new FormData();
  form.append('file', file, filename);
  form.append('model', model);

  // Do NOT set Content-Type — the browser adds the multipart boundary.
  const res = await safeFetch(`${BASE}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new PollinationsError(
      parseApiError(errBody, `Transcription failed (HTTP ${res.status}).`),
      res.status,
      typeof errBody?.error === 'object' ? errBody?.error?.code ?? '' : '',
    );
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const data = await res.json().catch(() => null);
    return String(data?.text ?? data?.transcript ?? '').trim();
  }
  return (await res.text()).trim();
}

// ─── Parse API errors (handles both {error:{message}} and {error:string, message:string}) ──

function parseApiError(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  
  const bodyObj = body as Record<string, unknown>;
  
  // Standard OpenAI-style: { error: { message: "..." } }
  if (typeof bodyObj.error === 'object' && bodyObj.error !== null) {
    const errorObj = bodyObj.error as Record<string, unknown>;
    if (typeof errorObj.message === 'string') {
      return stripHtml(errorObj.message);
    }
  }
  
  // Pollinations-style: { error: "Internal Server Error", message: "..." }
  if (typeof bodyObj.message === 'string') {
    return stripHtml(bodyObj.message);
  }
  
  if (typeof bodyObj.error === 'string') {
    return stripHtml(bodyObj.error);
  }
  
  return fallback;
}

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// ─── Custom error class ──────────────────────────────────────────

export class PollinationsError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'PollinationsError';
    this.status = status;
    this.code = code;
  }
}
