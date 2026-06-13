import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions';
import * as vscode from 'vscode';
import { ApiError, GenericApiClient } from './baseApi';
import type { BaseAuthManager } from './baseAuth';
import { convertMessages, convertTools, parseToolArguments } from './converter';
import { type ThinkingState, processThinkingContent } from './thinking';

interface ToolCallBuilder {
  id: string;
  name: string;
  arguments: string;
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
  protected abstract get providerID(): string;
  protected abstract get providerDisplayName(): string;
  protected abstract get errorMessages(): Record<number, string>;
  protected abstract get models(): vscode.LanguageModelChatInformation[];

  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void>;

  private clientCache = new Map<string, GenericApiClient>();

  protected mapModelId(modelId: string): string {
    return modelId;
  }

  constructor(protected readonly authManager: BaseAuthManager) {
    this.onDidChangeLanguageModelChatInformation = authManager.onDidChangeApiKey;
    this.authManager.onDidChangeApiKey(() => this.clientCache.clear());
  }

  protected getOrCreateClient(apiKey: string): GenericApiClient {
    let client = this.clientCache.get(apiKey);
    if (!client) {
      client = new GenericApiClient(apiKey, this.baseURL, this.providerDisplayName);
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

    const stream = client.streamChat(
      this.mapModelId(model.id),
      convertMessages(messages, model.capabilities.imageInput === true),
      {
        maxTokens: options.modelOptions?.maxTokens as number | undefined,
        tools: model.capabilities.toolCalling ? convertTools(options.tools) : undefined,
        toolChoice:
          model.capabilities.toolCalling && options.tools?.length
            ? options.toolMode === vscode.LanguageModelChatToolMode.Required
              ? 'required'
              : 'auto'
            : undefined,
      },
      token,
    );

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        return;
      }

      for (const choice of chunk.choices) {
        thinkingState = this.reportTextDelta(choice.delta.content, thinkingState, progress);
        this.collectToolCalls(choice.delta.tool_calls, toolCallBuilders);
        if (choice.finish_reason === 'tool_calls') {
          this.reportToolCalls(progress, toolCallBuilders);
        }
      }
    }

    this.reportToolCalls(progress, toolCallBuilders);
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
