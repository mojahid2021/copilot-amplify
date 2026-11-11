import type * as vscode from 'vscode';
import { ApiError, GenericApiClient } from '../../core/api/client';
import { apiErrorFromResponse, createRequestSignal } from '../../core/api/http';
import type { BaseAuthManager } from '../../core/auth/authManager';
import { getGlobalConfig } from '../../core/globalConfig';
import type { ConfigurableLanguageModelChatInformation } from '../../core/models/catalog';
import { displayNameFromId, fromPickerId, toPickerId } from '../../core/models/modelIds';
import { DynamicCatalogProvider } from '../../core/provider/dynamicCatalogProvider';
import type { ConnectionTestResult, ProviderId } from '../../core/provider/registry';
import { joinEndpoint } from '../../core/url';

export interface OpenAiCompatibleOptions {
  id: ProviderId;
  displayName: string;
  baseURL: string;
  /** For providers that serve some keys from another gateway (Xiaomi token-plan keys). */
  baseUrlForKey?: (apiKey: string) => string;
  /**
   * Details for models we know, keyed by the provider's own model id. Used to
   * fill in what `GET /models` doesn't say (limits, vision, tools), and as the
   * model list when the provider has no list endpoint at all.
   */
  knownModels: readonly ConfigurableLanguageModelChatInformation[];
  /** Ids in the list that are not chat models (speech, embeddings, safety…). */
  notChat?: RegExp;
  /** Limits and tool support for listed models we have no details for. */
  newModelDefaults: { maxInputTokens: number; maxOutputTokens: number; toolCalling: boolean };
  /** Models that take the Z.ai-style `thinking` request field. */
  supportsThinking?: boolean | ((apiModelId: string) => boolean);
  /** Sampling temperature sent with every request. Default 1.0. */
  defaultTemperature?: number;
  /** HTTP status → message shown in Chat; the rest use the shared defaults. */
  errorMessages?: Record<number, string>;
}

/** How long a loaded list counts as fresh. Lists also survive restarts, so this only affects the "Connected" badge. */
const MODEL_LIST_TTL_MS = 5 * 60 * 1000;

/** Statuses meaning "this server has no model list"; the known models are used instead. */
const NO_LIST_ENDPOINT = new Set([404, 405, 501]);

/**
 * A provider with an OpenAI-compatible API (Xiaomi, Z.ai, Groq, NVIDIA).
 *
 * The model list comes from `GET {baseURL}/models` on Load Models / Refresh
 * and is kept across restarts. Those lists usually carry only ids, so models
 * found in `knownModels` keep their exact details and the rest get
 * `newModelDefaults`. Ids containing `/` are encoded for the Copilot picker.
 */
export class OpenAiCompatibleProvider extends DynamicCatalogProvider {
  protected override readonly baseURL: string;
  protected override readonly providerDisplayName: string;
  protected override readonly errorMessages: Record<number, string>;

  private readonly options: OpenAiCompatibleOptions;
  private readonly knownById: ReadonlyMap<string, ConfigurableLanguageModelChatInformation>;

  constructor(authManager: BaseAuthManager, state: vscode.Memento, options: OpenAiCompatibleOptions) {
    super(authManager, {
      cacheTtlMs: MODEL_LIST_TTL_MS,
      warmupOnStartup: getGlobalConfig().loadModelsOnStartup,
      persist: { state, key: `models.${options.id}` },
    });
    this.options = options;
    this.baseURL = options.baseURL;
    this.providerDisplayName = options.displayName;
    this.errorMessages = options.errorMessages ?? {};
    this.knownById = new Map(options.knownModels.map((model) => [model.id, model]));
  }

  protected override async canLoadModels(): Promise<boolean> {
    return Boolean(await this.authManager.getApiKey());
  }

