/**
 * AgentRouter catalog discovery.
 *
 * Fetches `GET {baseUrl}/api/pricing` and parses the response into a
 * per-model map keyed by upstream id. The pricing endpoint is preferred
 * over `/v1/models` because it advertises `supported_endpoint_types`
 * (`anthropic` / `openai`) per model — exactly the routing metadata the
 * dual-transport provider needs.
 *
 * The HTTP fetch is kept separate from the provider class so it can be
 * unit-tested with an injected `fetch` implementation and called without
 * instantiating a `BaseChatProvider`.
 */

import * as vscode from 'vscode';
import { joinEndpoint } from '../../core/url';
import { ApiError } from '../../core/api/client';
import { logger } from '../../core/logging/logger';
import { getAgentrouterConfig, getAgentrouterDiscoveryBaseUrl } from './config';
import { AGENTROUTER_DISPLAY_NAME } from './descriptor';

const log = logger.child({ provider: AGENTROUTER_DISPLAY_NAME });

/** Endpoint protocols AgentRouter advertises for a model. */
export type AgentrouterEndpointType = 'anthropic' | 'openai';

export interface AgentrouterModelRaw {
  model_name?: unknown;
  quota_type?: unknown;
  model_ratio?: unknown;
  model_price?: unknown;
  owner_by?: unknown;
  completion_ratio?: unknown;
  enable_groups?: unknown;
  supported_endpoint_types?: unknown;
}

export interface AgentrouterPricingResponse {
  data?: AgentrouterModelRaw[];
}

export interface DiscoveredAgentrouterModel {
  /** Upstream id (e.g. `claude-opus-4-8`, `gpt-5.5`). */
  id: string;
  /** Endpoint types AgentRouter advertises for this model. */
  supportedEndpointTypes: AgentrouterEndpointType[];
  /** Pricing ratio for input tokens (informational; reserved for future use). */
  modelRatio?: number;
  /** Pricing ratio for output tokens (informational). */
  completionRatio?: number;
}

const MAX_ENTRIES = 512;

/** Type guard for the endpoint-types array we expect from the server. */
function normalizeEndpointTypes(value: unknown): AgentrouterEndpointType[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: AgentrouterEndpointType[] = [];
  for (const entry of value) {
    if (entry === 'anthropic' || entry === 'openai') {
      if (!out.includes(entry)) {
        out.push(entry);
      }
    }
  }
  return out;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Map a single raw pricing entry into a normalized discovered model.
 * Returns `undefined` for entries that lack a usable `model_name`.
 */
export function mapAgentrouterModel(
  raw: AgentrouterModelRaw,
): DiscoveredAgentrouterModel | undefined {
  if (!raw || typeof raw.model_name !== 'string' || raw.model_name.trim().length === 0) {
    return undefined;
  }
  const id = raw.model_name.trim();
  const modelRatio = toFiniteNumber(raw.model_ratio);
  const completionRatio = toFiniteNumber(raw.completion_ratio);
  const types = normalizeEndpointTypes(raw.supported_endpoint_types);
  return {
    id,
    supportedEndpointTypes: types,
    ...(modelRatio !== undefined ? { modelRatio } : {}),
    ...(completionRatio !== undefined ? { completionRatio } : {}),
  };
}

/**
 * Filter + map a raw `/api/pricing` payload into a `Map<id, model>`.
 * Returns an empty map when the payload is malformed.
 */
export function mapAgentrouterPricingResponse(
  json: AgentrouterPricingResponse,
): Map<string, DiscoveredAgentrouterModel> {
  const out = new Map<string, DiscoveredAgentrouterModel>();
  if (!Array.isArray(json.data)) {
    return out;
  }
  for (const raw of json.data) {
    const mapped = mapAgentrouterModel(raw);
    if (!mapped) {
      continue;
    }
    // Cap the catalog size so a misbehaving server can't grow it indefinitely.
    if (!out.has(mapped.id) && out.size >= MAX_ENTRIES) {
      const oldest = out.keys().next();
      if (!oldest.done) {
        out.delete(oldest.value);
      }
    }
    out.set(mapped.id, mapped);
  }
  return out;
}

export interface FetchAgentrouterPricingArgs {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  token?: vscode.CancellationToken;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * Low-level `GET {baseUrl}/api/pricing` returning a normalized model map.
 * Throws `ApiError` on non-2xx responses (status preserved). Headers
 * (notably `Retry-After`) are captured for the caller.
 */
export async function fetchAgentrouterPricing(
  args: FetchAgentrouterPricingArgs,
): Promise<Map<string, DiscoveredAgentrouterModel>> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), args.timeoutMs);
  timeout.unref?.();
  const cancellationDisposable = args.token?.onCancellationRequested(() => abortController.abort());
  const onExternalAbort = () => abortController.abort();
  if (args.signal) {
    if (args.signal.aborted) {
      abortController.abort();
    } else {
      args.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    const endpoint = joinEndpoint(args.baseUrl, '/api/pricing');
    const headers: Record<string, string> = {};
    const key = args.apiKey && args.apiKey.trim().length > 0 ? args.apiKey.trim() : '';
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }

    const response = await (args.fetchImpl ?? fetch)(endpoint, {
      headers,
      signal: abortController.signal,
    });

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });
      throw new ApiError(
        `AgentRouter pricing endpoint returned HTTP ${response.status}`,
        response.status,
        body,
        responseHeaders,
      );
    }

    const json = (await response.json()) as AgentrouterPricingResponse;
    return mapAgentrouterPricingResponse(json);
  } finally {
    clearTimeout(timeout);
    args.signal?.removeEventListener('abort', onExternalAbort);
    cancellationDisposable?.dispose();
  }
}

/**
 * Convenience wrapper that reads the active configuration and calls
 * {@link fetchAgentrouterPricing}. Used by the provider class so the
 * request semantics are uniform with the rest of the codebase.
 */
export async function fetchAgentrouterPricingFromConfig(args: {
  apiKey?: string;
  token?: vscode.CancellationToken;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<Map<string, DiscoveredAgentrouterModel>> {
  const cfg = getAgentrouterConfig();
  return fetchAgentrouterPricing({
    baseUrl: getAgentrouterDiscoveryBaseUrl(),
    ...(args.apiKey ? { apiKey: args.apiKey } : {}),
    timeoutMs: cfg.discoveryTimeoutMs,
    ...(args.token ? { token: args.token } : {}),
    ...(args.signal ? { signal: args.signal } : {}),
    ...(args.fetchImpl ? { fetchImpl: args.fetchImpl } : {}),
  }).catch((error) => {
    log.warn('pricing fetch failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  });
}
