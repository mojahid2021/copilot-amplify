import { describe, expect, it, vi } from 'vitest';
import { TTLCache } from '../src/core/resilience/cache';

describe('TTLCache', () => {
  it('coalesces concurrent fetches and serves the fresh value afterwards', async () => {
    const cache = new TTLCache<number>(60_000);
    const fetch = vi.fn(async () => 42);
    expect(await Promise.all([cache.getOrFetch('k', fetch), cache.getOrFetch('k', fetch)])).toEqual([42, 42]);
    expect(await cache.getOrFetch('k', fetch)).toBe(42);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.has('k')).toBe(true);
    expect(cache.peek('k')).toBe(42);
  });

  it('keeps stale values for peekStale but not peek/has', async () => {
    vi.useFakeTimers();
    const cache = new TTLCache<number>(1_000);
    await cache.getOrFetch('k', async () => 1);
    vi.advanceTimersByTime(1_001);
    expect(cache.has('k')).toBe(false);
    expect(cache.peek('k')).toBeUndefined();
    expect(cache.peekStale('k')).toBe(1);
    vi.useRealTimers();
  });

  it('invalidateAll aborts an in-flight fetch and does not cache its late result', async () => {
    const cache = new TTLCache<number>(60_000);
    let signal: AbortSignal | undefined;
    let resolve!: (v: number) => void;
    const pending = cache.getOrFetch('k', (s) => {
      signal = s;
      return new Promise<number>((r) => { resolve = r; });
    });
    cache.invalidateAll();
    expect(signal?.aborted).toBe(true);
    resolve(7);
    await pending;
    expect(cache.peekStale('k')).toBeUndefined();

    const fetch = vi.fn(async () => 8);
    expect(await cache.getOrFetch('k', fetch)).toBe(8);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures', async () => {
    const cache = new TTLCache<number>(60_000);
    await expect(cache.getOrFetch('k', async () => { throw new Error('down'); })).rejects.toThrow('down');
    expect(await cache.getOrFetch('k', async () => 3)).toBe(3);
  });
});
