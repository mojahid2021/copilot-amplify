import { validateBaseUrl, joinEndpoint } from '../../core/url';
import { getOmnirouteConfig } from './config';
import { mapOmnirouteModelsResponse } from './models';
import type { OmnirouteModelsResponse } from './models';
import type { ConnectionTestResult } from '../../core/provider/registry';

/**
 * Lightweight OmniRoute connection test.
 *
 * Validates the Base URL, performs `GET {base}/models` with the configured
 * key (or anonymously), measures latency and reports the chat-model count.
 * Never echoes credentials.
 */

export interface ConnectionTestArgs {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export async function testOmnirouteConnection(args: ConnectionTestArgs): Promise<ConnectionTestResult> {
  const validation = validateBaseUrl(args.baseUrl);
  if (!validation.ok) {
    return {
      ok: false,
      message: `Invalid Base URL — ${validation.error ?? 'malformed URL'}`,
    };
  }

  const cfg = getOmnirouteConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.discoveryTimeoutMs);
  // Don't keep the process alive on shutdown while the probe is pending.
  timer.unref?.();
  const started = Date.now();

  try {
    const endpoint = joinEndpoint(args.baseUrl, '/models');
    const headers: Record<string, string> = {};
    const key = args.apiKey?.trim();
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    const response = await (args.fetchImpl ?? fetch)(endpoint, {
      headers,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;

    if (!response.ok) {
      const reason =
        response.status === 401 || response.status === 403
          ? 'Authentication failed'
          : response.status === 404
            ? 'Models endpoint not found — check the Base URL includes the correct path'
            : `Server returned HTTP ${response.status}`;
      return { ok: false, message: reason, httpStatus: response.status, latencyMs };
    }

    let json: OmnirouteModelsResponse;
    try {
      json = (await response.json()) as OmnirouteModelsResponse;
    } catch {
      return {
        ok: false,
        message: 'Response was not valid JSON — is this an OmniRoute server?',
        httpStatus: response.status,
        latencyMs,
      };
    }

    const models = mapOmnirouteModelsResponse(json);
    if (models.length === 0) {
      return {
        ok: false,
        message: 'Connected, but no chat-capable models are available',
        httpStatus: response.status,
        latencyMs,
      };
    }

    return { ok: true, message: 'Connected', latencyMs, modelCount: models.length };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, message: `Timed out after ${cfg.discoveryTimeoutMs} ms` };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
