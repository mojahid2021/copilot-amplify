import { getOmnirouteConfig } from './config';
import type { CircuitState } from '../../core/resilience/circuitBreaker';

/**
 * Human-readable OmniRoute diagnostics.
 *
 * Security: only a boolean "configured" flag for the API key is ever shown —
 * never the value itself.
 */

export interface DiagnosticsInput {
  baseUrl: string;
  apiKeyConfigured: boolean;
  breakerState?: CircuitState;
  modelCount?: number;
  modelCacheFresh: boolean;
  lastDiscoveryError?: string;
}

export function buildOmnirouteDiagnostics(input: DiagnosticsInput): string {
  const cfg = getOmnirouteConfig();
  const lines = [
    'Copilot Amplify — OmniRoute Diagnostics',
    '',
    `Base URL:          ${input.baseUrl}`,
    `API Key:           ${input.apiKeyConfigured ? 'Configured' : 'Not configured (anonymous mode)'}`,
    `Session ID source: ${cfg.sessionId ? 'setting override' : 'auto (window-scoped)'}`,
    '',
    '--- Requests ---',
    `Request timeout:   ${cfg.requestTimeoutMs} ms`,
    `No-Cache header:   ${cfg.noCache ? 'on' : 'off'}`,
    `No-Memory header:  ${cfg.noMemory ? 'on' : 'off'}`,
    `Compression:       ${cfg.compression || '(server default)'}`,
    `Progress events:   ${cfg.progress ? 'on' : 'off'}`,
    `Telemetry logging: ${cfg.logTelemetry ? 'on' : 'off'}`,
    '',
    '--- Model cache ---',
    `TTL:               ${Math.round(cfg.modelCacheTtlMs / 1000)} s`,
    `State:             ${input.modelCacheFresh ? 'fresh' : 'empty/expired'}`,
    `Models cached:     ${input.modelCount ?? '—'}`,
    `Discovery timeout: ${cfg.discoveryTimeoutMs} ms`,
    ...(input.breakerState ? [`Circuit breaker:   ${input.breakerState}`] : []),
    ...(input.lastDiscoveryError ? ['', `Last discovery error: ${input.lastDiscoveryError}`] : []),
  ];

  return lines.join('\n');
}
