import OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionToolChoiceOption,
  ChatCompletionTool,
} from 'openai/resources/chat/completions/completions';
import { match } from 'ts-pattern';
import type * as vscode from 'vscode';

export interface GenericMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | GenericContentPart[];
  name?: string;
  tool_calls?: GenericToolCall[];
  tool_call_id?: string;
}

export type GenericContentPart = GenericTextContentPart | GenericImageContentPart;

export interface GenericTextContentPart {
  type: 'text';
  text: string;
}

export interface GenericImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface GenericToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface GenericTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  tools?: GenericTool[];
  toolChoice?: ChatCompletionToolChoiceOption;
  stop?: string[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly response?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class GenericApiClient {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    baseURL: string,
    private readonly providerName: string,
    private readonly defaultTemperature = 1.0,
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
    });
  }

  private toTextContent(content: string | GenericContentPart[]): string {
    if (typeof content === 'string') {
      return content;
    }

    return content
      .filter((part): part is GenericTextContentPart => part.type === 'text')
      .map((part) => part.text)
      .join('');
  }

  private toOpenAiContentParts(parts: GenericContentPart[]): ChatCompletionContentPart[] {
    return parts.map((part) =>
      part.type === 'text'
        ? {
          type: 'text',
          text: part.text,
        } : {
          type: 'image_url',
          image_url: {
            url: part.image_url.url,
            detail: part.image_url.detail,
          },
        });
  }

  private toOpenAiMessages(messages: GenericMessage[]): ChatCompletionMessageParam[] {
    return messages.map((message) =>
      match(message.role)
        .with('tool', () => ({
          role: 'tool' as const,
          content: this.toTextContent(message.content),
          tool_call_id: message.tool_call_id ?? '',
        }))
        .with('assistant', () =>
          message.tool_calls?.length
            ? {
              role: 'assistant' as const,
              content: this.toTextContent(message.content),
              tool_calls: message.tool_calls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: {
                  name: call.function.name,
                  arguments: call.function.arguments,
                },
              })),
            } : {
              role: 'assistant' as const,
              content: this.toTextContent(message.content),
            },
        )
        .with('system', () => ({
          role: 'system' as const,
          content: this.toTextContent(message.content),
        }))
        .otherwise(() => ({
          role: 'user' as const,
          content:
            typeof message.content === 'string'
              ? message.content
              : this.toOpenAiContentParts(message.content),
        })),
    );
  }

  private toOpenAiTools(tools?: GenericTool[]): ChatCompletionTool[] | undefined {
    if (!tools?.length) {
      return undefined;
    }

    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    }));
  }

  private applyOptionalParams(
    params: ChatCompletionCreateParamsStreaming | ChatCompletionCreateParamsNonStreaming,
    options?: ChatOptions,
  ): void {
    if (options?.topP !== undefined) {
      params.top_p = options.topP;
    }
    if (options?.maxTokens !== undefined) {
      params.max_tokens = options.maxTokens;
    }
    if (options?.stop?.length) {
      params.stop = options.stop;
    }

    const tools = this.toOpenAiTools(options?.tools);
    if (tools) {
      params.tools = tools;
    }
    if (options?.toolChoice) {
      params.tool_choice = options.toolChoice;
    }
  }

  private buildStreamingParams(
    model: string,
    messages: GenericMessage[],
    options?: ChatOptions,
  ): ChatCompletionCreateParamsStreaming {
    const params: ChatCompletionCreateParamsStreaming = {
      model,
      messages: this.toOpenAiMessages(messages),
      stream: true,
      temperature: options?.temperature ?? this.defaultTemperature,
    };
    this.applyOptionalParams(params, options);
    return params;
  }

  private buildNonStreamingParams(
    model: string,
    messages: GenericMessage[],
    options?: ChatOptions,
  ): ChatCompletionCreateParamsNonStreaming {
    const params: ChatCompletionCreateParamsNonStreaming = {
      model,
      messages: this.toOpenAiMessages(messages),
      stream: false,
      temperature: options?.temperature ?? this.defaultTemperature,
    };
    this.applyOptionalParams(params, options);
    return params;
  }

  private toApiError(error: unknown): ApiError {
    return match(error)
      .when(
        (value): value is InstanceType<typeof OpenAI.APIError> => value instanceof OpenAI.APIError,
        (value) => new ApiError(`${this.providerName} API error: ${value.status} ${value.message}`, value.status ?? 0, value.error),
      )
      .when(
        (value): value is Error => value instanceof Error,
        (value) => new ApiError(`${this.providerName} API error: ${value.message}`, 0),
      )
      .otherwise((value) => new ApiError(`${this.providerName} API error: ${String(value)}`, 0));
  }

  async *streamChat(
    model: string,
    messages: GenericMessage[],
    options?: ChatOptions,
    cancellationToken?: vscode.CancellationToken,
  ): AsyncGenerator<ChatCompletionChunk> {
    const abortController = new AbortController();
    const cancellationDisposable = cancellationToken?.onCancellationRequested(() =>
      abortController.abort(),
    );

    try {
      const stream = (await this.client.chat.completions.create(
        this.buildStreamingParams(model, messages, options),
        {
          signal: abortController.signal,
        },
      )) as AsyncIterable<ChatCompletionChunk>;

      for await (const chunk of stream) {
        if (cancellationToken?.isCancellationRequested) {
          return;
        }
        yield chunk;
      }
    } catch (error) {
      throw this.toApiError(error);
    } finally {
      cancellationDisposable?.dispose();
    }
  }

  async chat(model: string, messages: GenericMessage[], options?: ChatOptions): Promise<void> {
    try {
      await this.client.chat.completions.create(
        this.buildNonStreamingParams(model, messages, options),
      );
    } catch (error) {
      throw this.toApiError(error);
    }
  }
}
