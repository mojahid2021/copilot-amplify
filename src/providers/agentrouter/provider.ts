import type * as vscode from 'vscode';
import { AnthropicApiClient } from '../../core/api/anthropicClient';
import type { BaseAuthManager } from '../../core/auth/authManager';
import { convertMessagesToAnthropic, convertToolsToAnthropic } from '../../core/context/anthropicConverter';
import { prepareContextMessages } from '../../core/context/contextManager';
import { convertTools } from '../../core/context/converter';
import { getGlobalConfig } from '../../core/globalConfig';
import { getModelOption, getNumberModelOption } from '../../core/provider/baseChatProvider';
import { DynamicCatalogProvider } from '../../core/provider/dynamicCatalogProvider';
import type { ConnectionTestResult } from '../../core/provider/registry';
import type { ThinkingOption } from '../../core/api/client';
import { buildAgentrouterCatalog, resolveAgentrouterTransport } from './catalog';
import {
  getAgentrouterAnthropicBaseUrl,
  getAgentrouterConfig,
  getAgentrouterOpenaiBaseUrl,
  onDidChangeAgentrouterConfig,
} from './config';
import { testAgentrouterConnection } from './connectionTest';
import { AGENTROUTER_DISPLAY_NAME } from './descriptor';
import { fetchAgentrouterPricingFromConfig, type AgentrouterEndpointType } from './discovery';

/** Budget for Claude's extended thinking when reasoning is on. */
const THINKING_BUDGET_TOKENS = 1024;

/**
 * AgentRouter: one API key, two wire protocols.
 *   - Claude models → native Anthropic `POST /v1/messages`
 *   - everything else → OpenAI-compatible `POST /v1/chat/completions`
 *
 * The model list (and which protocol each model speaks) comes from
 * `GET /api/pricing`.
 */
export class AgentrouterChatProvider extends DynamicCatalogProvider {
  protected override readonly providerDisplayName = AGENTROUTER_DISPLAY_NAME;
  protected override readonly errorMessages: Record<number, string> = {
    421: "The request was blocked by AgentRouter's content filter. Try rephrasing it.",
    502: 'The model behind AgentRouter is unavailable right now. Try again, or pick another model.',
    504: 'The model behind AgentRouter took too long to respond. Try again, or pick another model.',
  };

  private transportByModel = new Map<string, AgentrouterEndpointType>();
  private anthropicClient?: { apiKey: string; client: AnthropicApiClient };

  constructor(authManager: BaseAuthManager, state: vscode.Memento) {
    const config = getAgentrouterConfig();
    super(authManager, {
      cacheTtlMs: config.cacheTtlMs,
      warmupOnStartup: config.warmupOnStartup,
      onDidChangeConfig: onDidChangeAgentrouterConfig,
      persist: { state, key: 'models.agentrouter' },
    });
  }

  /** Base URL of the OpenAI-compatible side; the Anthropic client has its own. */
  protected override get baseURL(): string {
    return getAgentrouterOpenaiBaseUrl();
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const apiKey = await this.authManager.getApiKey();
    return testAgentrouterConnection({ baseUrl: getAgentrouterOpenaiBaseUrl(), apiKey });
  }

  override refreshCaches(): void {
    super.refreshCaches();
    this.transportByModel.clear();
    this.anthropicClient = undefined;
  }

  protected override async canLoadModels(): Promise<boolean> {
    return Boolean(await this.authManager.getApiKey());
  }

  protected override async fetchModels(signal?: AbortSignal): Promise<vscode.LanguageModelChatInformation[]> {
    const apiKey = await this.authManager.getApiKey();
    const discovered = await fetchAgentrouterPricingFromConfig({ apiKey, signal });
    if (!discovered.size) {
      throw new Error('AgentRouter did not return any chat-capable models');
    }
    this.transportByModel = new Map(
      [...discovered.values()].map((model) => [model.id, resolveAgentrouterTransport(model)]),
    );
    return buildAgentrouterCatalog(discovered.values());
  }

  protected override modelSupportsReasoning(modelId: string): boolean {
    return this.transportOf(modelId) === 'anthropic';
  }

  /** Claude gets `thinking` through the Anthropic transport; the OpenAI side takes `reasoning_effort`. */
  protected override getThinkingOption(): ThinkingOption | undefined {
    return undefined;
  }

  protected override supportsThinking(modelId: string): boolean {
    return this.transportOf(modelId) === 'anthropic';
  }

  /** AgentRouter needs a key; fail fast instead of prompting mid-request. */
  protected override async resolveApiKey(): Promise<string> {
    const apiKey = await this.authManager.getApiKey();
    if (!apiKey) {
      throw new Error('API key not configured. Use the Manage command for AgentRouter.');
    }
    return apiKey;
  }

  protected override sendChatRequest(
    apiKey: string,
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    return this.transportOf(model.id) === 'anthropic'
      ? this.streamAnthropicResponse(apiKey, model, messages, options, progress, token)
      : super.sendChatRequest(apiKey, model, messages, options, progress, token);
  }

  /** Before a live load (e.g. a list saved by the last session), guess from the id. */
  private transportOf(modelId: string): AgentrouterEndpointType {
    return this.transportByModel.get(modelId) ?? (modelId.toLowerCase().startsWith('claude-') ? 'anthropic' : 'openai');
  }

  private async streamAnthropicResponse(
    apiKey: string,
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const maxTokens = getNumberModelOption(options, 'maxTokens') ?? model.maxOutputTokens ?? 4096;
    const prepared = prepareContextMessages(messages, model.capabilities.imageInput === true, {
      maxInputTokens: model.maxInputTokens ?? 128_000,
      reserveOutputTokens: maxTokens,
    });
    const { system, messages: anthropicMessages } = convertMessagesToAnthropic(prepared);
    const tools = convertToolsToAnthropic(model.capabilities.toolCalling ? convertTools(options.tools) : undefined);
    const reasoning = getGlobalConfig().enableReasoning && getModelOption(options, 'reasoningEffort') !== 'none';

    const { reported, error } = await this.consumeChatStream(
      this.getAnthropicClient(apiKey).streamChat(
        model.id,
        system,
        anthropicMessages,
        {
          maxTokens,
          ...(tools ? { tools } : {}),
          ...(reasoning ? { thinking: { type: 'enabled' as const, budget_tokens: THINKING_BUDGET_TOKENS } } : {}),
        },
        token,
      ),
      model.id,
      progress,
      token,
    );

    // The native transport has no non-streaming fallback.
    if (!reported && error) {
      throw error;
    }
  }

  private getAnthropicClient(apiKey: string): AnthropicApiClient {
    const key = apiKey.trim();
    if (this.anthropicClient?.apiKey !== key) {
      this.anthropicClient = {
        apiKey: key,
        client: new AnthropicApiClient(key, getAgentrouterAnthropicBaseUrl(), AGENTROUTER_DISPLAY_NAME, 1.0, {
          timeoutMs: getAgentrouterConfig().requestTimeoutMs,
        }),
      };
    }
    return this.anthropicClient.client;
  }
}
