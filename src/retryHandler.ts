import * as vscode from 'vscode';
import { ApiError } from './baseApi';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

function createCancellationError(): Error {
  const err = new Error('Canceled');
  err.name = 'AbortError';
  return err;
}

export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  token?: vscode.CancellationToken,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  let delay = options.initialDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 10000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (token?.isCancellationRequested) {
      throw createCancellationError();
    }

    try {
      return await operation();
    } catch (error) {
      if (token?.isCancellationRequested) {
        throw createCancellationError();
      }

      const isRetryable =
        (error instanceof ApiError && RETRYABLE_STATUS_CODES.has(error.statusCode)) ||
        (error instanceof Error &&
          (error.message.includes('ECONNRESET') ||
            error.message.includes('ETIMEDOUT') ||
            error.message.includes('fetch failed') ||
            error.message.includes('ENOTFOUND')));

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      // Exponential backoff with full jitter (75% to 125% of current delay)
      const jitter = Math.random() * 0.5 + 0.75;
      const sleepTime = Math.min(maxDelay, Math.floor(delay * jitter));
      delay *= 2;

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, sleepTime);
        const disposable = token?.onCancellationRequested(() => {
          clearTimeout(timer);
          disposable?.dispose();
          reject(createCancellationError());
        });
      });
    }
  }

  throw new Error('Retry limits exceeded');
}
