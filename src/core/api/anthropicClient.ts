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
import { ApiError, streamingChatFetch } from './client';
import { apiErrorFromResponse, createRequestSignal, errorMessageFromBody, toApiError } from './http';
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

  private get errorLabel(): string {
    return `${this.providerName} API error`;
  }

  /**
   * Stream a chat completion from the Anthropic `messages` API, translated
   * into OpenAI-shaped chunks so `BaseChatProvider.consumeChatStream` can
   * handle both transports the same way.
   */
  async *streamChat(
    model: string,
    system: string | undefined,
    messages: AnthropicMessageParam[],
    options?: AnthropicStreamOptions,
    cancellationToken?: vscode.CancellationToken,
  ): AsyncGenerator<ChatCompletionChunk> {
    const request = createRequestSignal({ timeoutMs: this.timeoutMs, token: cancellationToken });
    try {
      const response = await this.fetchImpl(joinEndpoint(this.baseURL, '/v1/messages'), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(model, system, messages, options)),
        signal: request.signal,
      });
      if (!response.ok) {
        throw await apiErrorFromResponse(response, this.errorLabel);
      }
      if (!response.body) {
        throw new ApiError(`${this.errorLabel}: empty response body`, 0);
      }
      yield* this.streamChunks(response.body, model, cancellationToken);
    } catch (error) {
      // shortcut: a timeout also lands here and ends the stream silently, like a user cancel.
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      throw toApiError(error, this.errorLabel);
    } finally {
      request.dispose();
    }
  }

  /** Translate Anthropic SSE events into OpenAI-shaped chunks. Public for tests. */
  async *streamChunks(
    body: ReadableStream<Uint8Array>,
    model: string,
    cancellationToken?: vscode.CancellationToken,
  ): AsyncGenerator<ChatCompletionChunk> {
    const chunk = (
      delta: ChatCompletionChunk.Choice.Delta,
      finishReason: ChatCompletionChunk.Choice['finish_reason'] = null,
    ): ChatCompletionChunk => ({
      id: 'anthropic',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    });

    // Anthropic numbers content blocks (text, thinking, tool_use together);
    // OpenAI numbers tool calls only. Map one onto the other.
    const toolCallIndexByBlock = new Map<number, number>();

    for await (const event of parseSseStream(body)) {
      if (cancellationToken?.isCancellationRequested) {
        await body.cancel().catch(() => {});
        return;
      }
      const blockIndex = typeof event['index'] === 'number' ? event['index'] : 0;

      switch (event['type']) {
        case 'content_block_start': {
          const block = event['content_block'] as { type?: string; id?: string; name?: string } | undefined;
          if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
            const toolCallIndex = toolCallIndexByBlock.size;
            toolCallIndexByBlock.set(blockIndex, toolCallIndex);
            yield chunk({
              tool_calls: [{ index: toolCallIndex, id: block.id, type: 'function', function: { name: block.name, arguments: '' } }],
            });
          }
          break;
        }

        case 'content_block_delta': {
          const delta = event['delta'] as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
          if (delta?.type === 'text_delta' && delta.text) {
            yield chunk({ content: delta.text });
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            // `reasoning_content` is not in the OpenAI delta type, but it is the
            // field consumeChatStream reads reasoning from.
            yield chunk({ reasoning_content: delta.thinking } as ChatCompletionChunk.Choice.Delta);
          } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            const toolCallIndex = toolCallIndexByBlock.get(blockIndex);
            if (toolCallIndex !== undefined) {
              yield chunk({ tool_calls: [{ index: toolCallIndex, function: { arguments: delta.partial_json } }] });
            }
          }
          break;
        }

        case 'message_delta': {
          const stopReason = (event['delta'] as { stop_reason?: unknown } | undefined)?.stop_reason;
          if (stopReason === 'tool_use') {
            yield chunk({}, 'tool_calls');
          } else if (stopReason === 'end_turn' || stopReason === 'stop_sequence' || stopReason === 'max_tokens') {
            yield chunk({}, 'stop');
          }
          break;
        }

        case 'message_stop':
          yield chunk({}, 'stop');
          return;

        case 'error': {
          const message = errorMessageFromBody(event) || 'Anthropic stream error';
          throw new ApiError(`${this.errorLabel}: ${message}`, 0, event);
        }

        // message_start, content_block_stop and ping carry nothing we need.
      }
    }
  }
}
