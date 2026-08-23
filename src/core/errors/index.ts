/**
 * Normalized provider error taxonomy.
 *
 * All provider-specific failures are mapped into this hierarchy so callers
 * (retry, UI, diagnostics) can make decisions without knowing vendor details.
 */

export class ProviderError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, options?: { statusCode?: number; cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.statusCode = options?.statusCode;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class AuthenticationError extends ProviderError {}
export class RateLimitError extends ProviderError {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
    options?: { statusCode?: number },
  ) {
    super(message, { statusCode: options?.statusCode ?? 429 });
  }
}
export class InvalidRequestError extends ProviderError {}
export class NetworkError extends ProviderError {}
export class TimeoutError extends ProviderError {}
export class ModelNotFoundError extends ProviderError {}
export class ProviderUnavailableError extends ProviderError {}
export class StreamError extends ProviderError {}
export class CancelledError extends ProviderError {}

/** True when the error represents user/host-initiated cancellation. */
export function isCancellation(error: unknown): boolean {
  return (
    error instanceof CancelledError ||
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'CancelledError')
  );
}

/**
 * Map an HTTP status code to the canonical error type.
 * Unknown statuses fall back to ProviderUnavailableError for 5xx and
 * InvalidRequestError otherwise.
 */
export function fromHttpStatus(status: number, message?: string): ProviderError {
  const msg = message ?? `HTTP ${status}`;
  switch (status) {
    case 400:
      return new InvalidRequestError(msg, { statusCode: status });
    case 401:
    case 403:
      return new AuthenticationError(msg, { statusCode: status });
    case 404:
      return new ModelNotFoundError(msg, { statusCode: status });
    case 408:
      return new TimeoutError(msg, { statusCode: status });
    case 429:
      return new RateLimitError(msg);
    default:
      if (status >= 500) {
        return new ProviderUnavailableError(msg, { statusCode: status });
      }
      return new InvalidRequestError(msg, { statusCode: status });
  }
}

/**
 * Best-effort normalization of arbitrary thrown values.
 * Recognizes: CancelledError/AbortError, network-layer TypeErrors,
 * errors carrying numeric `statusCode` (ApiError/OpenAI.APIError),
 * and plain Errors.
 */
export function normalizeError(error: unknown, provider = 'provider'): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  if (isCancellation(error)) {
    return new CancelledError('Request canceled');
  }
  if (error instanceof Error) {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status > 0) {
      return fromHttpStatus(status, `${provider} API error: ${status} ${error.message}`);
    }
    const msg = error.message.toLowerCase();
    if (
      msg.includes('econnreset') ||
      msg.includes('enotfound') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('eai_again') ||
      msg.includes('fetch failed') ||
      msg.includes('network')
    ) {
      return new NetworkError(`${provider}: ${error.message}`, { cause: error });
    }
    return new ProviderError(`${provider}: ${error.message}`, { cause: error });
  }
  return new ProviderError(`${provider}: ${String(error)}`);
}
