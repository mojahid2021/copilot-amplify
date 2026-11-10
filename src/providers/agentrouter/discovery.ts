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

import { joinEndpoint } from '../../core/url';
import { apiErrorFromResponse, createRequestSignal } from '../../core/api/http';
import { getAgentrouterConfig } from './config';

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
  return {
    id: raw.model_name.trim(),
    supportedEndpointTypes: normalizeEndpointTypes(raw.supported_endpoint_types),
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
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * `GET {baseUrl}/api/pricing` as a model map keyed by id.
 * Throws `ApiError` on non-2xx responses (status and headers preserved).
 */
export async function fetchAgentrouterPricing(
  args: FetchAgentrouterPricingArgs,
): Promise<Map<string, DiscoveredAgentrouterModel>> {
  const request = createRequestSignal(args);
  try {
    const key = args.apiKey?.trim();
    const response = await (args.fetchImpl ?? fetch)(joinEndpoint(args.baseUrl, '/api/pricing'), {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      signal: request.signal,
    });
    if (!response.ok) {
      throw await apiErrorFromResponse(response, 'AgentRouter pricing endpoint error');
    }
    return mapAgentrouterPricingResponse((await response.json()) as AgentrouterPricingResponse);
  } finally {
    request.dispose();
  }
}

/** {@link fetchAgentrouterPricing} against the configured base URL and timeout. */
export function fetchAgentrouterPricingFromConfig(args: {
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<Map<string, DiscoveredAgentrouterModel>> {
  const cfg = getAgentrouterConfig();
  return fetchAgentrouterPricing({ ...args, baseUrl: cfg.baseUrl, timeoutMs: cfg.discoveryTimeoutMs });
}
