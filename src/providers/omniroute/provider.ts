import * as vscode from 'vscode';
import { BaseChatProvider } from '../../core/provider/baseChatProvider';
import type {
  AmplifyProviderFacet,
  ConnectionTestResult,
  ProviderHealth,
  ProviderTreeModel,
} from '../../core/provider/registry';
import type { BaseAuthManager } from '../../core/auth/authManager';
import { TTLCache } from '../../core/resilience/cache';
import { ApiError, type ThinkingOption } from '../../core/api/client';
import { logger } from '../../core/logging/logger';
import { OmnirouteApiClient } from './api';
import {
  decodeOmnirouteModelId,
  fetchOmnirouteModels,
  isNoThinkingVariant,
  resolveOmnirouteUpstreamModelId,
  stripNoThinkingPrefix,
} from './models';
import { clearOmnirouteModelCapabilities, omnirouteModelAdvertisesThinking, registerOmnirouteModelCapabilities } from './modelRegistry';
import { getOmnirouteBaseUrl, getOmnirouteConfig, isOmnirouteBaseUrlConfigured, onDidChangeOmnirouteConfig } from './config';
import { testOmnirouteConnection } from './connectionTest';

const log = logger.child({ provider: 'OmniRoute' });

export class OmnirouteChatProvider extends BaseChatProvider implements AmplifyProviderFacet {
  protected override get baseURL(): string {
    return getOmnirouteBaseUrl();
  }
  protected override readonly providerDisplayName = 'OmniRoute';
  protected override readonly models: vscode.LanguageModelChatInformation[] = [];

  private readonly modelCache: TTLCache<vscode.LanguageModelChatInformation[]>;
  private thinkingModelIds = new Set<string>();
  private lastDiscoveryError?: string;
  private lastDiscoveryStatus?: number;
  private lastConnectionTest?: { ok: boolean; message: string; latencyMs?: number; at: number };
  private lastKnownModelIds: ReadonlySet<string> = new Set();

  constructor(authManager: BaseAuthManager) {
    super(authManager);
    this.modelCache = new TTLCache<vscode.LanguageModelChatInformation[]>(getOmnirouteConfig().modelCacheTtlMs);
    this.authManager.onDidChangeApiKey(() => {
      this.invalidateModelCache();
    });
    // Refetch when base URL / cache TTL / breaker settings change.
    onDidChangeOmnirouteConfig(() => {
      this.invalidateModelCache();
    });
    maybeWarmup(this);
  }

  public invalidateModelCache(): void {
    this.modelCache.invalidateAll();
    clearOmnirouteModelCapabilities();
    this.lastDiscoveryError = undefined;
    this.lastKnownModelIds = new Set();
  }

  /** ── AmplifyProviderFacet ─────────────────────────────────────────────── */

  async testConnection(): Promise<ConnectionTestResult> {
    const apiKey = await this.authManager.getApiKey();
    const result = await testOmnirouteConnection({
      baseUrl: getOmnirouteBaseUrl(),
      ...(apiKey ? { apiKey } : {}),
    });
    this.lastConnectionTest = { ...result, at: Date.now() };
    return result;
  }

  async listModelsForTree(): Promise<ProviderTreeModel[]> {
    const cached = this.modelCache.peek('models') ?? [];
    return cached.map((info) => ({
      id: decodeOmnirouteModelId(info.id),
      name: info.name,
      capabilities: {
        imageInput: info.capabilities.imageInput,
        toolCalling: info.capabilities.toolCalling,
      },
      maxInputTokens: info.maxInputTokens,
      maxOutputTokens: info.maxOutputTokens,
      supportsReasoning: this.thinkingModelIds.has(decodeOmnirouteModelId(info.id)),
    }));
  }

  refreshCaches(): void {
    this.invalidateModelCache();
  }

  health(): ProviderHealth {
    if (!isOmnirouteBaseUrlConfigured()) {
      return { configured: false, status: 'setup-required', detail: 'Set server URL to load models' };
    }
    const fresh = this.modelCache.has('models');
    if (this.lastDiscoveryError && !fresh) {
      const status =
        this.lastDiscoveryStatus === 401 || this.lastDiscoveryStatus === 403
          ? 'auth-failed'
          : this.lastDiscoveryStatus === 429
            ? 'rate-limited'
            : 'error';
      return { configured: true, status, detail: this.lastDiscoveryError };
    }
    const detail = fresh
      ? `${this.modelCache.peek('models')?.length ?? 0} models`
      : 'Not loaded';
    if (this.getCircuitState() === 'open') {
      return { configured: true, status: 'error', detail: `${detail} · circuit open (cooling down)` };
    }
    return {
      configured: true,
      status: fresh ? 'connected' : 'not-configured',
      detail,
    };
  }

  /** ── Discovery ─────────────────────────────────────────────────────────── */

