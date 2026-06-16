import { describe, it, expect } from 'vitest';
import { pruneSetIfNeeded } from './prune-set';

describe('pruneSetIfNeeded', () => {
  it('does nothing when set is under maxSize', () => {
    const set = new Set(['a', 'b', 'c']);
    pruneSetIfNeeded(set, 5);
    expect(set.size).toBe(3);
  });

  it('prunes oldest half when exceeding maxSize', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1001; i++) set.add('msg-' + i);
    pruneSetIfNeeded(set, 1000);
    expect(set.size).toBe(501);
    expect(set.has('msg-0')).toBe(false);
    expect(set.has('msg-499')).toBe(false);
    expect(set.has('msg-500')).toBe(true);
    expect(set.has('msg-1000')).toBe(true);
  });

  it('works at exact boundary', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add('msg-' + i);
    pruneSetIfNeeded(set, 1000);
    expect(set.size).toBe(1000); // no pruning at boundary
  });
});
