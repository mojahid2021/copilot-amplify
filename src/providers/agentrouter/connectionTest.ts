/**
 * AgentRouter connection test.
 *
 * Validates the base URL and fetches `GET {baseUrl}/api/pricing` to
 * confirm credentials and to count chat-capable models. The pricing
 * endpoint is the only one the gateway exposes that requires
 * authentication but does not bill tokens, so it is the right shape for
 * a reachability probe.
 */

import { validateBaseUrl } from '../../core/url';
import { getAgentrouterConfig } from './config';
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
      message: `The server URL is not valid. ${validation.error ?? ''}`.trim(),
    };
  }

  const cfg = getAgentrouterConfig();
  const started = Date.now();

  try {
    const models = await fetchAgentrouterPricing({
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
      timeoutMs: cfg.discoveryTimeoutMs,
      fetchImpl: args.fetchImpl,
    });

    const latencyMs = Date.now() - started;
    if (models.size === 0) {
      return {
        ok: true,
        message: 'Connected, but the server lists no models yet',
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
      return { ok: false, message: `No response within ${cfg.discoveryTimeoutMs / 1000} seconds` };
    }
    // ApiError carries the status; pass it through for actionable feedback.
    const status = (error as { statusCode?: unknown }).statusCode;
    if (status === 401 || status === 403) {
      return {
        ok: false,
        message: 'Your API key was not accepted',
        httpStatus: typeof status === 'number' ? status : undefined,
      };
    }
    if (status === 404) {
      return {
        ok: false,
        message: 'The server has no /api/pricing endpoint. Check the AgentRouter URL in settings',
        httpStatus: 404,
      };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
