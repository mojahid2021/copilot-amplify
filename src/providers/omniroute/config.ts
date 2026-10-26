import * as vscode from 'vscode';
import { normalizeBaseUrl } from '../../core/url';
import { createCachedConfig } from '../../core/util/cachedConfig';

/**
 * Central configuration for the OmniRoute provider.
 *
 * Non-secret settings live here; the API key lives in SecretStorage
 * (`copilot-amplify.CA-omniroute.apiKey` secret key — see auth descriptors).
 */

const SECTION = 'copilot-amplify.CA-omniroute';
const DEFAULT_BASE_URL = 'http://localhost:20128/v1';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 8_000;

export { DEFAULT_BASE_URL };

export interface OmnirouteConfig {
  /** Base URL of the OmniRoute server, including the `/v1` prefix if used. */
  baseUrl: string;
  /** True only when the user has explicitly set a server URL in settings. */
  baseUrlConfigured: boolean;
  /** Send `X-OmniRoute-No-Cache: true` to bypass the semantic cache. */
  noCache: boolean;
  /** Send `x-omniroute-no-memory: true` to skip memory + skills injection. */
  noMemory: boolean;
  /** Per-request compression override (`x-omniroute-compression`). */
  compression: string;
  /** Explicit session/conversation tag; overrides the generated one. */
  sessionId: string;
  /** Send `X-OmniRoute-Progress: true` to opt into progress events. */
  progress: boolean;
  /** How long discovered model lists stay fresh before refetch. */
  modelCacheTtlMs: number;
  /** Chat request timeout in ms. */
  requestTimeoutMs: number;
  /** Model discovery / connection-test timeout in ms. */
  discoveryTimeoutMs: number;
  /** Log response cost/routing telemetry headers to the output channel. */
  logTelemetry: boolean;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

const _cache = createCachedConfig(SECTION, (cfg: vscode.WorkspaceConfiguration): OmnirouteConfig => {
  const modelCacheTtlSeconds = cfg.get<number>('modelCacheTtlSeconds', 300);
  const rawBaseUrl = cfg.get<string>('baseUrl') ?? '';
  return {
    baseUrl: normalizeBaseUrl(rawBaseUrl, DEFAULT_BASE_URL),
    baseUrlConfigured: rawBaseUrl.trim().length > 0,
    noCache: cfg.get<boolean>('noCache', false),
    noMemory: cfg.get<boolean>('noMemory', true),
    compression: (cfg.get<string>('compression') ?? '').trim(),
    sessionId: (cfg.get<string>('sessionId') ?? '').trim(),
    progress: cfg.get<boolean>('progress', false),
    modelCacheTtlMs: positiveNumber(modelCacheTtlSeconds, DEFAULT_CACHE_TTL_MS / 1000) > 0
      ? Math.max(10, modelCacheTtlSeconds) * 1000
      : DEFAULT_CACHE_TTL_MS,
    requestTimeoutMs: positiveNumber(cfg.get<number>('requestTimeoutMs'), DEFAULT_REQUEST_TIMEOUT_MS),
    discoveryTimeoutMs: positiveNumber(cfg.get<number>('discoveryTimeoutMs'), DEFAULT_DISCOVERY_TIMEOUT_MS),
    logTelemetry: cfg.get<boolean>('logTelemetry', true),
  };
});

/** Fired whenever any `copilot-amplify.CA-omniroute.*` setting changes. */
export const onDidChangeOmnirouteConfig: vscode.Event<void> = _cache.onChange;

export function getOmnirouteConfig(): OmnirouteConfig {
  return _cache.get();
}

/** Convenience accessor for the effective OmniRoute base URL. */
export function getOmnirouteBaseUrl(): string {
  return _cache.get().baseUrl;
}

/** True only when the user has explicitly set a server URL (not using the hardcoded default). */
export function isOmnirouteBaseUrlConfigured(): boolean {
  return _cache.get().baseUrlConfigured;
}

/** Detach the configuration listener — call once on extension deactivation. */
export function disposeOmnirouteConfig(): void {
  _cache.dispose();
}
