/**
 * Small TTL cache with concurrent-request coalescing, an LRU bound, and
 * cooperative fetch cancellation.
 *
 * Used for model discovery: N simultaneous callers asking for the same key
 * trigger exactly one fetch, and a later `invalidateAll()` (e.g. on settings
 * change) cancels the still-running fetch so the underlying HTTP request is
 * aborted instead of leaking.
 */

interface Entry<V> {
  value: V;
  expiresAt: number;
}

interface InflightEntry {
  controller: AbortController;
  promise: Promise<unknown>;
}

/**
 * Type guard distinguishing a raw cached value `V` from a pre-built
 * `Entry<V>`. We use the presence of both `value` and `expiresAt` numeric
 * fields as the signal — false positives are impossible for primitives
 * (numbers/strings) and unlikely for object payloads that legitimately
 * contain a numeric `expiresAt` field, in which case callers should pass
 * the value through a `getOrFetch` rather than `set` directly.
 */
function isEntry<V>(value: unknown): value is Entry<V> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const v = value as { value?: unknown; expiresAt?: unknown };
  return 'value' in value && 'expiresAt' in value && typeof v.expiresAt === 'number';
}

export class CancelledDuringFetchError extends Error {
  constructor() {
    super('Fetch canceled');
    this.name = 'CancelledDuringFetchError';
  }
}

export class TTLCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inflight = new Map<string, InflightEntry>();

  constructor(
    private readonly defaultTtlMs: number,
    private readonly maxEntries = 64,
  ) {}

  /**
   * Return the cached value when fresh; otherwise invoke `fetch` (coalescing
   * concurrent calls for the same key) and cache the result. When `signal` is
   * already aborted, the call rejects immediately and no fetch is started.
   */
  async getOrFetch(
    key: string,
    fetch: (signal: AbortSignal) => Promise<V>,
    ttlMs = this.defaultTtlMs,
    signal?: AbortSignal,
  ): Promise<V> {
    if (signal?.aborted) {
      throw new CancelledDuringFetchError();
    }
    const hit = this.entries.get(key);
    if (hit && Date.now() < hit.expiresAt) {
      // Refresh LRU position by re-inserting (JS Map keeps insertion order
      // but does not move existing keys, so delete + set is canonical).
      // Callers go through {@link set} which preserves the entry shape.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.value;
    }

    const pending = this.inflight.get(key);
    if (pending) {
      // If the existing fetch is already aborted, surface the cancel; otherwise
      // attach our signal so a later abort of either party cancels the fetch.
      return pending.promise as Promise<V>;
    }

    const controller = new AbortController();
    // Forward the caller's signal into the shared controller.
    const onCallerAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }

    const promise = fetch(controller.signal)
      .then((value) => {
        // Cache only when this promise is still the registered inflight fetch —
        // invalidateAll() during the fetch must not resurrect the old value.
        if (this.inflight.get(key)?.promise === promise) {
          this.set(key, value, ttlMs);
        }
        return value;
      })
      .finally(() => {
        signal?.removeEventListener('abort', onCallerAbort);
        if (this.inflight.get(key)?.promise === promise) {
          this.inflight.delete(key);
        }
      });

    this.inflight.set(key, { controller, promise });
    return promise;
  }

  /**
   * Insert or replace a cache entry. Accepts either a raw value `V` (the
   * public API) or a pre-built `Entry<V>` (used internally by
   * {@link getOrFetch} to refresh LRU without double-wrapping).
   */
  set(key: string, value: V | Entry<V>, ttlMs = this.defaultTtlMs): void {
    // Evict oldest entry when at capacity (Map preserves insertion order).
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }
    this.entries.delete(key);
    if (isEntry(value)) {
      // Re-insert the existing entry unchanged; preserves `expiresAt`.
      this.entries.set(key, value);
      return;
    }
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
    const inflight = this.inflight.get(key);
    if (inflight) {
      inflight.controller.abort();
      this.inflight.delete(key);
    }
  }

  /**
   * Drop all cached values AND cancel every still-running fetch so its
   * underlying HTTP request is aborted. Subsequent calls for the same key
   * will start a fresh fetch.
   */
  invalidateAll(): void {
    this.entries.clear();
    for (const entry of this.inflight.values()) {
      entry.controller.abort();
    }
    this.inflight.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
