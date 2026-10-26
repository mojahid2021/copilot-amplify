/**
 * AgentRouter chat provider.
 *
 * First-class provider sibling of Xiaomi, Z.ai, Groq, NVIDIA NIM and
 * OmniRoute. Surfaces the AgentRouter gateway with one API key and a
 * per-model transport:
 *
 *   - Claude models (`claude-*`) go through the native Anthropic
 *     `messages` API at `https://agentrouter.org/v1/messages`.
 *   - Everything else (GPT, GLM, DeepSeek, etc.) goes through the
 *     OpenAI-compatible chat completions endpoint at
 *     `https://agentrouter.org/v1/chat/completions`.
 *
 * The model catalog is discovered dynamically from
 * `GET {baseUrl}/api/pricing` and cached with a TTL.
 */

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
import { AnthropicApiClient } from '../../core/api/anthropicClient';
import { convertMessagesToAnthropic, convertToolsToAnthropic } from '../../core/context/anthropicConverter';
import { convertTools, parseToolArguments } from '../../core/context/converter';
import { prepareContextMessages } from '../../core/context/contextManager';
import { processThinkingContent, type ThinkingState } from '../../core/thinking/thinking';
import { logger } from '../../core/logging/logger';
import {
  getAgentrouterAnthropicBaseUrl,
  getAgentrouterConfig,
  getAgentrouterOpenaiBaseUrl,
  onDidChangeAgentrouterConfig,
} from './config';
import { fetchAgentrouterPricingFromConfig } from './discovery';
import {
  buildAgentrouterCatalog,
  resolveAgentrouterTransport,
} from './catalog';
import { testAgentrouterConnection } from './connectionTest';
import {
  AGENTROUTER_DISPLAY_NAME,
  AGENTROUTER_SETTINGS_SECTION,
} from './descriptor';
import { getGlobalConfig } from '../../core/globalConfig';

const log = logger.child({ provider: AGENTROUTER_DISPLAY_NAME });

interface AnthropicToolCallBuilder {
  id: string;
  name: string;
  arguments: string;
}

export class AgentrouterChatProvider extends BaseChatProvider implements AmplifyProviderFacet {
  protected override get baseURL(): string {
    // Used only by OpenAI-side transport (GenericApiClient construction).
    return getAgentrouterOpenaiBaseUrl();
  }
  protected override readonly providerDisplayName = AGENTROUTER_DISPLAY_NAME;
  protected override readonly models: vscode.LanguageModelChatInformation[] = [];

  private readonly modelCache: TTLCache<vscode.LanguageModelChatInformation[]>;
  private transportByModel = new Map<string, 'anthropic' | 'openai'>();
  private lastDiscoveryError?: string;
  private lastDiscoveryStatus?: number;
  private lastConnectionTest?: { ok: boolean; message: string; latencyMs?: number; at: number };
  private lastKnownModelIds: ReadonlySet<string> = new Set();

  /** Per-API-key client caches. Bounded by the base class — see `BaseChatProvider.clientCache`. */
  private readonly anthropicClientCache = new Map<string, AnthropicApiClient>();

  constructor(authManager: BaseAuthManager) {
    super(authManager);
    this.modelCache = new TTLCache<vscode.LanguageModelChatInformation[]>(getAgentrouterConfig().cacheTtlMs);
    this.authManager.onDidChangeApiKey(() => {
      this.invalidateModelCache();
      this.anthropicClientCache.clear();
    });
    onDidChangeAgentrouterConfig(() => {
      this.invalidateModelCache();
      this.anthropicClientCache.clear();
    });
    maybeWarmup(this);
  }

  public invalidateModelCache(): void {
    this.modelCache.invalidateAll();
    this.transportByModel.clear();
    this.lastDiscoveryError = undefined;
    this.lastKnownModelIds = new Set();
  }

  /** ── AmplifyProviderFacet ─────────────────────────────────────────────── */

  async testConnection(): Promise<ConnectionTestResult> {
    const apiKey = (await this.authManager.getApiKey()) ?? '';
    const result = await testAgentrouterConnection({
      baseUrl: getAgentrouterOpenaiBaseUrl(),
      ...(apiKey ? { apiKey } : {}),
    });
    this.lastConnectionTest = { ...result, at: Date.now() };
    return result;
  }

