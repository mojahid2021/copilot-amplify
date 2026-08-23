/**
 * Small TTL cache with concurrent-request coalescing and an LRU bound.
 *
 * Used for model discovery: N simultaneous callers asking for the same key
 * trigger exactly one fetch.
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class CancelledDuringFetchError extends Error {
  constructor() {
    super('Fetch canceled');
    this.name = 'CancelledDuringFetchError';
  }
}

export class TTLCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(
    private readonly defaultTtlMs: number,
    private readonly maxEntries = 64,
  ) {}

  /**
   * Return the cached value when fresh; otherwise invoke `fetch` (coalescing
   * concurrent calls for the same key) and cache the result.
   */
  async getOrFetch(key: string, fetch: () => Promise<V>, ttlMs = this.defaultTtlMs): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && Date.now() < hit.expiresAt) {
      // Refresh LRU position.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.value;
    }

    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }

    const promise = fetch()
      .then((value) => {
        // Cache only when this promise is still the registered inflight fetch —
        // invalidateAll() during the fetch must not resurrect the old value.
        if (this.inflight.get(key) === promise) {
          this.set(key, value, ttlMs);
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) {
          this.inflight.delete(key);
        }
      });

    this.inflight.set(key, promise);
    return promise;
  }

  set(key: string, value: V, ttlMs = this.defaultTtlMs): void {
    // Evict oldest entry when at capacity (Map preserves insertion order).
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
  }

  /** Cached value if present and fresh; undefined otherwise. */
  peek(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (hit && Date.now() < hit.expiresAt) {
      return hit.value;
    }
    return undefined;
  }

  /** Cached value even when stale (stale-while-error fallbacks). */
  peekStale(key: string): V | undefined {
    return this.entries.get(key)?.value;
  }

  has(key: string): boolean {
    const hit = this.entries.get(key);
    return hit !== undefined && Date.now() < hit.expiresAt;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
    this.inflight.delete(key);
  }

  invalidateAll(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
