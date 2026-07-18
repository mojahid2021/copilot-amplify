import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions';
import * as vscode from 'vscode';
import { ApiError, GenericApiClient, type ReasoningEffort, type ThinkingOption } from './baseApi';
import type { BaseAuthManager } from './baseAuth';
import { convertMessages, convertTools, parseToolArguments } from './converter';
import { type ThinkingState, processThinkingContent } from './thinking';

interface ToolCallBuilder {
  id: string;
  name: string;
  arguments: string;
}

interface ReasoningDelta {
  reasoning_content?: string | null;
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

function getModelOption(
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

function estimateDataPartSize(part: vscode.LanguageModelDataPart): number {
  if (
    part.mimeType.startsWith('text/')
    || part.mimeType === 'application/json'
    || part.mimeType.endsWith('+json')
  ) {
    return new TextDecoder().decode(part.data).length;
  }

  return part.data.byteLength;
}

function estimateUnknownPartSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return String(value).length;
  }
}

function estimateToolResultSize(
  parts: readonly (vscode.LanguageModelTextPart | vscode.LanguageModelPromptTsxPart | vscode.LanguageModelDataPart | unknown)[],
): number {
  let total = 0;

  for (const part of parts) {
    if (part instanceof vscode.LanguageModelTextPart) {
      total += part.value.length;
    } else if (part instanceof vscode.LanguageModelDataPart) {
      total += estimateDataPartSize(part);
    } else {
      total += estimateUnknownPartSize(part);
    }
  }

  return total;
}

export abstract class BaseChatProvider implements vscode.LanguageModelChatProvider {
  protected abstract get baseURL(): string;
  protected abstract get providerDisplayName(): string;
  protected abstract get errorMessages(): Record<number, string>;
  protected abstract get models(): vscode.LanguageModelChatInformation[];

  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void>;

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

    const reasoningEffort = getModelOption(options, 'reasoningEffort');
    return {
      type: reasoningEffort === 'none' ? 'disabled' : 'enabled',
      clear_thinking: true,
    };
  }

  protected getReasoningEffort(
    modelId: string,
    options: vscode.ProvideLanguageModelChatResponseOptions,
  ): ReasoningEffort | undefined {
    if (!this.supportsThinking(modelId)) {
      return undefined;
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

  constructor(protected readonly authManager: BaseAuthManager) {
    this.onDidChangeLanguageModelChatInformation = authManager.onDidChangeApiKey;
    this.authManager.onDidChangeApiKey(() => this.clientCache.clear());
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

  provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken,
  ): Thenable<number> {
    void token;

    if (typeof text === 'string') {
      return Promise.resolve(Math.ceil(text.length / 4));
    }

    let totalChars = 0;
    for (const part of text.content) {
      if (part instanceof vscode.LanguageModelTextPart) {
        totalChars += part.value.length;
      } else if (part instanceof vscode.LanguageModelDataPart) {
        totalChars += estimateDataPartSize(part);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        totalChars += part.name.length;
        totalChars += estimateUnknownPartSize(part.input);
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        totalChars += estimateToolResultSize(part.content);
      } else {
        totalChars += estimateUnknownPartSize(part);
      }
    }

    return Promise.resolve(Math.ceil(totalChars / 4));
  }

  private async streamResponse(
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

    const stream = client.streamChat(
      this.mapModelId(model.id),
      convertMessages(messages, model.capabilities.imageInput === true),
      {
        maxTokens: getNumberModelOption(options, 'maxTokens'),
        tools: model.capabilities.toolCalling ? convertTools(options.tools) : undefined,
        toolChoice:
          model.capabilities.toolCalling && options.tools?.length
            ? options.toolMode === vscode.LanguageModelChatToolMode.Required
              ? 'required'
              : 'auto'
            : undefined,
        thinking: this.getThinkingOption(model.id, options),
        reasoningEffort: this.getReasoningEffort(model.id, options),
      },
      token,
    );

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        return;
      }

      for (const choice of chunk.choices) {
        const reasoning = (choice.delta as ReasoningDelta).reasoning_content;
        if (reasoning) {
          this.reportStructuredReasoningDelta(reasoning, structuredReasoningActive, progress);
          structuredReasoningActive = true;
        }
        if (choice.delta.content) {
          if (structuredReasoningActive) {
            this.closeStructuredReasoning(progress);
            structuredReasoningActive = false;
          }
          thinkingState = this.reportTextDelta(choice.delta.content, thinkingState, progress);
        }
        this.collectToolCalls(choice.delta.tool_calls, toolCallBuilders);
        if (choice.finish_reason === 'tool_calls') {
          if (structuredReasoningActive) {
            this.closeStructuredReasoning(progress);
            structuredReasoningActive = false;
          }
          this.reportToolCalls(progress, toolCallBuilders);
        }
      }
    }

    if (structuredReasoningActive) {
      this.closeStructuredReasoning(progress);
    }

    this.reportToolCalls(progress, toolCallBuilders);
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

  private reportTextDelta(
    content: string | null | undefined,
    state: ThinkingState,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  ): ThinkingState {
    if (!content) {
      return state;
    }

    if (
      !state.insideThinking
      && state.buffer.length === 0
      && !content.includes('<think>')
      && !content.includes('</think>')
    ) {
      progress.report(new vscode.LanguageModelTextPart(content));
      return state;
    }

    const result = processThinkingContent(content, state);
    if (result.output) {
      progress.report(new vscode.LanguageModelTextPart(result.output));
    }
    return result.state;
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

  private throwUserError(message: string): never {
    const error = new Error(message);
    error.stack = error.stack?.split('\n').slice(1).join('\n');
    throw error;
  }

  private throwMappedError(error: unknown): never {
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
