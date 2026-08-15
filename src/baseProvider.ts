// Moved ConfigurableChatProvider to bottom
import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions';
import * as vscode from 'vscode';
import { ApiError, GenericApiClient, type ReasoningEffort, type ThinkingOption } from './baseApi';
import type { BaseAuthManager } from './baseAuth';
import { convertMessages, convertTools, parseToolArguments } from './converter';
import { type ThinkingState, processThinkingContent } from './thinking';
import { prepareContextMessages, estimateMessageTokens } from './contextManager';
import { executeWithRetry } from './retryHandler';

interface ToolCallBuilder {
  id: string;
  name: string;
  arguments: string;
}



type LanguageModelThinkingPartCtor = new (
  value: string | string[],
  id?: string,
  metadata?: { readonly [key: string]: unknown },
) => vscode.LanguageModelResponsePart;

interface VscodeWithThinkingPart {
  LanguageModelThinkingPart?: LanguageModelThinkingPartCtor;
}

interface ResponseOptionsWithModelConfiguration extends vscode.ProvideLanguageModelChatResponseOptions {
  readonly modelConfiguration?: { readonly [name: string]: unknown };
}

const STRUCTURED_THINKING_OPEN = '<details><summary>Thinking</summary>\n\n';
const STRUCTURED_THINKING_CLOSE = '\n\n</details>\n\n';

function getThinkingPartCtor(): LanguageModelThinkingPartCtor | undefined {
  return (vscode as typeof vscode & VscodeWithThinkingPart).LanguageModelThinkingPart;
}

function escapeMarkdownHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function getModelOption(
  options: vscode.ProvideLanguageModelChatResponseOptions,
  name: string,
): unknown {
  return (options as ResponseOptionsWithModelConfiguration).modelConfiguration?.[name]
    ?? options.modelOptions?.[name];
}

function getNumberModelOption(
  options: vscode.ProvideLanguageModelChatResponseOptions,
  name: string,
): number | undefined {
  const value = getModelOption(options, name);
  return typeof value === 'number' ? value : undefined;
}

