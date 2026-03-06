import { describe, it, expect } from 'vitest';
import {
  buildEnhancedPrompt,
  clamp,
  computeEffectiveTemperature,
  shouldEnhancePrompt,
} from '../src/lib/promptEnhancement';

describe('promptEnhancement', () => {
  describe('clamp', () => {
    it('keeps values within bounds', () => {
      expect(clamp(1.2, 0, 2)).toBe(1.2);
    });

    it('clamps below min', () => {
      expect(clamp(-1, 0, 2)).toBe(0);
    });

    it('clamps above max', () => {
      expect(clamp(5, 0, 2)).toBe(2);
    });
  });

  describe('computeEffectiveTemperature', () => {
    it('uses both temperature and creativity', () => {
      const effective = computeEffectiveTemperature(0.8, 0.5);
      expect(effective).toBeCloseTo(0.8, 6);
    });

    it('reduces influence at low creativity', () => {
      const effective = computeEffectiveTemperature(1, 0);
      expect(effective).toBeCloseTo(0.5, 6);
    });

    it('clamps to 2 max', () => {
      const effective = computeEffectiveTemperature(2, 1);
      expect(effective).toBe(2);
    });
  });

  describe('shouldEnhancePrompt', () => {
    it('returns true only for enabled text mode', () => {
      expect(shouldEnhancePrompt(true, 'text')).toBe(true);
      expect(shouldEnhancePrompt(true, 'image')).toBe(false);
      expect(shouldEnhancePrompt(false, 'text')).toBe(false);
    });
  });

  describe('buildEnhancedPrompt', () => {
    it('normalizes whitespace and embeds original request', () => {
      const enhanced = buildEnhancedPrompt('  Write   a   summary   ');
      expect(enhanced).toContain('Original request: Write a summary');
    });

    it('returns original text for blank input', () => {
      expect(buildEnhancedPrompt('   ')).toBe('   ');
    });
  });
});
