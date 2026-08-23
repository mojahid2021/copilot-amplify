import type * as vscode from 'vscode';
import { ApiError } from '../api/client';
import { NetworkError, RateLimitError, TimeoutError, ProviderUnavailableError, isCancellation } from '../errors';
import { CircuitOpenError } from '../resilience/circuitBreaker';

/**
 * Retry orchestration shared by every provider request path.
 *
 * - Exponential backoff with full jitter.
 * - Honors server-provided `Retry-After` (seconds or HTTP-date).
 * - Cancellation-aware: aborts waits instantly and never retries cancels.
 * - Never retries authentication/invalid-request/model-not-found errors.
 */

export interface RetryOptions {
  /** Retries AFTER the first attempt. Default 3. */
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Total wall-clock budget across all attempts. Unlimited when omitted. */
  budgetMs?: number;
}

/** Status codes worth retrying (transient failures). */
export const RETRYABLE_STATUS_CODES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

const NETWORK_ERROR_SNIPPETS = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'fetch failed', 'EAI_AGAIN'];

function createCancellationError(): Error {
  const err = new Error('Canceled');
  err.name = 'AbortError';
  return err;
}

/**
 * Decide whether a thrown error should trigger another attempt.
 * Exported for direct unit testing.
 */
export function isRetryableError(error: unknown): boolean {
  if (isCancellation(error)) {
    return false;
  }
  // An open circuit will refuse every retry until its cooldown elapses;
  // sleeping through the backoff schedule would only delay the user's error.
  if (error instanceof CircuitOpenError) {
    return false;
  }
  if (error instanceof ApiError) {
    return RETRYABLE_STATUS_CODES.has(error.statusCode);
  }
  if (error instanceof RateLimitError || error instanceof TimeoutError || error instanceof NetworkError || error instanceof ProviderUnavailableError) {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message;
    return NETWORK_ERROR_SNIPPETS.some((snippet) => message.includes(snippet));
  }
  return false;
}

/**
 * Extract a delay hint from an error carrying response headers
 * (`Retry-After`: delta-seconds or HTTP-date). Returns undefined when absent,
 * unparsable, or unreasonably large (>30 s cap).
 */
export function extractRetryAfterMs(error: unknown): number | undefined {
  const headers = (error as { headers?: Record<string, string> }).headers;
  if (!headers) {
    return undefined;
  }
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  if (!raw) {
    return undefined;
  }

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    const ms = seconds * 1000;
    return ms <= 30_000 ? ms : undefined;
  }

  const date = Date.parse(raw);
  if (!Number.isNaN(date)) {
    const ms = date - Date.now();
    return ms > 0 && ms <= 30_000 ? ms : undefined;
  }
  return undefined;
}

function sleep(ms: number, token?: vscode.CancellationToken): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Both callbacks only ever fire after this executor completes, so both
    // bindings are guaranteed to be initialized by the time they run.
    const timer = setTimeout(() => {
      cancelDisposable.dispose();
      resolve();
    }, ms);
    const cancelDisposable =
      token?.onCancellationRequested(() => {
        clearTimeout(timer);
        reject(createCancellationError());
      }) ?? { dispose: () => {} };
  });
}

/**
 * Execute `operation` with retry + backoff.
 * The final attempt's error is rethrown unchanged.
 */
export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  token?: vscode.CancellationToken,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelay = options.initialDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 10000;
  const deadline = options.budgetMs !== undefined ? Date.now() + options.budgetMs : undefined;

  let delay = initialDelay;

  for (let attempt = 0; ; attempt++) {
    if (token?.isCancellationRequested) {
      throw createCancellationError();
    }

    try {
      return await operation();
    } catch (error) {
      if (token?.isCancellationRequested || isCancellation(error)) {
        throw createCancellationError();
      }
      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw error;
      }
      if (deadline !== undefined && Date.now() + delay >= deadline) {
        throw error;
      }

      const retryAfterMs = extractRetryAfterMs(error);
      const backoff = Math.min(maxDelay, delay);
      // Full jitter: uniform between 50% and 100% of the computed backoff.
      const jittered = Math.floor(backoff * (0.5 + Math.random() * 0.5));
      const waitMs = retryAfterMs !== undefined ? Math.max(retryAfterMs, jittered) : jittered;
      delay *= 2;

      await sleep(waitMs, token);
      // Re-check after sleeping: cancellation may have arrived during the wait.
      if (token?.isCancellationRequested) {
        throw createCancellationError();
      }
    }
  }
}