export abstract class BaseChatProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
  protected abstract readonly baseURL: string;
  protected abstract readonly providerDisplayName: string;
  protected abstract readonly errorMessages: Record<number, string>;
  protected abstract readonly models: vscode.LanguageModelChatInformation[];

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void> = this.changeEmitter.event;

  /**
   * Subclasses call this after their internal model list changes (for
   * example after a dynamic model discovery fetch completes) so VS Code
   * re-queries the model list and refreshes the Copilot Chat picker.
   */
  protected fireModelInformationChanged(): void {
    this.changeEmitter.fire();
  }

  private clientCache = new Map<string, GenericApiClient>();

  protected mapModelId(modelId: string): string {
    return modelId;
  }

  protected supportsThinking(_modelId: string): boolean {
    void _modelId;
    return false;
  }

  protected getThinkingOption(
    modelId: string,
    options: vscode.ProvideLanguageModelChatResponseOptions,
  ): ThinkingOption | undefined {
    if (!this.supportsThinking(modelId)) {
      return undefined;
    }

    const isGlobalReasoningEnabled = vscode.workspace.getConfiguration('copilot-amplify').get<boolean>('enableReasoning', true);

    const reasoningEffort = getModelOption(options, 'reasoningEffort');
    if (!isGlobalReasoningEnabled || reasoningEffort === 'none') {
      return { type: 'disabled', clear_thinking: true };
    }

    return { type: 'enabled', clear_thinking: true };
  }

  protected getExtraBody(_modelId?: string): Record<string, unknown> | undefined {
    void _modelId;
    return undefined;
  }

  protected getReasoningEffort(
    modelId: string,
    options: vscode.ProvideLanguageModelChatResponseOptions,
  ): ReasoningEffort | undefined {
    if (!this.supportsThinking(modelId)) {
      return undefined;
    }

    const isGlobalReasoningEnabled = vscode.workspace.getConfiguration('copilot-amplify').get<boolean>('enableReasoning', true);
    if (!isGlobalReasoningEnabled) {
      return undefined; // Usually undefined means default, but the provider might interpret setting no reasoning effort when thinking is disabled
    }

    return this.toReasoningEffort(getModelOption(options, 'reasoningEffort'));
  }

  protected toReasoningEffort(value: unknown): ReasoningEffort | undefined {
    if (value === 'none') {
      return undefined;
    }

    if (value === 'max' || value === 'xhigh' || value === 'ultracode') {
      return 'max';
    }

    return 'high';
  }

  private readonly _disposables: vscode.Disposable[] = [];

  constructor(protected readonly authManager: BaseAuthManager) {
    this._disposables.push(
      this.changeEmitter,
      this.authManager.onDidChangeApiKey(() => {
        this.clientCache.clear();
        this.fireModelInformationChanged();
      })
    );
  }

  public dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
  }

  protected getApiClient(apiKey: string): GenericApiClient {
    return new GenericApiClient(apiKey, this.baseURL, this.providerDisplayName);
  }

  protected getOrCreateClient(apiKey: string): GenericApiClient {
    let client = this.clientCache.get(apiKey);
    if (!client) {
      client = this.getApiClient(apiKey);
      this.clientCache.set(apiKey, client);
    }
    return client;
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    void token;

    const apiKey = await this.authManager.getApiKey();
    if (apiKey) {
      return this.models;
    }

    if (!options.silent) {
      await this.authManager.promptForApiKey();
      const newKey = await this.authManager.getApiKey();
      if (newKey) {
        return this.models;
      }
    }

    return [];
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey = await this.authManager.getOrPromptApiKey();

    if (!apiKey) {
      throw new Error(`API key not configured. Use the Manage command for ${this.providerDisplayName}.`);
    }

    try {
      await executeWithRetry(
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

  provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken,
  ): Thenable<number> {
    void token;

    if (typeof text === 'string') {
      return Promise.resolve(Math.ceil(text.length / 3.8));
    }

    const converted = convertMessages([text], true);
    let total = 0;
    for (const msg of converted) {
      total += estimateMessageTokens(msg);
    }

    return Promise.resolve(total);
  }

  protected async streamResponse(
    client: GenericApiClient,
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const toolCallBuilders = new Map<number, ToolCallBuilder>();
    let thinkingState: ThinkingState = { buffer: '', insideThinking: false };
    let structuredReasoningActive = false;
    let hasReportedAnyPart = false;

    const maxTokensOption = getNumberModelOption(options, 'maxTokens');
    const preparedMessages = prepareContextMessages(
      messages,
      model.capabilities.imageInput === true,
      {
        maxInputTokens: model.maxInputTokens ?? 128000,
        reserveOutputTokens: maxTokensOption ?? model.maxOutputTokens ?? 4096,
      },
    );

    const startTime = Date.now();
    let ttft: number | undefined;
    let tokenCount = 0;

    const stream = client.streamChat(
      this.mapModelId(model.id),
      preparedMessages,
      {
        maxTokens: maxTokensOption,
        tools: model.capabilities.toolCalling ? convertTools(options.tools) : undefined,
        toolChoice:
          model.capabilities.toolCalling && options.tools?.length
            ? options.toolMode === vscode.LanguageModelChatToolMode.Required
              ? 'required'
              : 'auto'
            : undefined,
        thinking: this.getThinkingOption(model.id, options),
        reasoningEffort: this.getReasoningEffort(model.id, options),
        extraBody: this.getExtraBody(model.id),
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
        const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content
          : typeof delta.reasoning === 'string' ? delta.reasoning
          : typeof delta.thought === 'string' ? delta.thought
          : typeof delta.thinking === 'string' ? delta.thinking
          : typeof delta.reasoning_text === 'string' ? delta.reasoning_text
          : undefined;

        if (reasoning) {
          if (ttft === undefined) {
            ttft = Date.now() - startTime;
          }
          this.reportStructuredReasoningDelta(reasoning, structuredReasoningActive, progress);
          structuredReasoningActive = true;
          hasReportedAnyPart = true;
        }

        const content = typeof choice.delta.content === 'string' ? choice.delta.content
          : typeof delta.text === 'string' ? delta.text
          : undefined;

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
            tokenCount++;
          }
          hasReportedAnyPart = true;
        }

        this.collectToolCalls(choice.delta.tool_calls, toolCallBuilders);
        if (choice.finish_reason === 'tool_calls') {
          if (structuredReasoningActive) {
            this.closeStructuredReasoning(progress);
            structuredReasoningActive = false;
          }
          this.reportToolCalls(progress, toolCallBuilders);
          hasReportedAnyPart = true;
        }
      }
    }

    if (thinkingState.buffer.length > 0) {
      progress.report(new vscode.LanguageModelTextPart(thinkingState.buffer));
      thinkingState.buffer = '';
    }

    if (structuredReasoningActive) {
      this.closeStructuredReasoning(progress);
    }

    this.reportToolCalls(progress, toolCallBuilders);

    const totalTimeSec = (Date.now() - startTime) / 1000;
    const tps = totalTimeSec > 0 ? (tokenCount / totalTimeSec).toFixed(1) : '0';
    console.log(
      `[${this.providerDisplayName}] Stream complete (${model.id}): TTFT=${ttft ?? 0}ms, Tokens=${tokenCount}, Speed=${tps} tok/s`
    );

    if (!hasReportedAnyPart && !token.isCancellationRequested) {
      console.warn(`[${this.providerDisplayName}] Streaming yielded no parts. Retrying with non-streaming completion...`);
      const fallbackContent = await client.chatNonStreaming(
        this.mapModelId(model.id),
        preparedMessages,
        {
          maxTokens: maxTokensOption,
          tools: model.capabilities.toolCalling ? convertTools(options.tools) : undefined,
          extraBody: this.getExtraBody(model.id),
        },
      );

      if (fallbackContent && fallbackContent.trim().length > 0) {
        progress.report(new vscode.LanguageModelTextPart(fallbackContent));
      }
    }
  }

  private reportStructuredReasoningDelta(
    reasoning: string,
    isActive: boolean,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  ): void {
    if (!reasoning) {
      return;
    }

    const ThinkingPart = getThinkingPartCtor();
    if (ThinkingPart) {
      progress.report(new ThinkingPart(reasoning));
      return;
    }

    if (!isActive) {
      progress.report(new vscode.LanguageModelTextPart(STRUCTURED_THINKING_OPEN));
    }

    progress.report(new vscode.LanguageModelTextPart(escapeMarkdownHtml(reasoning)));
  }

  private closeStructuredReasoning(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  ): void {
    const ThinkingPart = getThinkingPartCtor();
    if (ThinkingPart) {
      progress.report(new ThinkingPart('', '', { vscode_reasoning_done: true }));
      return;
    }

    progress.report(new vscode.LanguageModelTextPart(STRUCTURED_THINKING_CLOSE));
  }

  private collectToolCalls(
    toolCalls: ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined,
    builders: Map<number, ToolCallBuilder>,
  ): void {
    if (!toolCalls?.length) {
      return;
    }

    for (const call of toolCalls) {
      const builder = builders.get(call.index) ?? { id: '', name: '', arguments: '' };

      if (call.id) {
        builder.id = call.id;
      }
      if (call.function?.name) {
        builder.name = call.function.name;
      }
      if (call.function?.arguments) {
        builder.arguments += call.function.arguments;
      }

      builders.set(call.index, builder);
    }
  }

  private reportToolCalls(
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    builders: Map<number, ToolCallBuilder>,
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

  protected throwUserError(message: string): never {
    const error = new Error(message);
    error.stack = error.stack?.split('\n').slice(1).join('\n');
    throw error;
  }

  protected throwMappedError(error: unknown): never {
    if (!(error instanceof ApiError)) {
      throw error;
    }

    if (error.statusCode === 401) {
      void this.authManager.deleteApiKey();
    }

    const message =
      this.errorMessages[error.statusCode] ?? `${this.providerDisplayName} API error: ${error.message}`;
    this.throwUserError(message);
  }
}

