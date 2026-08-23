import { ApiError } from '../api/client';

/**
 * Classification of upstream availability failures.
 *
 * Some gateways (notably OmniRoute in front of saturated upstream queues)
 * answer with HTTP 503 and a body that distinguishes *why* the request was
 * refused. Treating every 503 as identical hides that signal; this classifier
 * recovers it so diagnostics and user-facing errors become actionable.
 */
export type AvailabilityCategory =
  /** The provider's queue is full — backoff is expected to help shortly. */
  | 'saturated'
  | 'rate-limited'
  | 'maintenance'
  /** Generic 5xx unavailability with no more specific signal. */
  | 'unavailable';

const SATURATION_PATTERN = /overload|overload(ed)?|queue|saturat|capacity|busy|too many concurrent|concurrency/i;
const MAINTENANCE_PATTERN = /maintenance|temporarily (down|offline)|under maintenance/i;
const RATE_LIMIT_PATTERN = /rate limit|quota|throttl/i;

/** Status codes whose bodies are inspected for availability signals. */
const AVAILABILITY_STATUSES: ReadonlySet<number> = new Set([503, 529]);

function extractBodyText(response: unknown): string {
  if (typeof response === 'string') {
    return response;
  }
  if (response && typeof response === 'object') {
    try {
      return JSON.stringify(response);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Classify an availability failure from its status code and response body.
 * Returns `undefined` when the error does not describe an availability
 * problem (i.e. anything other than 503/529).
 */
export function classifyAvailability(error: unknown): AvailabilityCategory | undefined {
  if (!(error instanceof ApiError)) {
    return undefined;
  }
  if (!AVAILABILITY_STATUSES.has(error.statusCode)) {
    return undefined;
  }

  const haystack = `${extractBodyText(error.response)} ${error.message}`;
  // Order matters: a "queue saturated during maintenance" reads as maintenance.
  if (MAINTENANCE_PATTERN.test(haystack)) {
    return 'maintenance';
  }
  if (SATURATION_PATTERN.test(haystack)) {
    return 'saturated';
  }
  if (RATE_LIMIT_PATTERN.test(haystack)) {
    return 'rate-limited';
  }
  return 'unavailable';
}

/** Actionable, credential-free hints appended to user-facing 503/529 errors. */
export const AVAILABILITY_HINTS: Readonly<Record<AvailabilityCategory, string>> = {
  saturated:
    'The upstream queue is saturated — the server reported overload. Requests back off automatically; try again in a moment.',
  'rate-limited':
    'The provider reports rate limiting or exhausted quota on this endpoint.',
  maintenance: 'The provider appears to be under scheduled maintenance.',
  unavailable: 'The provider is temporarily unavailable.',
};
