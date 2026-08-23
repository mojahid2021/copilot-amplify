/**
 * Normalization of OmniRoute response telemetry headers into a typed record.
 *
 * Only an explicit allowlist of `x-omniroute-*` headers is read — arbitrary
 * header dumping is never logged.
 */

export interface OmnirouteTelemetry {
  model?: string;
  provider?: string;
  routeDecision?: string;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: string;
  cacheHit?: boolean;
  cacheState?: string;
  costSavedUsd?: string;
  compression?: string;
  sessionId?: string;
  version?: string;
  requestId?: string;
  routeClass?: string;
}

type HeaderGetter = (name: string) => string;

const ZERO_COST = '0.0000000000';

function optionalNumber(value: string): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && value !== '' ? n : undefined;
}

/** Extract the telemetry record from a response-headers getter. */
export function parseOmnirouteTelemetry(get: HeaderGetter, requestModel: string): OmnirouteTelemetry {
  const cacheHit = get('x-omniroute-cache-hit') === 'true';
  const cost = get('x-omniroute-response-cost');
  const costSaved = get('x-omniroute-cost-saved');

  return {
    model: get('x-omniroute-model') || requestModel,
    provider: get('x-omniroute-provider') || undefined,
    routeDecision: get('x-omniroute-decision') || undefined,
    latencyMs: optionalNumber(get('x-omniroute-latency-ms')),
    tokensIn: optionalNumber(get('x-omniroute-tokens-in')),
    tokensOut: optionalNumber(get('x-omniroute-tokens-out')),
    costUsd: cost && cost !== ZERO_COST ? cost : undefined,
    cacheHit,
    cacheState: get('x-omniroute-cache') || undefined,
    costSavedUsd: cacheHit && costSaved && costSaved !== ZERO_COST ? costSaved : undefined,
    compression: get('x-omniroute-compression') || undefined,
    sessionId: get('x-omniroute-session-id') || undefined,
    version: get('x-omniroute-version') || undefined,
    requestId: get('x-omniroute-request-id') || get('x-request-id') || undefined,
    routeClass: get('x-omniroute-route-class') || undefined,
  };
}

/** Render one compact log line (stable shape, telemetry-only values). */
export function formatOmnirouteTelemetry(t: OmnirouteTelemetry): string {
  const parts: string[] = [`model=${t.model ?? '?'}`];
  if (t.provider) { parts.push(`provider=${t.provider}`); }
  if (t.routeDecision) { parts.push(`route=${t.routeDecision}`); }
  if (t.latencyMs !== undefined) { parts.push(`latency_ms=${t.latencyMs}`); }
  if (t.tokensIn !== undefined || t.tokensOut !== undefined) {
    parts.push(`tokens_in=${t.tokensIn ?? 0}`, `tokens_out=${t.tokensOut ?? 0}`);
  }
  if (t.costUsd) { parts.push(`cost_usd=${t.costUsd}`); }
  if (t.cacheState) { parts.push(`cache=${t.cacheState}`); }
  if (t.cacheHit) {
    parts.push('cache_hit=true');
    if (t.costSavedUsd) { parts.push(`cost_saved_usd=${t.costSavedUsd}`); }
  }
  if (t.compression) { parts.push(`compression=${t.compression}`); }
  if (t.sessionId) { parts.push(`session=${t.sessionId}`); }
  if (t.version) { parts.push(`version=${t.version}`); }
  if (t.requestId) { parts.push(`request_id=${t.requestId}`); }
  if (t.routeClass) { parts.push(`route_class=${t.routeClass}`); }
  return parts.join(' | ');
}
