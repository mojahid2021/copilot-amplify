/**
 * URL utilities shared by every provider configuration.
 *
 * Guarantees:
 * - trailing slashes removed (`https://x.com/v1/` → `https://x.com/v1`)
 * - duplicated slashes inside paths collapsed (`//v1` → `/v1`)
 * - scheme restricted to http/https
 * - userinfo (`user:pass@host`) rejected outright
 */

export interface UrlValidation {
  ok: boolean;
  error?: string;
}

/**
 * Normalize a user-supplied base URL.
 * Returns the normalized URL, or the fallback when input is empty/invalid.
 */
export function normalizeBaseUrl(input: string | undefined, fallback: string): string {
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    return fallback;
  }
  const validation = validateBaseUrl(trimmed);
  if (!validation.ok) {
    return fallback;
  }

  const url = new URL(trimmed.toLowerCase().startsWith('http') ? trimmed : `https://${trimmed}`);
  let pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (pathname.length > 1) {
    pathname = pathname.replace(/\/+$/, '');
  }
  return `${url.protocol}//${url.host}${pathname === '/' ? '' : pathname}`;
}

/**
 * Validate a base URL without normalizing it.
 * Useful to surface precise InputBox errors.
 */
export function validateBaseUrl(input: string | undefined): UrlValidation {
  const trimmed = (input ?? '').trim();
  if (!trimmed) {
    return { ok: false, error: 'Base URL cannot be empty.' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Not a valid URL. Example: http://localhost:20128/v1 or https://omniroute.example.com/v1 (the /v1 path is required for OmniRoute).' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: `Unsupported protocol "${url.protocol}". Use http:// or https://.` };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'URLs with embedded credentials (user:pass@host) are not allowed.' };
  }
  if (!url.hostname) {
    return { ok: false, error: 'URL is missing a hostname.' };
  }
  return { ok: true };
}

/**
 * Join a normalized base URL and an endpoint path.
 * Prevents double slashes regardless of how either side is written.
 */
export function joinEndpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
