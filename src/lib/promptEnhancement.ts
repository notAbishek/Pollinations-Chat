export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeEffectiveTemperature(
  temperature: number,
  creativity: number,
): number {
  const safeTemp = clamp(temperature, 0, 2);
  const safeCreativity = clamp(creativity, 0, 1);
  const scaled = safeTemp * (0.5 + safeCreativity);
  return clamp(scaled, 0, 2);
}

export function buildEnhancedPrompt(userText: string): string {
  const normalized = userText.replace(/\s+/g, ' ').trim();
  if (!normalized) return userText;

  return [
    'Rewrite and fulfill the request with improved clarity and structure while preserving the user intent.',
    'Keep facts unchanged and avoid inventing details.',
    '',
    `Original request: ${normalized}`,
  ].join('\n');
}

export function shouldEnhancePrompt(
  enablePromptEnhancement: boolean,
  mode: 'text' | 'image' | 'video' | 'audio',
): boolean {
  return enablePromptEnhancement && mode === 'text';
}
