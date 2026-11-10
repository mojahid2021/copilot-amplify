import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/core/api/client';
import { isRetryableError } from '../src/core/retry/retryHandler';

describe('isRetryableError', () => {
  it('retries connection failures (no HTTP status)', () => {
    expect(isRetryableError(new ApiError('Connection error.', 0))).toBe(true);
  });
  it('retries 429/503 but not 400/401', () => {
    expect(isRetryableError(new ApiError('x', 429))).toBe(true);
    expect(isRetryableError(new ApiError('x', 503))).toBe(true);
    expect(isRetryableError(new ApiError('x', 400))).toBe(false);
    expect(isRetryableError(new ApiError('x', 401))).toBe(false);
  });
});
