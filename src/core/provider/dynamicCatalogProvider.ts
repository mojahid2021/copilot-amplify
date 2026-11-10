import * as vscode from 'vscode';
import type { BaseAuthManager } from '../auth/authManager';
import { ApiError, type ThinkingOption } from '../api/client';
import { TTLCache } from '../resilience/cache';
import { BaseChatProvider } from './baseChatProvider';
import type { AmplifyProviderFacet, ConnectionTestResult, ProviderHealth, ProviderTreeModel } from './registry';

const CACHE_KEY = 'models';

export interface DynamicCatalogOptions {
  /** How long a loaded model list counts as fresh (health shows "connected"). */
  cacheTtlMs: number;
  /** Fires when the provider's settings change; the model list is dropped. */
  onDidChangeConfig: vscode.Event<void>;
  /** Settings section holding the `warmupOnStartup` flag. */
  settingsSection: string;
}

/**
 * Provider whose model list comes from the server (OmniRoute, AgentRouter).
 *
 * Models are fetched only on an explicit user action (Load Models / Refresh,
 * or the opt-in `warmupOnStartup` setting). VS Code asks for the model list
 * often, so `provideLanguageModelChatInformation` only ever returns what is
 * already cached, even when it is stale.
 */
export abstract class DynamicCatalogProvider extends BaseChatProvider implements AmplifyProviderFacet {
  protected override readonly models: vscode.LanguageModelChatInformation[] = [];

  private readonly modelCache: TTLCache<vscode.LanguageModelChatInformation[]>;
  private lastDiscoveryError?: { message: string; status?: number };
  private lastKnownModelIds: ReadonlySet<string> = new Set();

  constructor(authManager: BaseAuthManager, options: DynamicCatalogOptions) {
    super(authManager);
    this.modelCache = new TTLCache(options.cacheTtlMs);
    this.addDisposables(
      authManager.onDidChangeApiKey(() => this.refreshCaches()),
      options.onDidChangeConfig(() => this.refreshCaches()),
    );
    if (vscode.workspace.getConfiguration(options.settingsSection).get<boolean>('warmupOnStartup', false)) {
      // Deferred so activation itself never does network I/O.
      setTimeout(() => void this.loadModels(), 0).unref?.();
    }
  }

  abstract testConnection(): Promise<ConnectionTestResult>;

  /** Fetch the live model list. Throw on failure; the base class records it. */
  protected abstract fetchModels(signal?: AbortSignal): Promise<vscode.LanguageModelChatInformation[]>;

  /** False when discovery cannot run yet (no server URL, no API key). */
  protected abstract canLoadModels(): Promise<boolean>;

  /** Whether the tree should show the "Reasoning" badge for this model. */
  protected abstract modelSupportsReasoning(modelId: string): boolean;

  /** Model id as shown in the tree. Override when catalog ids are encoded. */
  protected displayModelId(modelId: string): string {
    return modelId;
  }

  /** Health that overrides everything else (e.g. "set the server URL first"). */
  protected setupHealth(): ProviderHealth | undefined {
    return undefined;
  }

  /** Gateways take `reasoning_effort`, never the Z.ai-style `thinking` field. */
  protected override getThinkingOption(): ThinkingOption | undefined {
    return undefined;
  }

  /** Discover models now. Never throws; returns the stale list on failure. */
  async loadModels(): Promise<vscode.LanguageModelChatInformation[]> {
    if (!(await this.canLoadModels())) {
      return this.cachedModels();
    }
    try {
      return await this.discover();
    } catch {
      return this.cachedModels();
    }
  }

  override async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    return token.isCancellationRequested ? [] : this.cachedModels();
  }

  async listModelsForTree(): Promise<ProviderTreeModel[]> {
    return (this.modelCache.peek(CACHE_KEY) ?? []).map((info) => ({
      id: this.displayModelId(info.id),
      name: info.name,
      capabilities: {
        imageInput: info.capabilities.imageInput,
        toolCalling: info.capabilities.toolCalling,
      },
      maxInputTokens: info.maxInputTokens,
      maxOutputTokens: info.maxOutputTokens,
      supportsReasoning: this.modelSupportsReasoning(info.id),
    }));
  }

  refreshCaches(): void {
    this.modelCache.invalidateAll();
    this.lastDiscoveryError = undefined;
    this.lastKnownModelIds = new Set();
  }

  health(): ProviderHealth {
    const setup = this.setupHealth();
    if (setup) {
      return setup;
    }

    const fresh = this.modelCache.has(CACHE_KEY);
    if (this.lastDiscoveryError && !fresh) {
      const { message, status } = this.lastDiscoveryError;
      const kind = status === 401 || status === 403 ? 'auth-failed' : status === 429 ? 'rate-limited' : 'error';
      return { configured: true, status: kind, detail: message };
    }

    const detail = fresh ? `${this.modelCache.peek(CACHE_KEY)?.length ?? 0} models` : 'Not loaded';
    if (this.getCircuitState() === 'open') {
      return { configured: true, status: 'error', detail: `${detail} · paused after repeated failures` };
    }
    return { configured: true, status: fresh ? 'connected' : 'not-configured', detail };
  }

  private cachedModels(): vscode.LanguageModelChatInformation[] {
    return this.modelCache.peekStale(CACHE_KEY) ?? [];
  }

  private async discover(): Promise<vscode.LanguageModelChatInformation[]> {
    try {
      const models = await this.modelCache.getOrFetch(CACHE_KEY, (signal) => this.fetchModels(signal));
      this.lastDiscoveryError = undefined;
      this.breaker.recordSuccess();

      // Only poke VS Code when the set of models actually changed.
      const ids = new Set(models.map((m) => m.id));
      if (ids.size !== this.lastKnownModelIds.size || [...ids].some((id) => !this.lastKnownModelIds.has(id))) {
        this.lastKnownModelIds = ids;
        this.fireModelInformationChanged();
      }
      return models;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = error instanceof ApiError && error.statusCode > 0 ? error.statusCode : undefined;
      this.lastDiscoveryError = { message, status };
      this.breaker.recordFailure();
      this.log.warn('model discovery failed', { error: message, status });
      throw error;
    }
  }
}
