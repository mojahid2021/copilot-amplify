import { GenericApiClient } from '../../core/api/client';
import type { AmplifyProviderDescriptor, ProviderId, ProviderTreeModel } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { NIM_MODELS } from '../../core/models/catalog';
import { StaticChatProvider } from '../static/chatProvider';

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

/**
 * Short catalog ids → NVIDIA NIM namespaced ids.
 *
 * Built once at module load as a `Map` so the hot-path `mapModelId` lookup
 * is an O(1) `get` rather than a prototype-chain property access on a
 * plain object. The original `Record` is also kept exported for tests and
 * debug surfaces.
 */
const NIM_MODEL_ID_MAP_RAW: Record<string, string> = {
  'deepseek-v4-pro-0813': 'deepseek-ai/deepseek-v4-pro-0813',
  'deepseek-v4-flash-0731': 'deepseek-ai/deepseek-v4-flash-0731',
  'nemotron-3-ultra-550b-a55b': 'nvidia/nemotron-3-ultra-550b-a55b',
  'kimi-k3': 'moonshotai/kimi-k3',
  'laguna-xs-2.1': 'poolside/laguna-xs-2.1',
  'minimax-m3': 'minimaxai/minimax-m3',
  'gemma-4-31b-it': 'google/gemma-4-31b-it',
  'gpt-oss-120b': 'openai/gpt-oss-120b',
  'mistral-nemotron': 'mistralai/mistral-nemotron',
};

const NIM_MODEL_ID_MAP: ReadonlyMap<string, string> = new Map(Object.entries(NIM_MODEL_ID_MAP_RAW));

/** Export the raw map for tests and debug surfaces. */
export const NIM_MODEL_ID_MAP_EXPORT: Readonly<Record<string, string>> = Object.freeze({ ...NIM_MODEL_ID_MAP_RAW });

/** Models that benefit from a `temperature` cap of 0.7 (reasoning stability). */
const REASONING_MODEL_IDS: ReadonlySet<string> = new Set(['kimi-k3']);

/**
 * Per-model default maximum output tokens. Used when the caller does not
 * specify `maxTokens` so we don't ask NIM for 16k output on a 8k-capable
 * model and get a 400 back. Sourced from the NIM model catalog's
 * `maxOutputTokens` so the two stay in sync.
 */
const MODEL_DEFAULT_MAX_OUTPUT_TOKENS: ReadonlyMap<string, number> = new Map(
  NIM_MODELS.map((m) => [m.id, m.maxOutputTokens ?? 8192]),
);

const THINKING_MODEL_IDS = new Set(['kimi-k3']);

class NvidiaChatProvider extends StaticChatProvider {
  /**
   * Memoized snapshot of `listModelsForTree` results. Refreshed when the
   * user changes an NVIDIA-specific setting or when the catalog changes.
   * The tree view opens frequently during normal editing activity; without
   * memoization each open would allocate 17 fresh objects.
   */
  private cachedTreeModels?: ProviderTreeModel[];
  private cachedTreeModelsAt = 0;
  private static readonly TREE_CACHE_TTL_MS = 5_000;

  protected override createProbeClient(apiKey: string): GenericApiClient {
    return new GenericApiClient(apiKey, BASE_URL, 'NVIDIA NIM', 0.7);
  }

  protected override getApiClient(apiKey: string): GenericApiClient {
    return this.createProbeClient(apiKey);
  }

  protected override mapModelId(modelId: string): string {
    return NIM_MODEL_ID_MAP.get(modelId) ?? modelId;
  }

  /**
   * Per-model default max output tokens. The static catalog carries the
   * authoritative value; we surface it through the chat pipeline so a
   * caller that omits `maxTokens` still gets a sane default per model.
   */
  protected override getDefaultMaxOutputTokens(modelId: string): number | undefined {
    return MODEL_DEFAULT_MAX_OUTPUT_TOKENS.get(modelId);
  }

  /**
   * Override the default temperature for reasoning models: QwQ and the
   * GLM-NIM release can produce unstable tool-call JSON at T=1.0, so we
   * pin them to 0.7 unless the caller asked for something else.
   */
  protected override getDefaultTemperature(modelId: string): number | undefined {
    return REASONING_MODEL_IDS.has(modelId) ? 0.7 : super.getDefaultTemperature(modelId);
  }

  /**
   * Memoized tree-listing for fast repeated reads. Tree refreshes during
   * normal chat activity re-call this method; the cache short-circuits
   * the object allocation.
   */
  override async listModelsForTree(): Promise<ProviderTreeModel[]> {
    const now = Date.now();
    if (this.cachedTreeModels && now - this.cachedTreeModelsAt < NvidiaChatProvider.TREE_CACHE_TTL_MS) {
      return this.cachedTreeModels;
    }
    const models = await super.listModelsForTree();
    this.cachedTreeModels = models;
    this.cachedTreeModelsAt = now;
    return models;
  }

  override refreshCaches(): void {
    // Drop the memoized tree snapshot so the next `listModelsForTree()`
    // reflects any catalog changes.
    this.cachedTreeModels = undefined;
    this.cachedTreeModelsAt = 0;
    super.refreshCaches();
  }

  public override dispose(): void {
    this.cachedTreeModels = undefined;
    this.cachedTreeModelsAt = 0;
    super.dispose();
  }
}

export function createNvidiaDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'nvidia',
    vendor: 'LuneCode.CA-nvidia',
    displayName: 'CA-NVIDIA NIM',
    treeIcon: 'server',
    modelCountLabel: NIM_MODELS.length,
    createAuth: (secrets) => new BaseAuthManager(secrets, 'copilot-amplify.CA-nvidia.apiKey', 'CA-NVIDIA NIM'),
    createProvider: (auth) =>
      new NvidiaChatProvider(auth, {
        baseURL: BASE_URL,
        providerDisplayName: 'NVIDIA NIM',
        models: NIM_MODELS,
        supportsThinking: (modelId: string) => THINKING_MODEL_IDS.has(modelId),
        // NIM-specific error messages. Note the dedicated 422 / 451 entries:
        // NIM's content-policy endpoint is the most common 4xx, and a clear
        // message here saves a round-trip to the docs.
        errorMessages: {
          400: 'Invalid request format. Check parameters and message format.',
          401: 'Authentication failed. The NVIDIA NIM API key may be invalid or expired. Use "Copilot Amplify: Manage Providers..." to update it.',
          403: 'Access denied. The API key may not have access to this model or may be restricted to a different org.',
          404: 'Model not found. The NIM model id may have been retired; pick a different NVIDIA NIM model.',
          413: 'Request payload too large. Reduce the conversation context or attach fewer images.',
          415: 'Unsupported media type. NIM rejected an attachment format.',
          422: 'Request rejected by NVIDIA NIM content policy. Rephrase and try again.',
          429: 'Rate limit reached. NIM enforces per-minute and per-day quotas; wait and retry.',
          451: 'Unavailable for legal / regional reasons. NVIDIA NIM is not serving this model in your region.',
          500: 'NVIDIA NIM server error. Please try again later.',
          502: 'NVIDIA NIM upstream provider error. The underlying model may be unavailable.',
          503: 'NVIDIA NIM server overloaded. Please try again later.',
          504: 'NVIDIA NIM upstream provider timed out. The underlying model may be slow or unavailable.',
        },
      }),
  };
}
