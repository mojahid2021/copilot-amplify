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
 * Resolve a possibly-custom endpoint against a base URL.
 *
 * - Empty override → `joinEndpoint(baseUrl, fallbackPath)`.
 * - Absolute http(s) URL → validated and used as-is (invalid input falls back).
 * - Otherwise treated as a path relative to `baseUrl` (leading `/` optional,
 *   duplicated slashes collapsed).
 */
export function resolveCustomEndpoint(
  baseUrl: string,
  custom: string | undefined,
  fallbackPath: string,
): string {
  const trimmed = (custom ?? '').trim();
  if (!trimmed) {
    return joinEndpoint(baseUrl, fallbackPath);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    // Absolute override — only accept well-formed, credential-free URLs.
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return joinEndpoint(baseUrl, fallbackPath);
      }
      if (url.username || url.password) {
        return joinEndpoint(baseUrl, fallbackPath);
      }
      return url.toString().replace(/\/$/, '');
    } catch {
      return joinEndpoint(baseUrl, fallbackPath);
    }
  }

  // Any other embedded scheme (e.g. `ftp://…`, `file://…`) is not accepted as
  // a relative path either — fall back rather than smuggling it into the URL.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return joinEndpoint(baseUrl, fallbackPath);
  }

  // Relative path: normalize separators so `chat/completions`,
  // `/chat/completions` and `//chat//completions` all behave identically.
  const path = `/${trimmed.replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
  return joinEndpoint(baseUrl, path);
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
