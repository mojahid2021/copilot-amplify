/**
 * Anthropic-native chat transport.
 *
 * Speaks the Anthropic `messages` API at `POST {baseUrl}/v1/messages` with
 * `x-api-key` + `anthropic-version: 2023-06-01` headers. The client exposes
 * the same shape as `GenericApiClient.streamChat` / `chatNonStreaming` so it
 * can be dropped into the shared streaming pipeline: it yields OpenAI-shaped
 * `ChatCompletionChunk` events for text, reasoning, and tool-call deltas.
 *
 * This client lives in `core/api/` (not under a provider) so any future
 * Anthropic-compatible gateway (Anthropic direct, AWS Bedrock in Anthropic
 * mode, a second New-API-style gateway, etc.) can reuse the same wire code.
 *
 * Reference: https://docs.anthropic.com/en/api/messages
 */

import * as vscode from 'vscode';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions';
import { ApiError, customFetch, streamingChatFetch } from './client';
import { joinEndpoint } from '../url';
import { parseSseStream } from './sse';

const ANTHROPIC_API_VERSION = '2023-06-01';

/** Anthropic `messages` request body. */
export interface AnthropicMessageRequest {
  model: string;
  /** Concatenated system prompt (string or content-block list). */
  system?: string | AnthropicSystemBlock[];
  messages: AnthropicMessageParam[];
  tools?: AnthropicTool[];
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  /** Extended thinking — only valid on supporting models. */
  thinking?: { type: 'enabled' | 'disabled'; budget_tokens?: number };
  /** When true, partial JSON deltas are aggregated into the final tool_use block. */
}

export interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export type AnthropicMessageParam =
  | { role: 'user'; content: string | AnthropicContentBlock[] }
  | { role: 'assistant'; content: string | AnthropicContentBlock[] };

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock;

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface AnthropicImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | AnthropicContentBlock[];
  is_error?: boolean;
}

export interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicApiClientOptions {
  /** Chat request timeout in ms. */
  timeoutMs?: number;
  /** Override the transport (tests). */
  fetchImpl?: typeof fetch;
}

/** Stream options for the Anthropic `messages` API. */
export interface AnthropicStreamOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  tools?: AnthropicTool[];
  /** Extended thinking — only valid on supporting models. */
  thinking?: { type: 'enabled' | 'disabled'; budget_tokens?: number };
}

/**
 * Lightweight HTTP client for the Anthropic `messages` API.
 *
 * The public surface is intentionally identical to `GenericApiClient`'s
 * streaming and non-streaming methods, so the shared
 * `BaseChatProvider.streamResponse` pipeline can consume it without
 * awareness of the underlying wire protocol.
 */
