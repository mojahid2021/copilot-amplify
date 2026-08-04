import type * as vscode from 'vscode';
import { BaseChatProvider } from './baseProvider';
import type { ThinkingOption } from './baseApi';
import { CHAT_BASE_URL, OmnirouteApiClient } from './omnirouteApi';
import { getOmnirouteBaseUrl, getOmnirouteConfig, onDidChangeOmnirouteConfig } from './omnirouteConfig';
import { registerOmnirouteModelCapabilities } from './omnirouteModelRegistry';
import type { BaseAuthManager } from './baseAuth';

interface OmnirouteModelCapabilities {
  tool_calling?: boolean;
  reasoning?: boolean;
  thinking?: boolean;
  temperature?: boolean;
  vision?: boolean;
  supportsThinking?: boolean;
}

interface OmnirouteModelRaw {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  max_input_tokens?: unknown;
  max_output_tokens?: unknown;
  capabilities?: OmnirouteModelCapabilities;
  input_modalities?: unknown;
  type?: unknown;
}

interface OmnirouteModelsResponse {
  data?: OmnirouteModelRaw[];
}

/**
 * OmniRoute advertises a `no-thinking` variant for thinking-capable Claude
 * models. Selecting it resolves back to the real `<provider>/<model>` with
 * reasoning suppressed (the `reasoning`/`reasoning_effort` fields are dropped
 * on the `/v1/chat/completions` path). We detect the variant locally as well so
 * the Copilot picker shows it, the request targets the real model, and no
 * reasoning fields are ever emitted for it.
 */
const NO_THINKING_PREFIX = 'claude-3-omniroute-no-thinking/';

function isNoThinkingVariant(id: string): boolean {
  return id.startsWith(NO_THINKING_PREFIX);
}

function stripNoThinkingPrefix(id: string): string {
  return isNoThinkingVariant(id) ? id.slice(NO_THINKING_PREFIX.length) : id;
}

function getModelsEndpoint(): string {
  return `${getOmnirouteBaseUrl().replace(/\/+$/, '')}/models`;
}

function isChatModel(model: OmnirouteModelRaw): boolean {
  // Skip explicit non-chat model types (video, image, audio, embedding, rerank, moderation).
  const type = typeof model.type === 'string' ? model.type.toLowerCase() : '';
  if (
    type === 'video' ||
    type === 'image' ||
    type === 'audio' ||
    type === 'embedding' ||
    type === 'embeddings' ||
    type === 'rerank' ||
    type === 'moderation' ||
    type === 'tts' ||
    type === 'stt'
  ) {
    return false;
  }

  const id = typeof model.id === 'string' ? model.id.toLowerCase() : '';
  if (
    id.includes('/embed') ||
    id.includes('-embed') ||
    id.includes('embedding') ||
    id.includes('/rerank') ||
    id.includes('-rerank') ||
    id.includes('/tts') ||
    id.includes('/stt') ||
    id.includes('whisper') ||
    id.includes('/moderation')
  ) {
    return false;
  }

  // If modalities are present, require text input.
  if (Array.isArray(model.input_modalities)) {
    const modalities = model.input_modalities
      .filter((mod): mod is string => typeof mod === 'string')
      .map((mod) => mod.toLowerCase());
    if (modalities.length > 0) {
      return modalities.includes('text');
    }
  }

  // No modality info — most Omniroute models are chat models.
  return true;
}

function supportsVision(model: OmnirouteModelRaw): boolean {
  if (model.capabilities?.vision === true) {
    return true;
  }
  if (Array.isArray(model.input_modalities)) {
    return model.input_modalities.some((mod) => typeof mod === 'string' && mod.toLowerCase() === 'image');
  }
  return false;
}

function supportsTools(model: OmnirouteModelRaw): boolean {
  return model.capabilities?.tool_calling === true;
}

export function rawModelSupportsThinking(model: OmnirouteModelRaw, id: string): boolean {
  const realId = stripNoThinkingPrefix(id);
  if (model.capabilities?.thinking === true || model.capabilities?.reasoning === true || model.capabilities?.supportsThinking === true) {
    return true;
  }
  return idLikelySupportsThinking(realId);
}
export { rawModelSupportsThinking as modelRawSupportsThinking };