  /** Permanent (non-retryable) HTTP statuses. */
  private static readonly PERMANENT_FAILURE_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404, 410, 421]);

  private async discoverAndCache(): Promise<vscode.LanguageModelChatInformation[]> {
    try {
      const models = await this.modelCache.getOrFetch('models', async (signal) => {
        const apiKey = (await this.authManager.getApiKey()) || undefined;
        const discovered = await fetchOmnirouteModels({
          baseUrl: getOmnirouteBaseUrl(),
          apiKey,
          timeoutMs: getOmnirouteConfig().discoveryTimeoutMs,
          signal,
        });
        if (!discovered.length) {
          throw new Error('OmniRoute did not return any chat-capable models');
        }

        this.thinkingModelIds = new Set(
          discovered.filter((m) => m.supportsThinking).map((m) => m.upstreamId),
        );
        for (const mapped of discovered) {
          const temperature = mapped.capabilities?.temperature;
          registerOmnirouteModelCapabilities(mapped.upstreamId, {
            ...(temperature !== undefined ? { temperature } : {}),
            ...(mapped.supportsThinking ? { thinking: true } : {}),
          });
        }
        return discovered.map((m) => m.info);
      });
      this.lastDiscoveryError = undefined;
      this.breaker.recordSuccess();
      const newIds = new Set(models.map((m) => m.id));
      const changed =
        newIds.size !== this.lastKnownModelIds.size ||
        [...newIds].some((id) => !this.lastKnownModelIds.has(id));
      if (changed) {
        this.lastKnownModelIds = newIds;
        this.fireModelInformationChanged();
      }
      return models;
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      const status =
        error instanceof ApiError && error.statusCode > 0 ? error.statusCode : undefined;
      this.lastDiscoveryError = details;
      this.lastDiscoveryStatus = status;
      this.breaker.recordFailure();
      log.warn('model discovery failed', { error: details, status });
      throw error;
    }
  }

  /** Manual discovery trigger — used by warmup, refresh commands, and the "Load Models" button. */
  async warmupNow(): Promise<vscode.LanguageModelChatInformation[]> {
    // Never attempt discovery without an explicitly configured server URL.
    if (!isOmnirouteBaseUrlConfigured()) {
      return this.modelCache.peekStale('models') ?? [];
    }
    try {
      return await this.discoverAndCache();
    } catch {
      return this.modelCache.peekStale('models') ?? [];
    }
  }

  /** User-initiated model load — called from the "Load Models" tree item button. */
  async loadModels(): Promise<void> {
    await this.warmupNow();
  }

  /** ── Language Model API surface ────────────────────────────────────────── */

  override async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (token.isCancellationRequested) {
      return [];
    }
    // Never trigger a network call here — VS Code calls this on every internal
    // model-list refresh. Return the stale cache; the user loads models manually.
    return this.modelCache.peekStale('models') ?? [];
  }

  override async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey = (await this.authManager.getApiKey()) || 'omniroute';
    try {
      await this.runChatOperation(
        () =>
          this.streamResponse(
            this.getOrCreateClient(apiKey),
            model,
            messages,
            options,
            progress,
            token,
          ),
        token,
      );
    } catch (error) {
      if (token.isCancellationRequested || (error instanceof Error && error.name === 'CancelledError')) {
        return;
      }
      this.throwMappedError(error);
    }
  }

  /** ── Hooks ──────────────────────────────────────────────────────────────── */

  protected override getApiClient(apiKey: string): OmnirouteApiClient {
    return new OmnirouteApiClient(apiKey);
  }

  protected override mapModelId(modelId: string): string {
    return resolveOmnirouteUpstreamModelId(modelId);
  }

  protected override supportsThinking(modelId: string): boolean {
    const decoded = decodeOmnirouteModelId(modelId);
    if (isNoThinkingVariant(decoded)) {
      return false;
    }
    const advertised = omnirouteModelAdvertisesThinking(stripNoThinkingPrefix(decoded));
    if (advertised !== undefined) {
      return advertised;
    }
    return this.thinkingModelIds.has(decoded);
  }

  protected override getThinkingOption(
    _modelId: string,
    _options: vscode.ProvideLanguageModelChatResponseOptions,
  ): ThinkingOption | undefined {
    void _modelId;
    void _options;
    return undefined;
  }

  protected override readonly errorMessages: Record<number, string> = {
    400: 'Invalid request format. Check parameters and message format.',
    404: 'Model not found. Pick a different OmniRoute model.',
    413: 'Request payload too large for OmniRoute or the upstream model. Reduce context or attachments.',
    421: 'Request blocked by content filter. Avoid unsafe or sensitive content.',
    429: 'Rate limit reached. Please wait and try again.',
    500: 'OmniRoute server error. Please try again later.',
    502: 'OmniRoute upstream provider error. The underlying model may be unavailable.',
    503: 'OmniRoute server overloaded. Please try again later.',
    504: 'OmniRoute upstream provider timed out. The underlying model may be slow or unavailable.',
  };
}

/**
 * Optional eager warmup. Deliberately NOT part of construction: activation
 * stays free of network I/O unless the user explicitly opts in.
 */
function maybeWarmup(provider: OmnirouteChatProvider): void {
  let warmupOnStartup: boolean;
  try {
    warmupOnStartup = vscode.workspace
      .getConfiguration('copilot-amplify.CA-omniroute')
      .get<boolean>('warmupOnStartup', false);
  } catch {
    return;
  }
  if (warmupOnStartup) {
    const timer = setTimeout(() => void provider.warmupNow().catch(() => {}), 0);
    timer.unref?.();
  }
}