export class AnthropicApiClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly providerName: string;
  private readonly defaultTemperature: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    apiKey: string,
    baseURL: string,
    providerName: string,
    defaultTemperature = 1.0,
    options: AnthropicApiClientOptions = {},
  ) {
    this.apiKey = apiKey;
    this.baseURL = baseURL.replace(/\/+$/, '');
    this.providerName = providerName;
    this.defaultTemperature = defaultTemperature;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? streamingChatFetch;
  }

  private getEndpoint(path: string): string {
    return joinEndpoint(this.baseURL, path);
  }

  private buildHeaders(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
      'accept': 'text/event-stream',
    };
  }

  private buildBody(
    model: string,
    system: string | undefined,
    messages: AnthropicMessageParam[],
    options?: AnthropicStreamOptions,
  ): AnthropicMessageRequest {
    const body: AnthropicMessageRequest = {
      model,
      messages,
      max_tokens: options?.maxTokens ?? 4096,
      stream: true,
    };
    if (system && system.length > 0) {
      body.system = system;
    }
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    } else {
      body.temperature = this.defaultTemperature;
    }
    if (options?.topP !== undefined) {
      body.top_p = options.topP;
    }
    if (options?.stop?.length) {
      body.stop_sequences = options.stop;
    }
    if (options?.tools?.length) {
      body.tools = options.tools;
    }
    if (options?.thinking?.type === 'enabled') {
      body.thinking = {
        type: 'enabled',
        budget_tokens: options.thinking.budget_tokens ?? 1024,
      };
    }
    return body;
  }

  private toApiError(status: number, body: unknown, headers?: Record<string, string>): ApiError {
    let detail = '';
    if (body && typeof body === 'object') {
      const error = (body as { error?: { message?: unknown; type?: unknown } }).error;
      if (error && typeof error.message === 'string') {
        detail = error.message;
      } else if (body && typeof body === 'object' && 'message' in body && typeof (body as { message: unknown }).message === 'string') {
        detail = (body as { message: string }).message;
      }
    }
    return new ApiError(
      `${this.providerName} API error: ${status}${detail ? ` ${detail}` : ''}`,
      status,
      body,
      headers,
    );
  }

  /**
   * Stream a chat completion from the Anthropic `messages` API.
   *
   * Yields OpenAI-shaped `ChatCompletionChunk` values for text, reasoning
   * (`reasoning_content` field on the delta), and tool-call deltas so the
   * shared `BaseChatProvider.streamResponse` pipeline can consume them
   * without any Anthropic-specific awareness.
   */
  async *streamChat(
    model: string,
    system: string | undefined,
    messages: AnthropicMessageParam[],
    options?: AnthropicStreamOptions,
    cancellationToken?: vscode.CancellationToken,
  ): AsyncGenerator<ChatCompletionChunk> {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), this.timeoutMs);
    timer.unref?.();
    const cancellationDisposable = cancellationToken?.onCancellationRequested(() =>
      abortController.abort(),
    );

    try {
      const response = await this.fetchImpl(this.getEndpoint('/v1/messages'), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(model, system, messages, options)),
        signal: abortController.signal,
      });

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key.toLowerCase()] = value;
        });
        throw this.toApiError(response.status, body, responseHeaders);
      }

      if (!response.body) {
        throw new ApiError(`${this.providerName} API error: empty response body`, 0);
      }

      yield* this.streamChunks(response.body, model, cancellationToken);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      throw new ApiError(
        `${this.providerName} API error: ${error instanceof Error ? error.message : String(error)}`,
        0,
      );
    } finally {
      clearTimeout(timer);
      cancellationDisposable?.dispose();
    }
  }

  /**
   * Parse an Anthropic SSE response and yield OpenAI-shaped chunks.
   * Exposed for unit tests.
   */
  async *streamChunks(
    body: ReadableStream<Uint8Array>,
    model: string,
    cancellationToken?: vscode.CancellationToken,
  ): AsyncGenerator<ChatCompletionChunk> {
    // Track tool-use state: by index, the current id, name, and accumulated JSON.
    const toolUseIndexByBlockIndex = new Map<number, number>();
    const nextToolCallIndex = (() => {
      let next = 0;
      return () => {
        const v = next;
        next += 1;
        return v;
      };
    })();

    for await (const event of parseSseStream(body)) {
      if (cancellationToken?.isCancellationRequested) {
        try {
          await body.cancel();
        } catch {
          /* best-effort */
        }
        return;
      }

      const type = event['type'];
      if (typeof type !== 'string') {
        continue;
      }

      if (type === 'message_start') {
        // Initial message metadata; no payload to emit but useful as a marker.
        continue;
      }

      if (type === 'content_block_start') {
        const block = event['content_block'] as { type?: string; id?: string; name?: string } | undefined;
        if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
          const blockIndex = typeof event['index'] === 'number' ? (event['index'] as number) : 0;
          const toolCallIndex = nextToolCallIndex();
          toolUseIndexByBlockIndex.set(blockIndex, toolCallIndex);
          yield {
            id: 'anthropic',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: toolCallIndex,
                      id: block.id,
                      type: 'function',
                      function: { name: block.name, arguments: '' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
        }
        continue;
      }

      if (type === 'content_block_delta') {
        const delta = event['delta'] as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
        const blockIndex = typeof event['index'] === 'number' ? (event['index'] as number) : 0;
        if (!delta) {
          continue;
        }
        if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
          yield {
            id: 'anthropic',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                delta: { content: delta.text },
                finish_reason: null,
              },
            ],
          };
          continue;
        }
        if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking.length > 0) {
          // `reasoning_content` is not part of the OpenAI Delta type but
          // the shared streaming pipeline reads it as a generic reasoning
          // field (alongside `reasoning`, `thought`, `thinking`, etc.).
          // Cast through `unknown` so we can attach the synthetic field
          // without losing the surrounding chunk structure.
          yield {
            id: 'anthropic',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                delta: { reasoning_content: delta.thinking } as unknown as ChatCompletionChunk.Choice.Delta,
                finish_reason: null,
              },
            ],
          };
          continue;
        }
        if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const toolCallIndex = toolUseIndexByBlockIndex.get(blockIndex);
          if (toolCallIndex === undefined) {
            continue;
          }
          yield {
            id: 'anthropic',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: toolCallIndex,
                      function: { arguments: delta.partial_json },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
        }
        continue;
      }

      if (type === 'content_block_stop') {
        continue;
      }

      if (type === 'message_delta') {
        const stopReason = (event['delta'] as { stop_reason?: unknown } | undefined)?.stop_reason;
        if (stopReason === 'end_turn' || stopReason === 'stop_sequence' || stopReason === 'max_tokens') {
          yield {
            id: 'anthropic',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop',
              },
            ],
          };
        } else if (stopReason === 'tool_use') {
          yield {
            id: 'anthropic',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'tool_calls',
              },
            ],
          };
        }
        continue;
      }

      if (type === 'message_stop') {
        yield {
          id: 'anthropic',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
        };
        return;
      }

      if (type === 'error') {
        const errBody = event['error'] as { message?: unknown; type?: unknown } | undefined;
        const message = errBody && typeof errBody.message === 'string' ? errBody.message : 'Anthropic stream error';
        throw new ApiError(`${this.providerName} API error: ${message}`, 0, event);
      }

      if (type === 'ping') {
        // Keep-alive; ignore.
        continue;
      }
    }
  }

  /**
   * Non-streaming probe — used for connection tests. Returns the first
   * assistant text content if present, otherwise an empty string.
   */
  async chatNonStreaming(
    model: string,
    system: string | undefined,
    messages: AnthropicMessageParam[],
    options?: AnthropicStreamOptions,
  ): Promise<string> {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), this.timeoutMs);
    timer.unref?.();

    try {
      const response = await customFetch(this.getEndpoint('/v1/messages'), {
        method: 'POST',
        headers: { ...this.buildHeaders(), accept: 'application/json' },
        body: JSON.stringify(this.buildBody(model, system, messages, { ...(options ?? {}), maxTokens: options?.maxTokens ?? 1 })),
        signal: abortController.signal,
      });

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key.toLowerCase()] = value;
        });
        throw this.toApiError(response.status, body, responseHeaders);
      }

      const json = (await response.json()) as {
        content?: Array<{ type?: string; text?: unknown }>;
      };
      if (!Array.isArray(json.content)) {
        return '';
      }
      for (const block of json.content) {
        if (block && block.type === 'text' && typeof block.text === 'string') {
          return block.text;
        }
      }
      return '';
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        return '';
      }
      throw new ApiError(
        `${this.providerName} API error: ${error instanceof Error ? error.message : String(error)}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