  async listModelsForTree(): Promise<ProviderTreeModel[]> {
    const cached = this.modelCache.peek('models') ?? [];
    return cached.map((info) => ({
      id: info.id,
      name: info.name,
      capabilities: {
        imageInput: info.capabilities.imageInput,
        toolCalling: info.capabilities.toolCalling,
      },
      maxInputTokens: info.maxInputTokens,
      maxOutputTokens: info.maxOutputTokens,
      supportsReasoning: this.transportByModel.get(info.id) === 'anthropic',
    }));
  }

  refreshCaches(): void {
    this.invalidateModelCache();
  }

  health(): ProviderHealth {
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

  private async discoverAndCache(): Promise<vscode.LanguageModelChatInformation[]> {
    try {
      const models = await this.modelCache.getOrFetch('models', async (signal) => {
        const apiKey = (await this.authManager.getApiKey()) || undefined;
        const discovered = await fetchAgentrouterPricingFromConfig({
          ...(apiKey ? { apiKey } : {}),
          ...(signal ? { signal } : {}),
        });
        if (!discovered.size) {
          throw new Error('AgentRouter did not return any chat-capable models');
        }
        this.transportByModel = new Map<string, 'anthropic' | 'openai'>();
        for (const [id, raw] of discovered.entries()) {
          this.transportByModel.set(id, resolveAgentrouterTransport(raw));
        }
        return buildAgentrouterCatalog(discovered.values());
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
    // AgentRouter requires an API key — never attempt discovery without one.
    const apiKey = await this.authManager.getApiKey();
    if (!apiKey) {
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

  override dispose(): void {
    this.anthropicClientCache.clear();
    super.dispose();
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
    const apiKey = await this.authManager.getApiKey();
    if (!apiKey) {
      throw new Error('API key not configured. Use the Manage command for AgentRouter.');
    }

    const transport = this.transportByModel.get(model.id) ?? resolveTransportForModelId(model.id);

    try {
      await this.runChatOperation(async () => {
        if (transport === 'anthropic') {
          await this.streamAnthropicResponse(apiKey, model, messages, options, progress, token);
        } else {
          await this.streamResponse(
            this.getOrCreateClient(apiKey),
            model,
            messages,
            options,
            progress,
            token,
          );
        }
      }, token);
    } catch (error) {
      if (token.isCancellationRequested || (error instanceof Error && error.name === 'CancelledError')) {
        return;
      }
      this.throwMappedError(error);
    }
  }

  /** ── Hooks ──────────────────────────────────────────────────────────────── */

  protected override mapModelId(modelId: string): string {
    return modelId;
  }

  protected override supportsThinking(modelId: string): boolean {
    return this.transportByModel.get(modelId) === 'anthropic';
  }

  protected override getThinkingOption(
    modelId: string,
    _options: vscode.ProvideLanguageModelChatResponseOptions,
  ): ThinkingOption | undefined {
    void _options;
    // We forward the Anthropic `thinking` block separately in the Anthropic
    // transport path; for the OpenAI side, send `reasoning_effort` instead.
    // Returning undefined here keeps the OpenAI client from emitting a
    // non-Anthropic `thinking` field.
    if (this.transportByModel.get(modelId) === 'anthropic') {
      return undefined;
    }
    return undefined;
  }

  protected override readonly errorMessages: Record<number, string> = {
    400: 'Invalid request format. Check parameters and message format.',
    401: 'Authentication failed. Please set a new key.',
    403: 'Access denied. The API key may be restricted for this model.',
    404: 'Model not found. Pick a different AgentRouter model.',
    413: 'Request payload too large. Reduce context or attachments.',
    421: 'Request blocked by content filter. Avoid unsafe or sensitive content.',
    429: 'Rate limit reached. Please wait and try again.',
    500: 'AgentRouter server error. Please try again later.',
    502: 'AgentRouter upstream provider error. The underlying model may be unavailable.',
    503: 'AgentRouter server overloaded. Please try again later.',
    504: 'AgentRouter upstream provider timed out. The underlying model may be slow or unavailable.',
  };

  /** ── Anthropic transport path ──────────────────────────────────────────── */

  private getOrCreateAnthropicClient(apiKey: string): AnthropicApiClient {
    const key = apiKey.trim();
    const existing = this.anthropicClientCache.get(key);
    if (existing) {
      return existing;
    }
    if (this.anthropicClientCache.size >= 8) {
      const oldest = this.anthropicClientCache.keys().next();
      if (!oldest.done) {
        this.anthropicClientCache.delete(oldest.value);
      }
    }
    const client = new AnthropicApiClient(
      key,
      getAgentrouterAnthropicBaseUrl(),
      AGENTROUTER_DISPLAY_NAME,
      1.0,
      { timeoutMs: getAgentrouterConfig().requestTimeoutMs },
    );
    this.anthropicClientCache.set(key, client);
    return client;
  }

  private async streamAnthropicResponse(
    apiKey: string,
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const client = this.getOrCreateAnthropicClient(apiKey);
    const toolCallBuilders = new Map<number, AnthropicToolCallBuilder>();
    let thinkingState: ThinkingState = { buffer: '', insideThinking: false };
    let structuredReasoningActive = false;
    let hasReportedAnyPart = false;
    let streamError: unknown;

    const maxTokensOption = (() => {
      const raw = (options as { modelConfiguration?: { maxTokens?: unknown }; modelOptions?: { maxTokens?: unknown } }).modelConfiguration?.maxTokens
        ?? options.modelOptions?.maxTokens;
      return typeof raw === 'number' ? raw : undefined;
    })();
    const resolvedMaxTokens = maxTokensOption ?? model.maxOutputTokens ?? 4096;
    const perModelDefaultTemp = this.getDefaultTemperature(model.id);

    // Reuse the shared preparer so custom-system-prompt injection + context
    // truncation apply uniformly across both transports.
    const preparedMessages = prepareContextMessages(
      messages,
      model.capabilities.imageInput === true,
      {
        maxInputTokens: model.maxInputTokens ?? 128_000,
        reserveOutputTokens: resolvedMaxTokens,
      },
    );
    const converted = convertMessagesToAnthropic(preparedMessages);
    const anthropicTools = convertToolsToAnthropic(
      model.capabilities.toolCalling ? convertTools(options.tools) : undefined,
    );

    const reasoningEnabled = isReasoningEnabled(model.id, options);
    const thinking = reasoningEnabled
      ? { type: 'enabled' as const, budget_tokens: 1024 }
      : undefined;

    const startTime = Date.now();
    let ttft: number | undefined;
    let chunkCount = 0;

    try {
      const stream = client.streamChat(
        this.mapModelId(model.id),
        converted.system,
        converted.messages,
        {
          maxTokens: resolvedMaxTokens,
          ...(perModelDefaultTemp !== undefined ? { temperature: perModelDefaultTemp } : {}),
          ...(anthropicTools ? { tools: anthropicTools } : {}),
          ...(thinking ? { thinking } : {}),
        },
        token,
      );

      for await (const chunk of stream) {
        if (token.isCancellationRequested) {
          break;
        }
        if (!chunk.choices || !Array.isArray(chunk.choices)) {
          continue;
        }
        for (const choice of chunk.choices) {
          if (!choice.delta) {
            continue;
          }
          const delta = choice.delta as Record<string, unknown>;

          const reasoning = typeof delta.reasoning_content === 'string'
            ? delta.reasoning_content
            : typeof delta.thinking === 'string'
              ? delta.thinking
              : undefined;
          if (reasoning) {
            if (ttft === undefined) {
              ttft = Date.now() - startTime;
            }
            this.reportStructuredReasoningDelta(reasoning, structuredReasoningActive, progress);
            structuredReasoningActive = true;
            hasReportedAnyPart = true;
          }

          const content = typeof choice.delta.content === 'string' ? choice.delta.content : undefined;
          if (content) {
            if (ttft === undefined) {
              ttft = Date.now() - startTime;
            }
            if (structuredReasoningActive) {
              this.closeStructuredReasoning(progress);
              structuredReasoningActive = false;
            }
            const result = processThinkingContent(content, thinkingState);
            thinkingState = result.state;
            if (result.output) {
              progress.report(new vscode.LanguageModelTextPart(result.output));
              chunkCount++;
            }
            hasReportedAnyPart = true;
          }

          this.collectAnthropicToolCalls(choice.delta.tool_calls, toolCallBuilders);
          if (choice.finish_reason === 'tool_calls') {
            if (structuredReasoningActive) {
              this.closeStructuredReasoning(progress);
              structuredReasoningActive = false;
            }
            this.reportAnthropicToolCalls(progress, toolCallBuilders);
            hasReportedAnyPart = true;
          } else if (choice.finish_reason === 'stop') {
            if (structuredReasoningActive) {
              this.closeStructuredReasoning(progress);
              structuredReasoningActive = false;
            }
          }
        }
      }
    } catch (error) {
      if (hasReportedAnyPart || token.isCancellationRequested) {
        throw error;
      }
      streamError = error;
      log.warn('anthropic stream failed before producing output', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (thinkingState.buffer.length > 0) {
      progress.report(new vscode.LanguageModelTextPart(thinkingState.buffer));
      thinkingState.buffer = '';
    }
    if (structuredReasoningActive) {
      this.closeStructuredReasoning(progress);
    }
    this.reportAnthropicToolCalls(progress, toolCallBuilders);

    log.info('anthropic stream complete', {
      model: model.id,
      ttftMs: ttft ?? 0,
      chunks: chunkCount,
      totalMs: Date.now() - startTime,
    });

    if (!hasReportedAnyPart && !token.isCancellationRequested) {
      log.warn('anthropic stream yielded no parts; no fallback available for native transport');
      if (streamError) {
        throw streamError;
      }
    }
  }

  private collectAnthropicToolCalls(
    toolCalls: ReadonlyArray<{
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }> | undefined,
    builders: Map<number, AnthropicToolCallBuilder>,
  ): void {
    if (!toolCalls?.length) {
      return;
    }
    for (const call of toolCalls) {
      const index = call.index ?? 0;
      const builder = builders.get(index) ?? { id: '', name: '', arguments: '' };
      if (call.id) {
        builder.id = call.id;
      }
      if (call.function?.name) {
        builder.name = call.function.name;
      }
      if (call.function?.arguments) {
        builder.arguments += call.function.arguments;
      }
      builders.set(index, builder);
    }
  }

  private reportAnthropicToolCalls(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    builders: Map<number, AnthropicToolCallBuilder>,
  ): void {
    if (builders.size === 0) {
      return;
    }
    for (const builder of builders.values()) {
      if (!builder.id || !builder.name) {
        continue;
      }
      progress.report(
        new vscode.LanguageModelToolCallPart(
          builder.id,
          builder.name,
          parseToolArguments(builder.arguments),
        ),
      );
    }
    builders.clear();
  }

  /** Expose the resolved transport for diagnostics consumers. */
  getTransportForModel(modelId: string): 'anthropic' | 'openai' | undefined {
    return this.transportByModel.get(modelId);
  }
}

/** Resolve transport heuristically for a model id without the discovery map. */
function resolveTransportForModelId(modelId: string): 'anthropic' | 'openai' {
  return modelId.toLowerCase().startsWith('claude-') ? 'anthropic' : 'openai';
}

function isReasoningEnabled(
  _modelId: string,
  options: vscode.ProvideLanguageModelChatResponseOptions,
): boolean {
  void _modelId;
  if (!getGlobalConfig().enableReasoning) {
    return false;
  }
  const reasoningEffort = (options as { modelConfiguration?: { reasoningEffort?: unknown }; modelOptions?: { reasoningEffort?: unknown } }).modelConfiguration?.reasoningEffort
    ?? options.modelOptions?.reasoningEffort;
  return reasoningEffort !== 'none';
}

/**
 * Optional eager warmup. Deliberately NOT part of construction: activation
 * stays free of network I/O unless the user explicitly opts in.
 */
function maybeWarmup(provider: AgentrouterChatProvider): void {
  let warmupOnStartup: boolean;
  try {
    warmupOnStartup = vscode.workspace
      .getConfiguration(AGENTROUTER_SETTINGS_SECTION)
      .get<boolean>('warmupOnStartup', false);
  } catch {
    return;
  }
  if (warmupOnStartup) {
    const timer = setTimeout(() => void provider.warmupNow().catch(() => {}), 0);
    timer.unref?.();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Reasoning-rendering helpers
