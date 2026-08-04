import * as vscode from 'vscode';

/**
 * Central configuration for the OmniRoute provider.
 *
 * OmniRoute exposes a rich set of per-request controls via custom headers
 * (see the OmniRoute API doc): semantic-cache bypass (`X-OmniRoute-No-Cache`),
 * memory/skills-injection bypass (`x-omniroute-no-memory`), progress events,
 * session/conversation tagging (`X-OmniRoute-Session-Id`) and per-request
 * compression overrides (`x-omniroute-compression`). All of those are exposed
 * here as VS Code settings so the provider behaves correctly out of the box and
 * operators can tune the local aggregator without editing code.
 */

const SECTION = 'copilot-amplify.omniroute';
const DEFAULT_BASE_URL = 'http://localhost:20128/v1';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

export interface OmnirouteConfig {
  /** Base URL of the OmniRoute server, including the `/v1` prefix. */
  baseUrl: string;
  /** Send `X-OmniRoute-No-Cache: true` to bypass the semantic cache. */
  noCache: boolean;
  /** Send `x-omniroute-no-memory: true` to skip memory + skills injection. */
  noMemory: boolean;
  /** Per-request compression override (`x-omniroute-compression`). */
  compression: string;
  /** Caller-supplied session/conversation tag (`X-OmniRoute-Session-Id`). */
  sessionId: string;
  /** Send `X-OmniRoute-Progress: true` to opt into progress events. */
  progress: boolean;
  /** How long discovered model lists stay fresh before refetch. */
  modelCacheTtlMs: number;
  /** Log response cost/routing telemetry headers to the Omniroute channel. */
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

export function getOmnirouteConfig(): OmnirouteConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  ensureListener();
  const cfg = vscode.workspace.getConfiguration(SECTION);

  const baseUrl = (cfg.get<string>('baseUrl') ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const modelCacheTtlSeconds = cfg.get<number>('modelCacheTtlSeconds', 300);

  cachedConfig = {
    baseUrl: baseUrl.length > 0 ? baseUrl : DEFAULT_BASE_URL,
    noCache: cfg.get<boolean>('noCache', false),
    noMemory: cfg.get<boolean>('noMemory', true),
    compression: (cfg.get<string>('compression') ?? '').trim(),
    sessionId: (cfg.get<string>('sessionId') ?? '').trim(),
    progress: cfg.get<boolean>('progress', false),
    modelCacheTtlMs: Number.isFinite(modelCacheTtlSeconds) && modelCacheTtlSeconds > 0
      ? modelCacheTtlSeconds * 1000
      : DEFAULT_CACHE_TTL_MS,
    logTelemetry: cfg.get<boolean>('logTelemetry', true),
  };

  return cachedConfig;
}

/** Convenience accessor for the effective OmniRoute base URL. */
export function getOmnirouteBaseUrl(): string {
  return getOmnirouteConfig().baseUrl;
}
