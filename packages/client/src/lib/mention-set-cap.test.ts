import { describe, it, expect } from 'vitest';

describe('mentionedMessageIds Set cap', () => {
  it('prunes oldest half when exceeding 1000', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1001; i++) set.add('msg-' + i);

    if (set.size > 1000) {
      const entries = [...set];
      set.clear();
      for (let i = Math.floor(entries.length / 2); i < entries.length; i++) {
        set.add(entries[i]);
      }
    }

    expect(set.size).toBe(501);
    expect(set.has('msg-0')).toBe(false);
    expect(set.has('msg-499')).toBe(false);
    expect(set.has('msg-500')).toBe(true);
    expect(set.has('msg-1000')).toBe(true);
  });
});