  protected override async fetchModels(signal?: AbortSignal): Promise<vscode.LanguageModelChatInformation[]> {
    const apiKey = (await this.authManager.getApiKey()) ?? '';
    const request = createRequestSignal({ timeoutMs: getGlobalConfig().modelListTimeoutMs, signal });
    try {
      const response = await fetch(joinEndpoint(this.baseUrlFor(apiKey), '/models'), {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: request.signal,
      });
      if (NO_LIST_ENDPOINT.has(response.status)) {
        return this.options.knownModels.map((model) => this.toModelInfo(model.id, {}));
      }
      if (!response.ok) {
        throw await apiErrorFromResponse(response, `${this.providerDisplayName} model list`);
      }

      const body = (await response.json()) as { data?: unknown };
      const entries = (Array.isArray(body.data) ? body.data : []) as ListedModel[];
      const listed = new Map<string, ListedModel>();
      for (const entry of entries) {
        const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
        if (id && entry.active !== false && !this.options.notChat?.test(id)) {
          listed.set(id, entry);
        }
      }
      if (listed.size === 0) {
        throw new Error(`${this.providerDisplayName} did not return any chat models`);
      }

      // Models with known details first, in our order; the rest alphabetically.
      const known = this.options.knownModels.filter((model) => listed.has(model.id)).map((model) => this.toModelInfo(model.id, {}));
      const others = [...listed]
        .filter(([id]) => !this.knownById.has(id))
        .map(([id, entry]) => this.toModelInfo(id, entry))
        .sort((a, b) => a.name.localeCompare(b.name));
      return [...known, ...others];
    } finally {
      request.dispose();
    }
  }

  /** A one-token chat request: unlike the model list, it proves the key works. */
  async testConnection(): Promise<ConnectionTestResult> {
    const apiKey = await this.authManager.getApiKey();
    if (!apiKey) {
      return { ok: false, message: 'No API key is set' };
    }
    const probeModel = (await this.listModelsForTree())[0]?.id ?? this.options.knownModels[0]?.id;
    if (!probeModel) {
      return { ok: false, message: 'Load the model list first' };
    }
    const started = Date.now();
    try {
      await this.getApiClient(apiKey).chat(probeModel, [{ role: 'user', content: 'Ping' }], { maxTokens: 1 });
      return { ok: true, message: 'Connected', latencyMs: Date.now() - started };
    } catch (error) {
      const status = error instanceof ApiError ? error.statusCode : undefined;
      return {
        ok: false,
        message: status === 401 || status === 403 ? 'Your API key was not accepted' : error instanceof Error ? error.message : String(error),
        ...(status ? { httpStatus: status } : {}),
        latencyMs: Date.now() - started,
      };
    }
  }

  protected override getApiClient(apiKey: string): GenericApiClient {
    return new GenericApiClient(apiKey, this.baseUrlFor(apiKey), this.providerDisplayName, this.options.defaultTemperature ?? 1.0);
  }

  protected override mapModelId(modelId: string): string {
    return fromPickerId(modelId);
  }

  protected override displayModelId(modelId: string): string {
    return fromPickerId(modelId);
  }

  protected override supportsThinking(modelId: string): boolean {
    const { supportsThinking } = this.options;
    return typeof supportsThinking === 'function' ? supportsThinking(fromPickerId(modelId)) : supportsThinking ?? false;
  }

  protected override modelSupportsReasoning(modelId: string): boolean {
    return this.knownById.get(fromPickerId(modelId))?.configurationSchema !== undefined || this.supportsThinking(modelId);
  }

  private baseUrlFor(apiKey: string): string {
    return this.options.baseUrlForKey?.(apiKey) ?? this.baseURL;
  }

  private toModelInfo(id: string, entry: ListedModel): vscode.LanguageModelChatInformation {
    const known = this.knownById.get(id);
    if (known) {
      return { ...known, id: toPickerId(id) };
    }
    const defaults = this.options.newModelDefaults;
    const maxInputTokens = positive(entry.context_window) ?? positive(entry.context_length) ?? defaults.maxInputTokens;
    return {
      id: toPickerId(id),
      name: displayNameFromId(id),
      family: this.options.id,
      version: id,
      detail: this.providerDisplayName,
      tooltip: `${this.providerDisplayName} · ${id}`,
      maxInputTokens,
      maxOutputTokens: Math.min(positive(entry.max_completion_tokens) ?? defaults.maxOutputTokens, maxInputTokens),
      capabilities: { imageInput: false, toolCalling: defaults.toolCalling },
    };
  }
}

/** One entry of an OpenAI-style `GET /models` response. Only `id` is guaranteed. */
interface ListedModel {
  id?: unknown;
  /** Groq: false for models being retired. */
  active?: unknown;
  /** Groq. */
  context_window?: unknown;
  max_completion_tokens?: unknown;
  /** Some OpenAI-compatible servers. */
  context_length?: unknown;
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
