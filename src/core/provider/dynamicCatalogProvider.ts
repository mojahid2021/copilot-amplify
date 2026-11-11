import type * as vscode from 'vscode';
import type { BaseAuthManager } from '../auth/authManager';
import { ApiError } from '../api/client';
import { TTLCache } from '../resilience/cache';
import { BaseChatProvider } from './baseChatProvider';
import type { AmplifyProviderFacet, ConnectionTestResult, ProviderHealth, ProviderTreeModel } from './registry';

const CACHE_KEY = 'models';

export interface DynamicCatalogOptions {
  /** How long a loaded model list counts as fresh (health shows "connected"). */
  cacheTtlMs: number;
  /** Load models right after startup instead of waiting for Load Models. */
  warmupOnStartup: boolean;
  /** Fires when settings that affect the model list change; the list is dropped. */
  onDidChangeConfig?: vscode.Event<void>;
  /** Where to keep the last loaded list so it survives a VS Code restart. */
  persist?: { state: vscode.Memento; key: string };
}

/**
 * Provider whose model list comes from the server.
 *
 * Models are fetched only on an explicit user action (Load Models / Refresh,
 * or the opt-in warm-up setting). VS Code asks for the model list often, so
 * `provideLanguageModelChatInformation` only ever returns what is already
 * known: the cache, or the list saved from the last session.
 */
export abstract class DynamicCatalogProvider extends BaseChatProvider implements AmplifyProviderFacet {
  protected override readonly models: vscode.LanguageModelChatInformation[] = [];

  private readonly modelCache: TTLCache<vscode.LanguageModelChatInformation[]>;
  private readonly persist?: DynamicCatalogOptions['persist'];
  /** List saved by a previous session; used until the first successful load. */
  private savedModels?: vscode.LanguageModelChatInformation[];
  private lastDiscoveryError?: { message: string; status?: number };
  private lastKnownModelIds: ReadonlySet<string> = new Set();

  constructor(authManager: BaseAuthManager, options: DynamicCatalogOptions) {
    super(authManager);
    this.modelCache = new TTLCache(options.cacheTtlMs);
    this.persist = options.persist;
    this.savedModels = this.persist?.state.get<vscode.LanguageModelChatInformation[]>(this.persist.key);

    this.addDisposables(authManager.onDidChangeApiKey(() => this.refreshCaches()));
    if (options.onDidChangeConfig) {
      this.addDisposables(options.onDidChangeConfig(() => this.refreshCaches()));
    }
    if (options.warmupOnStartup) {
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

  /** Discover models now. Never throws; returns the last known list on failure. */
  async loadModels(): Promise<vscode.LanguageModelChatInformation[]> {
    if (!(await this.canLoadModels())) {
      return this.knownModels();
    }
    try {
      return await this.discover();
    } catch {
      return this.knownModels();
    }
  }

  override async provideLanguageModelChatInformation(
    _options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    return token.isCancellationRequested ? [] : this.knownModels();
  }

  async listModelsForTree(): Promise<ProviderTreeModel[]> {
    return this.knownModels().map((info) => ({
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

  /** Forget the model list (also the saved one); the next Load Models starts fresh. */
  refreshCaches(): void {
    this.modelCache.invalidateAll();
    this.lastDiscoveryError = undefined;
    this.lastKnownModelIds = new Set();
    if (this.savedModels) {
      this.savedModels = undefined;
      void this.persist?.state.update(this.persist.key, undefined);
    }
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

    const count = this.knownModels().length;
    const detail = count > 0 ? `${count} model${count === 1 ? '' : 's'}` : 'Models not loaded';
    if (this.getCircuitState() === 'open') {
      return { configured: true, status: 'error', detail: `${detail} · paused after repeated failures` };
    }
    return { configured: true, status: fresh ? 'connected' : 'not-configured', detail };
  }

  /** Cached list (even if expired), else the list saved by the last session. */
  protected knownModels(): vscode.LanguageModelChatInformation[] {
    return this.modelCache.peekStale(CACHE_KEY) ?? this.savedModels ?? [];
  }

  private async discover(): Promise<vscode.LanguageModelChatInformation[]> {
    try {
      const models = await this.modelCache.getOrFetch(CACHE_KEY, (signal) => this.fetchModels(signal));
      this.lastDiscoveryError = undefined;
      this.breaker.recordSuccess();
      this.savedModels = undefined;
      void this.persist?.state.update(this.persist.key, models);

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
