import { describe, it, expect } from 'vitest';
import { detectMentionTrigger } from './mention-trigger';

describe('detectMentionTrigger', () => {
  describe('@ user mention', () => {
    it('detects @ at start of input', () => {
      const result = detectMentionTrigger('@lu', 3, '@');
      expect(result).toEqual({ query: 'lu', start: 0 });
    });

    it('detects @ after space', () => {
      const result = detectMentionTrigger('hello @lu', 9, '@');
      expect(result).toEqual({ query: 'lu', start: 6 });
    });

    it('does NOT trigger after word char (email@gmail)', () => {
      const result = detectMentionTrigger('email@gmail', 11, '@');
      expect(result).toBeNull();
    });

    it('detects @ with empty query', () => {
      const result = detectMentionTrigger('hello @', 7, '@');
      expect(result).toEqual({ query: '', start: 6 });
    });

    it('does NOT trigger mid-word', () => {
      const result = detectMentionTrigger('test@user', 9, '@');
      expect(result).toBeNull();
    });
  });

  describe('# channel mention', () => {
    it('detects # at start of input', () => {
      const result = detectMentionTrigger('#cove', 5, '#');
      expect(result).toEqual({ query: 'cove', start: 0 });
    });

    it('matches hyphenated channel names', () => {
      const result = detectMentionTrigger('#cove-dev', 9, '#');
      expect(result).toEqual({ query: 'cove-dev', start: 0 });
    });

    it('detects # after space', () => {
      const result = detectMentionTrigger('see #general', 12, '#');
      expect(result).toEqual({ query: 'general', start: 4 });
    });

    it('does NOT trigger after word char', () => {
      const result = detectMentionTrigger('issue#123', 9, '#');
      expect(result).toBeNull();
    });
  });
});
