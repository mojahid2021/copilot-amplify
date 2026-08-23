import * as vscode from 'vscode';
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

// Node's `agent` option is silently ignored by undici's global fetch; the
// dispatcher below already pools connections. Passing it only misled readers.
export const customFetch = (url: string | URL | unknown, init?: RequestInit): Promise<Response> =>
  fetch(url as Parameters<typeof fetch>[0], { ...init, keepalive: true });

/** Default chat-request timeout applied when a caller does not specify one. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/**
 * Read the user-configured request timeout for fixed-catalog providers.
 * Falls back to {@link DEFAULT_REQUEST_TIMEOUT_MS} outside an active
 * workspace or when the value is implausibly small.
 */
export function readRequestTimeoutMs(): number {
  try {
    const raw = vscode.workspace
      .getConfiguration('copilot-amplify')
      .get<number>('requestTimeoutMs', DEFAULT_REQUEST_TIMEOUT_MS);
    return Math.max(1_000, raw);
  } catch {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
}

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

export interface ThinkingOption {
  type: 'enabled' | 'disabled';
  clear_thinking?: boolean;
}

export type ReasoningEffort = 'high' | 'max';

export interface ChatOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  tools?: GenericTool[];
  toolChoice?: ChatCompletionToolChoiceOption;
  stop?: string[];
  thinking?: ThinkingOption;
  reasoningEffort?: ReasoningEffort;
  extraBody?: Record<string, unknown>;
}

/**
 * Provider-agnostic API failure carrying the HTTP status and — when
 * available — response headers (used for `Retry-After`) and body.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly response?: unknown,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface GenericApiClientOptions {
  /** Per-request timeout in ms forwarded to the OpenAI client. */
  timeoutMs?: number;
  /** Override the transport (tests). */
  fetchImpl?: typeof fetch;
}

export class GenericApiClient {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    baseURL: string,
    private readonly providerName: string,
    private readonly defaultTemperature = 1.0,
    options: GenericApiClientOptions = {},
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL,
      fetch: options.fetchImpl ?? customFetch,
      // Explicit caller timeouts win (OmniRoute); otherwise apply the shared
      // user-configured default so no chat request can hang indefinitely.
      timeout: options.timeoutMs ?? readRequestTimeoutMs(),
      maxRetries: 0, // retries are owned by executeWithRetry
    });
  }

  private toTextContent(content: string | GenericContentPart[]): string {
    if (typeof content === 'string') {
      return content;
    }

    let text = '';
    for (const part of content) {
      if (part.type === 'text') {
        text += part.text;
      }
    }
    return text;
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
    if (options?.thinking) {
      Object.assign(params, { thinking: options.thinking });
    }
    if (options?.reasoningEffort) {
      Object.assign(params, { reasoning_effort: options.reasoningEffort });
    }
    if (options?.extraBody) {
      Object.assign(params, { extra_body: options.extraBody });
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
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    return match(error)
      .when(
        (value): value is InstanceType<typeof OpenAI.APIError> => value instanceof OpenAI.APIError,
        (value) => new ApiError(
          `${this.providerName} API error: ${value.status} ${value.message}`,
          value.status ?? 0,
          value.error,
          (value.headers ?? undefined) as Record<string, string> | undefined,
        ),
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

  async chatNonStreaming(
    model: string,
    messages: GenericMessage[],
    options?: ChatOptions,
    cancellationToken?: vscode.CancellationToken,
  ): Promise<string> {
    const abortController = new AbortController();
    const cancellationDisposable = cancellationToken?.onCancellationRequested(() =>
      abortController.abort(),
    );
    try {
      const response = await this.client.chat.completions.create(
        this.buildNonStreamingParams(model, messages, options),
        { signal: abortController.signal },
      );
      const content = response.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    } catch (error) {
      throw this.toApiError(error);
    } finally {
      cancellationDisposable?.dispose();
    }
  }
}
