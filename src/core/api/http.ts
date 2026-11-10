import type * as vscode from 'vscode';
import { ApiError } from './client';

/**
 * Small fetch helpers shared by the hand-written HTTP clients (OmniRoute,
 * Anthropic, model discovery). The OpenAI SDK path does not need them.
 */

export interface RequestSignalOptions {
  timeoutMs: number;
  /** VS Code cancellation (the user pressed Stop). */
  token?: vscode.CancellationToken;
  /** An outer signal, e.g. the TTL cache aborting an in-flight discovery. */
  signal?: AbortSignal;
}

/**
 * One AbortSignal that fires on timeout, user cancellation or an outer
 * signal. Always call `dispose()` in a `finally`.
 *
 * Aborts with a plain `AbortError` (not `AbortSignal.timeout`'s
 * `TimeoutError`) because callers detect timeouts by that name.
 */
export function createRequestSignal(options: RequestSignalOptions): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort();

  const timer = setTimeout(abort, options.timeoutMs);
  timer.unref?.();
  const tokenListener = options.token?.onCancellationRequested(abort);
  if (options.signal?.aborted) {
    abort();
  } else {
    options.signal?.addEventListener('abort', abort, { once: true });
  }

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      tokenListener?.dispose();
      options.signal?.removeEventListener('abort', abort);
    },
  };
}

/**
 * Build an `ApiError` from a non-2xx response. Keeps the status, the parsed
 * body and the headers (the retry handler reads `Retry-After` from them).
 * Message format: `<label>: <status> <server message>`.
 */
export async function apiErrorFromResponse(response: Response, label: string): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const detail = errorMessageFromBody(body);
  return new ApiError(`${label}: ${response.status}${detail ? ` ${detail}` : ''}`, response.status, body, headers);
}

/** Pull a human-readable message out of `{ error: { message } }` or `{ message }`. */
export function errorMessageFromBody(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return '';
  }
  const nested = (body as { error?: { message?: unknown } }).error?.message;
  if (typeof nested === 'string') {
    return nested;
  }
  const flat = (body as { message?: unknown }).message;
  return typeof flat === 'string' ? flat : '';
}

/** Wrap anything that is not already an `ApiError` (network failures, bad JSON) as status 0. */
export function toApiError(error: unknown, label: string): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  return new ApiError(`${label}: ${error instanceof Error ? error.message : String(error)}`, 0);
}
