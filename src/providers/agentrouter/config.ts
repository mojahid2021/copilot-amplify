/**
 * AgentRouter provider configuration.
 *
 * AgentRouter exposes the same gateway at two endpoints:
 *   - `https://agentrouter.org/v1`        → OpenAI-compatible `/v1/chat/completions`
 *   - `https://agentrouter.org`           → Anthropic-native `/v1/messages`
 *
 * Both endpoints are addressed under the same configuration knob
 * (`copilot-amplify.agentrouter.baseUrl`) because the user only needs to
 * remember one URL. The Anthropic base is derived by stripping the trailing
 * `/v1` from the OpenAI-compat base.
 */

import * as vscode from 'vscode';
import { normalizeBaseUrl } from '../../core/url';
import { createCachedConfig } from '../../core/util/cachedConfig';
import { AGENTROUTER_SETTINGS_SECTION } from './descriptor';

const SECTION = AGENTROUTER_SETTINGS_SECTION;
const DEFAULT_BASE_URL = 'https://agentrouter.org/v1';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 8_000;

export { DEFAULT_BASE_URL };

export interface AgentrouterConfig {
  /** OpenAI-compatible base URL (must include `/v1`). */
  baseUrl: string;
  /** How long discovered model lists stay fresh before refetch. */
  cacheTtlMs: number;
  /** Chat request timeout in ms (covers connection + full stream). */
  requestTimeoutMs: number;
  /** Catalog discovery / connection-test timeout in ms. */
  discoveryTimeoutMs: number;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

const _cache = createCachedConfig(SECTION, (cfg: vscode.WorkspaceConfiguration): AgentrouterConfig => {
  const cacheTtlSeconds = cfg.get<number>('cacheTtlSeconds', 300);
  return {
    baseUrl: normalizeBaseUrl(cfg.get<string>('baseUrl'), DEFAULT_BASE_URL),
    cacheTtlMs: positiveNumber(cacheTtlSeconds, DEFAULT_CACHE_TTL_MS / 1000) > 0
      ? Math.max(10, cacheTtlSeconds) * 1000
      : DEFAULT_CACHE_TTL_MS,
    requestTimeoutMs: positiveNumber(cfg.get<number>('requestTimeoutMs'), DEFAULT_REQUEST_TIMEOUT_MS),
    discoveryTimeoutMs: positiveNumber(cfg.get<number>('discoveryTimeoutMs'), DEFAULT_DISCOVERY_TIMEOUT_MS),
  };
});

/** Fired whenever any `copilot-amplify.CA-agentrouter.*` setting changes. */
export const onDidChangeAgentrouterConfig: vscode.Event<void> = _cache.onChange;

export function getAgentrouterConfig(): AgentrouterConfig {
  return _cache.get();
}

/** OpenAI-compatible base URL — must end in `/v1`. */
export function getAgentrouterOpenaiBaseUrl(): string {
  return _cache.get().baseUrl;
}

/**
 * Anthropic-native base URL — derived from the OpenAI base by stripping
 * a trailing `/v1` path component.
 */
export function getAgentrouterAnthropicBaseUrl(): string {
  return _cache.get().baseUrl.replace(/\/v1\/?$/, '');
}

/** Discovery / connection-test base URL — same as the OpenAI-compat one. */
export function getAgentrouterDiscoveryBaseUrl(): string {
  return _cache.get().baseUrl;
}

/** Detach the configuration listener — call once on extension deactivation. */
export function disposeAgentrouterConfig(): void {
  _cache.dispose();
}
