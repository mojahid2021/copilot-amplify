import { logger } from '../logging/logger';
import { ProviderUnavailableError } from '../errors';

/**
 * Rejected because the circuit is open (or its half-open probe slot is
 * taken). Subtypes {@link ProviderUnavailableError} so existing handlers keep
 * working, but carries a distinct identity so the retry layer can avoid
 * burning its backoff budget against a breaker that will keep refusing.
 */
export class CircuitOpenError extends ProviderUnavailableError {}

/**
 * Lightweight per-provider circuit breaker.
 *
 * States: closed (normal) → open (failing fast) → half-open (probe allowed).
 * Deliberately conservative: only consecutive failures count, one success in
 * half-open closes the circuit, and the feature can be disabled entirely via
 * settings.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures before opening. Default 5. */
  failureThreshold?: number;
  /** Time in `open` before a single probe is allowed. Default 30_000 ms. */
  resetTimeoutMs?: number;
  /** Human-readable name used in logs. */
  name?: string;
  /** When false the breaker passes everything through. Default true. */
  enabled?: boolean;
}

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_RESET_TIMEOUT_MS = 30_000;
/** Floor low enough for fast tests; real configs use seconds. */
const MIN_RESET_TIMEOUT_MS = 5;

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private probeInFlight = false;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly enabled: boolean;
  private readonly log: ReturnType<typeof logger.child>;

  constructor(private readonly name?: string, options: CircuitBreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD);
    this.resetTimeoutMs = Math.max(MIN_RESET_TIMEOUT_MS, options.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS);
    this.enabled = options.enabled ?? true;
    this.log = logger.child({ component: 'breaker', ...(name ? { breaker: name } : {}) });
  }

  get currentState(): CircuitState {
    if (!this.enabled) {
      return 'closed';
    }
    if (this.state === 'open' && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      return 'half-open';
    }
    return this.state;
  }

  /**
   * Run `operation` under breaker protection.
   * Throws ProviderUnavailableError immediately while open.
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.enabled) {
      return operation();
    }

    const state = this.currentState;
    if (state === 'open') {
      throw new CircuitOpenError(
        `${this.name ?? 'provider'} is temporarily unavailable (circuit open). Retry shortly.`,
      );
    }
    if (state === 'half-open') {
      if (this.probeInFlight) {
        throw new CircuitOpenError(
          `${this.name ?? 'provider'} is recovering; probe already in flight.`,
        );
      }
      this.probeInFlight = true;
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    } finally {
      this.probeInFlight = false;
    }
  }

  recordSuccess(): void {
    if (!this.enabled) {
      return;
    }
    if (this.state !== 'closed') {
      this.log.info(`circuit closed after recovery (${this.name ?? ''})`);
    }
    this.state = 'closed';
    this.consecutiveFailures = 0;
  }

  recordFailure(): void {
    if (!this.enabled) {
      return;
    }
    if (this.currentState === 'half-open') {
      this.trip();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold && this.state === 'closed') {
      this.trip();
    }
  }

  /** Force reset (used by reset-configuration commands and disposal paths). */
  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.probeInFlight = false;
  }

  private trip(): void {
    this.state = 'open';
    this.openedAt = Date.now();
    this.log.warn(`circuit opened after ${this.consecutiveFailures} failure(s) (${this.name ?? ''})`);
  }
}