function toDisplayName(raw: OmnirouteModelRaw, id: string): string {
  const realId = stripNoThinkingPrefix(id);
  let display: string;
  if (typeof raw.name === 'string' && raw.name.trim().length > 0) {
    display = raw.name.trim();
  } else if (realId.includes('/')) {
    const [prefix, ...rest] = realId.split('/');
    const namePart = rest.join('/');
    const formattedPrefix = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    const formattedName = namePart
      .split(/[-:_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    display = `${formattedPrefix} · ${formattedName}`;
  } else {
    display = realId
      .split(/[-:_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  return isNoThinkingVariant(id) ? `${display} (No-thinking)` : display;
}

/**
 * VS Code's Language Model API interprets `/` as a vendor/family separator
 * (Copilot's own IDs use the form `copilot/<family>`), so model IDs containing
 * slashes are silently dropped from the Copilot Chat model picker. Omniroute
 * returns IDs like `auto/best-coding`, `pepper/pepper-1`, `oc/mimo-auto`, etc.,
 * so we must encode the slashes before exposing the model and decode them
 * again before forwarding the request to the local server.
 *
 * `__` (double underscore) is safe and reversible: no Omniroute model id
 * contains `__` natively, so the encoding is unambiguous.
 */
export function encodeOmnirouteModelId(id: string): string {
  return id.replaceAll('/', '__');
}

export function decodeOmnirouteModelId(id: string): string {
  return id.replaceAll('__', '/');
}

/**
 * Convert a VS Code-facing (encoded) OmniRoute model id into the id that should
 * be sent to the server: decode the slash encoding and resolve no-thinking
 * variants back to the real `<provider>/<model>` id (reasoning is then
 * suppressed client-side by `supportsThinking`).
 */
export function resolveOmnirouteUpstreamModelId(encodedId: string): string {
  return stripNoThinkingPrefix(decodeOmnirouteModelId(encodedId));
}

function toModelInfo(raw: OmnirouteModelRaw, originalId: string): vscode.LanguageModelChatInformation {
  const maxInput = typeof raw.max_input_tokens === 'number'
    ? raw.max_input_tokens
    : typeof raw.context_length === 'number'
      ? raw.context_length
      : 128000;
  const maxOutput = typeof raw.max_output_tokens === 'number' ? raw.max_output_tokens : 8192;

  // Remember upstream capabilities so the request client can honor them
  // (e.g. omit `temperature` for models that do not support it).
  registerOmnirouteModelCapabilities(originalId, raw.capabilities);

  return {
    id: encodeOmnirouteModelId(originalId),
    name: toDisplayName(raw, originalId),
    family: 'omniroute',
    version: originalId,
    tooltip: isNoThinkingVariant(originalId) ? 'Omniroute · No-thinking' : 'Omniroute',
    detail: isNoThinkingVariant(originalId) ? 'Omniroute · No-thinking' : 'Omniroute',
    maxInputTokens: maxInput,
    maxOutputTokens: maxOutput,
    capabilities: {
      imageInput: supportsVision(raw),
      toolCalling: supportsTools(raw),
    },
  };
}

export async function fetchOmnirouteModels(
  apiKey?: string,
  token?: vscode.CancellationToken,
): Promise<vscode.LanguageModelChatInformation[]> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 8000);
  const cancellationDisposable = token?.onCancellationRequested(() => abortController.abort());

  try {
    const endpoint = getModelsEndpoint();
    console.log(`[Omniroute] Fetching models from ${endpoint}`);
    const headers: Record<string, string> = {};
    const key = (apiKey && apiKey.trim().length > 0) ? apiKey.trim() : 'omniroute';
    headers['Authorization'] = `Bearer ${key}`;

    const response = await fetch(endpoint, {
      headers,
      signal: abortController.signal,
    });

    console.log(`[Omniroute] Models endpoint returned HTTP ${response.status}`);
    if (!response.ok) {
      throw new Error(`Omniroute models request failed with HTTP ${response.status}`);
    }

    const json = (await response.json()) as OmnirouteModelsResponse;
    const rawCount = Array.isArray(json.data) ? json.data.length : 0;
    const models = Array.isArray(json.data)
      ? json.data
        .filter((model) => model && typeof model.id === 'string' && isChatModel(model))
        .map((model) => toModelInfo(model, model.id as string))
      : [];

    console.log(`[Omniroute] Parsed ${rawCount} models, ${models.length} chat-capable after filter`);
    if (!models.length) {
      throw new Error('Omniroute did not return any chat-capable models');
    }

    return models;
  } finally {
    clearTimeout(timeout);
    cancellationDisposable?.dispose();
  }
}

/**
 * Heuristic to enable thinking on model IDs that we know have thinking capability.
 * Operates on the *original* (unencoded) id so the regex stays meaningful.
 */
function idLikelySupportsThinking(originalId: string): boolean {
  return /thinking|reasoning|reason|cogito|qwq|deepseek-r1/i.test(originalId);
}

export class OmnirouteChatProvider extends BaseChatProvider {
  protected override readonly baseURL = CHAT_BASE_URL;
  protected override readonly providerDisplayName = 'Omniroute';
  protected override readonly models: vscode.LanguageModelChatInformation[] = [];

  private thinkingModelIds = new Set<string>();
  private modelCache?: vscode.LanguageModelChatInformation[];
  private modelCacheExpiresAt = 0;
  private inflightFetch?: Promise<vscode.LanguageModelChatInformation[]>;
  private retryTimer?: NodeJS.Timeout;
  private retryDelayMs = 10000;

  constructor(authManager: BaseAuthManager) {
    super(authManager);
    this.authManager.onDidChangeApiKey(() => {
      this.invalidateModelCache();
    });
    // Refetch when the base URL / cache TTL settings change.
    onDidChangeOmnirouteConfig(() => {
      this.invalidateModelCache();
    });
    void this.warmup();
  }

  public invalidateModelCache(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.retryDelayMs = 10000;
    this.modelCache = undefined;
    this.modelCacheExpiresAt = 0;
    this.inflightFetch = undefined;
    void this.warmup();
  }

  private scheduleDiscoveryRetry(): void {
    if (this.retryTimer) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.warmup();
    }, this.retryDelayMs);
    // Exponential backoff up to 60s
    this.retryDelayMs = Math.min(this.retryDelayMs * 1.5, 60000);
  }

  protected override getApiClient(apiKey: string): OmnirouteApiClient {
    return new OmnirouteApiClient(apiKey);
  }

  /**
   * VS Code calls us with the encoded id (e.g. `auto__best-coding`). Strip
   * the encoding before forwarding to the local Omniroute server, and resolve
   * no-thinking variants back to the real upstream id.
   */
  protected override mapModelId(modelId: string): string {
    return stripNoThinkingPrefix(decodeOmnirouteModelId(modelId));
  }

  protected override supportsThinking(modelId: string): boolean {
    const decoded = decodeOmnirouteModelId(modelId);
    if (isNoThinkingVariant(decoded)) {
      return false;
    }
    return this.thinkingModelIds.has(decoded);
  }

  protected override getThinkingOption(
    _modelId: string,
    _options: vscode.ProvideLanguageModelChatResponseOptions,
  ): ThinkingOption | undefined {
    void _modelId;
    void _options;
    // Omit custom Anthropic-style 'thinking' payload for local OpenAI-compatible endpoint.
    return undefined;
  }

  /**
   * Eagerly populate the model cache.
   */
  async warmup(): Promise<void> {
    const apiKey = (await this.authManager.getApiKey()) || 'omniroute';
    try {
      await this.fetchAndCache(apiKey);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      console.warn(`[Omniroute] Auto model discovery failed: ${details}. Retrying in ${Math.round(this.retryDelayMs / 1000)}s...`);
      this.scheduleDiscoveryRetry();
    }
  }

  private async fetchAndCache(apiKey: string): Promise<vscode.LanguageModelChatInformation[]> {
    if (this.inflightFetch) {
      return this.inflightFetch;
    }
    this.inflightFetch = (async () => {
      const models = await fetchOmnirouteModels(apiKey);
      this.thinkingModelIds = new Set(
        models
          .map((m) => decodeOmnirouteModelId(m.id))
          .map((origId) => stripNoThinkingPrefix(origId))
          .filter((origId) => idLikelySupportsThinking(origId)),
      );
      this.modelCache = models;
      this.modelCacheExpiresAt = Date.now() + getOmnirouteConfig().modelCacheTtlMs;
      this.retryDelayMs = 10000;
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
      }
      this.fireModelInformationChanged();
      return models;
    })();
    try {
      return await this.inflightFetch;
    } finally {
      this.inflightFetch = undefined;
    }
  }

  private async getModels(
    apiKey: string,
    token?: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const now = Date.now();
    if (this.modelCache && now < this.modelCacheExpiresAt) {
      return this.modelCache;
    }
    try {
      return await this.fetchAndCache(apiKey);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      console.warn(`[Omniroute] Live model discovery failed (${details}).`);
      this.scheduleDiscoveryRetry();
      return this.modelCache ?? [];
    }
    void token;
  }

  override async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    void options;
    const apiKey = (await this.authManager.getApiKey()) || 'omniroute';
    return this.getModels(apiKey, token);
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
      await this.streamResponse(
        this.getOrCreateClient(apiKey),
        model,
        messages,
        options,
        progress,
        token,
      );
    } catch (error) {
      this.throwMappedError(error);
    }
  }

  protected override readonly errorMessages: Record<number, string> = {
    400: 'Invalid request format. Check parameters and message format.',
    401: 'Omniroute server rejected the request. Check that the local server is running.',
    403: 'Access denied. The requested upstream model may require credentials that Omniroute does not have.',
    404: 'Model not found. Pick a different Omniroute model.',
    413: 'Request payload too large for Omniroute or the upstream model. Reduce context or attachments.',
    421: 'Request blocked by content filter. Avoid unsafe or sensitive content.',
    429: 'Rate limit reached. Please wait and try again.',
    500: 'Omniroute server error. Please try again later.',
    502: 'Omniroute upstream provider error. The underlying model may be unavailable.',
    503: 'Omniroute server overloaded. Please try again later.',
    504: 'Omniroute upstream provider timed out. The underlying model may be slow or unavailable.',
  };
}
