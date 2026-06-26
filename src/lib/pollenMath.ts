/**
 * Pollen Math — precise calculations for pollen cost enforcement.
 *
 * Base: 1 pollen = 25,000 prompts on the cheapest model
 * → pollen per prompt = 1 / 25000 = 0.00004
 *
 * All comparisons use a tiny epsilon for float rounding.
 */

import type { ModelPricing } from '../types';

/** Minimum pollen cost for a single prompt on the cheapest model */
export const MIN_POLLEN_PER_PROMPT = 0.00004; // 1 / 25000

/** Float comparison epsilon — half the smallest billable unit */
const EPSILON = MIN_POLLEN_PER_PROMPT / 2;

/** Coerce a pricing field (the API sometimes returns decimal strings) to a finite number. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compute estimated pollen cost for a generation request.
 *
 * Each applicable modality is summed INDEPENDENTLY (a model priced for both text
 * and image output is charged for both). Input image tokens are included so
 * vision requests are not undercharged. Falls back to MIN_POLLEN_PER_PROMPT.
 *
 * @param pricing          - pricing info from model metadata
 * @param inputTokens      - estimated text input tokens
 * @param outputTokens     - estimated text output tokens (or 1 for images)
 * @param imageInputTokens - estimated image input tokens (vision)
 * @param audioInputTokens - estimated audio input tokens (speech-in models)
 */
export function computePollenCost(
  pricing: Partial<ModelPricing> | null | undefined,
  inputTokens = 100,
  outputTokens = 500,
  imageInputTokens = 0,
  audioInputTokens = 0,
): number {
  if (!pricing) return MIN_POLLEN_PER_PROMPT;

  let cost = 0;

  // ── Input — each modality billed against its OWN quantity ──
  cost += num(pricing.promptTextTokens) * inputTokens;
  if (imageInputTokens > 0) cost += num(pricing.promptImageTokens) * imageInputTokens;
  if (audioInputTokens > 0) cost += num(pricing.promptAudioTokens) * audioInputTokens;

  // ── Output — sum every applicable modality (independent, not else-if) ──
  cost += num(pricing.completionTextTokens) * outputTokens;
  if (num(pricing.completionImageTokens) > 0) cost += num(pricing.completionImageTokens); // per image
  if (num(pricing.completionVideoTokens) > 0) cost += num(pricing.completionVideoTokens) * outputTokens;
  if (num(pricing.completionAudioTokens) > 0) cost += num(pricing.completionAudioTokens) * outputTokens;
  if (num(pricing.completionVideoSeconds) > 0) cost += num(pricing.completionVideoSeconds) * 5; // ~5s estimate
  if (num(pricing.completionAudioSeconds) > 0) cost += num(pricing.completionAudioSeconds) * 10; // ~10s estimate

  return Math.max(cost, MIN_POLLEN_PER_PROMPT);
}

/**
 * Check if the user has sufficient pollen balance for a request.
 * Guards against NaN/Infinity and uses a tiny epsilon for float rounding.
 */
export function hasSufficientPollen(
  balance: number,
  requiredPollen: number,
): boolean {
  if (!Number.isFinite(balance)) return false;
  const need = Number.isFinite(requiredPollen) ? requiredPollen : MIN_POLLEN_PER_PROMPT;
  return balance + EPSILON >= need;
}

/**
 * Format pollen value for display — show up to 5 decimal places.
 */
export function formatPollen(value: number): string {
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(4);
  return value.toFixed(5);
}

/**
 * Compute the math example for verification:
 * 1 / 25000 = 0.00004
 */
export function verifyPollenMath(): boolean {
  const result = 1 / 25000;
  // Verify digit-by-digit: 0.00004
  return Math.abs(result - 0.00004) < EPSILON;
}
