/**
 * True when an error means "the request was cancelled" (VS Code Stop button
 * or an AbortController), as opposed to a real failure.
 */
export function isCancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CancelledError');
}
