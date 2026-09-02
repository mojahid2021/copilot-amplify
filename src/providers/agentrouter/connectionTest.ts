/**
 * AgentRouter connection test.
 *
 * Validates the base URL and fetches `GET {baseUrl}/api/pricing` to
 * confirm credentials and to count chat-capable models. The pricing
 * endpoint is the only one the gateway exposes that requires
 * authentication but does not bill tokens, so it is the right shape for
 * a reachability probe.
 */

import { joinEndpoint, validateBaseUrl } from '../../core/url';
import { getAgentrouterConfig, getAgentrouterDiscoveryBaseUrl } from './config';
import { fetchAgentrouterPricing } from './discovery';
import type { ConnectionTestResult } from '../../core/provider/registry';

export interface ConnectionTestArgs {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export async function testAgentrouterConnection(
  args: ConnectionTestArgs,
): Promise<ConnectionTestResult> {
  const validation = validateBaseUrl(args.baseUrl);
  if (!validation.ok) {
    return {
      ok: false,
      message: `Invalid Base URL — ${validation.error ?? 'malformed URL'}`,
    };
  }

  const cfg = getAgentrouterConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.discoveryTimeoutMs);
  timer.unref?.();
  const started = Date.now();

  try {
    const models = await fetchAgentrouterPricing({
      baseUrl: joinEndpoint(args.baseUrl, ''),
      ...(args.apiKey && args.apiKey.trim().length > 0 ? { apiKey: args.apiKey.trim() } : {}),
      timeoutMs: cfg.discoveryTimeoutMs,
      fetchImpl: args.fetchImpl,
    }).catch((error): Map<string, never> => {
      // Translate the fetch error into a ConnectionTestResult-friendly throw so the
      // outer catch below produces a consistent user-facing message.
      throw error;
    });

    const latencyMs = Date.now() - started;
    if (models.size === 0) {
      return {
        ok: true,
        message: 'Connected, but no models are available yet',
        latencyMs,
      };
    }
    return {
      ok: true,
      message: 'Connected',
      latencyMs,
      modelCount: models.size,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, message: `Timed out after ${cfg.discoveryTimeoutMs} ms` };
    }
    // ApiError carries the status; pass it through for actionable feedback.
    const status = (error as { statusCode?: unknown }).statusCode;
    if (status === 401 || status === 403) {
      return {
        ok: false,
        message: 'Authentication failed',
        httpStatus: typeof status === 'number' ? status : undefined,
      };
    }
    if (status === 404) {
      return {
        ok: false,
        message: 'Pricing endpoint not found — check the Base URL includes the correct path',
        httpStatus: 404,
      };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Re-export so callers don't need a second import path. */
export { getAgentrouterDiscoveryBaseUrl };
