/**
 * Time-based cache for model discovery.
 *
 * - Concurrent `getOrFetch` calls for one key share a single fetch.
 * - `invalidateAll()` aborts in-flight fetches (their HTTP requests stop),
 *   and a fetch that finishes after invalidation is not cached.
 * - Expired values stay readable through `peekStale`, so the model picker
 *   keeps working when a refresh fails.
 */
export class TTLCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();
  private readonly inflight = new Map<string, { promise: Promise<V>; controller: AbortController }>();

  constructor(private readonly ttlMs: number) {}

  async getOrFetch(key: string, fetch: (signal: AbortSignal) => Promise<V>): Promise<V> {
    const fresh = this.peek(key);
    if (fresh !== undefined) {
      return fresh;
    }
    const pending = this.inflight.get(key);
    if (pending) {
      return pending.promise;
    }

    const controller = new AbortController();
    const promise = fetch(controller.signal)
      .then((value) => {
        // Still the current fetch? Then nothing invalidated the cache meanwhile.
        if (this.inflight.get(key)?.promise === promise) {
          this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key)?.promise === promise) {
          this.inflight.delete(key);
        }
      });
    this.inflight.set(key, { promise, controller });
    return promise;
  }

  /** The value, if present and not expired. */
  peek(key: string): V | undefined {
    const entry = this.entries.get(key);
    return entry && Date.now() < entry.expiresAt ? entry.value : undefined;
  }

  /** The value even when expired. */
  peekStale(key: string): V | undefined {
    return this.entries.get(key)?.value;
  }

  has(key: string): boolean {
    return this.peek(key) !== undefined;
  }

  invalidateAll(): void {
    this.entries.clear();
    for (const { controller } of this.inflight.values()) {
      controller.abort();
    }
    this.inflight.clear();
  }
}
