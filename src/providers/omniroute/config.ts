import * as vscode from 'vscode';
import { normalizeBaseUrl } from '../../core/url';

/**
 * Central configuration for the OmniRoute provider.
 *
 * Non-secret settings live here; the API key lives in SecretStorage
 * (`copilot-amplify.omniroute.apiKey` secret key — see auth descriptors).
 *
 * OmniRoute exposes per-request controls via custom headers:
 * semantic-cache bypass, memory/skills-injection bypass, progress events,
 * session tagging and compression overrides. All are surfaced as settings.
 */

const SECTION = 'copilot-amplify.omniroute';
const DEFAULT_BASE_URL = 'http://localhost:20128/v1';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 8_000;

export { DEFAULT_BASE_URL };

export interface OmnirouteConfig {
  /** Base URL of the OmniRoute server, including the `/v1` prefix if used. */
  baseUrl: string;
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

let cachedConfig: OmnirouteConfig | undefined;
let listenerInstalled = false;
const onDidChangeEmitter = new vscode.EventEmitter<void>();

/** Fired whenever any `copilot-amplify.omniroute.*` setting changes. */
export const onDidChangeOmnirouteConfig: vscode.Event<void> = onDidChangeEmitter.event;

function ensureListener(): void {
  if (listenerInstalled) {
    return;
  }
  listenerInstalled = true;
  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(SECTION)) {
      cachedConfig = undefined;
      onDidChangeEmitter.fire();
    }
  });
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getOmnirouteConfig(): OmnirouteConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  ensureListener();
  const cfg = vscode.workspace.getConfiguration(SECTION);

  const modelCacheTtlSeconds = cfg.get<number>('modelCacheTtlSeconds', 300);

  cachedConfig = {
    baseUrl: normalizeBaseUrl(cfg.get<string>('baseUrl'), DEFAULT_BASE_URL),
    noCache: cfg.get<boolean>('noCache', false),
    noMemory: cfg.get<boolean>('noMemory', true),
    compression: (cfg.get<string>('compression') ?? '').trim(),
    sessionId: (cfg.get<string>('sessionId') ?? '').trim(),
    progress: cfg.get<boolean>('progress', false),
    modelCacheTtlMs: positiveNumber(modelCacheTtlSeconds, DEFAULT_CACHE_TTL_MS / 1000) > 0
      ? Math.max(10, modelCacheTtlSeconds) * 1000
      : DEFAULT_CACHE_TTL_MS,
    requestTimeoutMs: positiveNumber(
      cfg.get<number>('requestTimeoutMs'),
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    discoveryTimeoutMs: positiveNumber(
      cfg.get<number>('discoveryTimeoutMs'),
      DEFAULT_DISCOVERY_TIMEOUT_MS,
    ),
    logTelemetry: cfg.get<boolean>('logTelemetry', true),
  };

  return cachedConfig;
}

/** Convenience accessor for the effective OmniRoute base URL. */
export function getOmnirouteBaseUrl(): string {
  return getOmnirouteConfig().baseUrl;
}