export interface ConfigurableChatProviderOptions {
  baseURL: string;
  providerDisplayName: string;
  models: vscode.LanguageModelChatInformation[];
  errorMessages?: Record<number, string>;
  mapModelId?: (modelId: string) => string;
  supportsThinking?: boolean | ((modelId: string) => boolean);
}

export class ConfigurableChatProvider extends BaseChatProvider {
  protected override readonly baseURL: string;
  protected override readonly providerDisplayName: string;
  protected override readonly models: vscode.LanguageModelChatInformation[];
  protected override readonly errorMessages: Record<number, string>;

  private readonly _mapModelId?: (modelId: string) => string;
  private readonly _supportsThinking?: boolean | ((modelId: string) => boolean);

  constructor(authManager: BaseAuthManager, options: ConfigurableChatProviderOptions) {
    super(authManager);
    this.baseURL = options.baseURL;
    this.providerDisplayName = options.providerDisplayName;
    this.models = options.models;
    this.errorMessages = options.errorMessages || {};
    this._mapModelId = options.mapModelId;
    this._supportsThinking = options.supportsThinking;
  }

  protected override mapModelId(modelId: string): string {
    return this._mapModelId ? this._mapModelId(modelId) : modelId;
  }

  protected override supportsThinking(modelId: string): boolean {
    if (typeof this._supportsThinking === 'function') {
      return this._supportsThinking(modelId);
    }
    return this._supportsThinking ?? false;
  }
}
