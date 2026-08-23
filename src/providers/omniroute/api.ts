import type {
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions/completions';
import type * as vscode from 'vscode';
import { ApiError, GenericApiClient, customFetch, type ChatOptions, type GenericMessage } from '../../core/api/client';
import { parseSseStream } from '../../core/api/sse';
import { joinEndpoint, normalizeBaseUrl, resolveCustomEndpoint } from '../../core/url';
import { getOmnirouteConfig, getOmnirouteBaseUrl } from './config';
import { omnirouteModelSupportsTemperature } from './modelRegistry';
import { resolveOmnirouteSessionId } from './session';
import { parseOmnirouteTelemetry, formatOmnirouteTelemetry } from './telemetry';
import { logger } from '../../core/logging/logger';

/**
 * OmniRoute HTTP client.
 *
 * OmniRoute is an OpenAI-compatible aggregator treated exactly like any other
 * provider. Standard `/v1`-style endpoints relative to the configured base URL:
 *   - Chat completions: POST {base}/chat/completions
 *   - Model discovery:  GET  {base}/models
 */

const log = logger.child({ provider: 'OmniRoute' });

export interface OmnirouteClientOptions {
  /** Caller-supplied conversation tag. Beats the `sessionId` setting. */
  sessionId?: string;
  /** Transport override (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Build the OmniRoute custom request headers from active configuration.
 * Only enabled/configured headers are emitted.
 */
export function buildOmnirouteRequestHeaders(
  options?: OmnirouteClientOptions,
): Record<string, string> {
  const cfg = getOmnirouteConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Connection': 'keep-alive',
  };

  if (cfg.noCache) {
    headers['X-OmniRoute-No-Cache'] = 'true';
  }
  if (cfg.noMemory) {
    headers['x-omniroute-no-memory'] = 'true';
  }
  if (cfg.progress) {
    headers['X-OmniRoute-Progress'] = 'true';
  }
  // Session tagging is always-on: explicit setting wins, otherwise the
  // stable window-scoped identifier applies (see session.ts).
  const resolved = resolveOmnirouteSessionId(options?.sessionId ?? cfg.sessionId);
  headers['X-OmniRoute-Session-Id'] = resolved;
  headers['X-Session-Id'] = resolved;
  const compression = cfg.compression.trim();
  if (compression) {
    headers['x-omniroute-compression'] = compression;
  }

  return headers;
}

/** Convert a non-streaming completion into a single streaming chunk. */
function toStreamChunkFromCompletion(
  completion: ChatCompletionCreateParamsNonStreaming & {
    id?: string;
    created?: number;
    choices?: Array<{ index?: number; message?: ChatCompletionMessage; finish_reason?: string | null }>;
  },
): ChatCompletionChunk {
  return {
    id: completion.id ?? 'chatcmpl-omniroute',
    object: 'chat.completion.chunk',
    created: completion.created ?? Math.floor(Date.now() / 1000),
    model: completion.model,
    choices: (completion.choices ?? []).map((choice) => ({
      index: choice.index ?? 0,
      delta: (choice.message ?? {}) as ChatCompletionChunk.Choice.Delta,
      finish_reason: choice.finish_reason as ChatCompletionChunk.Choice['finish_reason'],
    })),
  };
}

function toApiErrorFromResponse(status: number, body: unknown, headers?: Record<string, string>): ApiError {
  let detail = '';
  if (body && typeof body === 'object') {
    const error = (body as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === 'string') {
      detail = error.message;
    }
  }
  // Headers (notably Retry-After) ride along so the retry handler can honor them.
  return new ApiError(`Omniroute API error: ${status}${detail ? ` ${detail}` : ''}`, status, body, headers);
}

/** Flatten a fetch `Headers` object into a lowercase-keyed plain record. */
function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function logResponseTelemetry(response: Response, requestModel: string): void {
  try {
    const record = parseOmnirouteTelemetry(
      (name) => response.headers.get(name) ?? '',
      requestModel,
    );
    log.info(`[response] ${formatOmnirouteTelemetry(record)}`);
  } catch {
    /* telemetry is best-effort */
  }
}

export class OmnirouteApiClient extends GenericApiClient {
  private readonly apiKey: string;
  private readonly sessionId?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, options?: OmnirouteClientOptions) {
    super(apiKey, getOmnirouteBaseUrl(), 'OmniRoute', 1.0, {
      timeoutMs: getOmnirouteConfig().requestTimeoutMs,
      ...(options?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    this.apiKey = apiKey;
    this.sessionId = options?.sessionId?.trim() || undefined;
    this.fetchImpl = options?.fetchImpl ?? customFetch;
  }

  /** True when a conversation tag will be attached. */
  hasSessionId(): boolean {
    return true; // always: explicit or window-generated
  }

  private buildBody(model: string, messages: GenericMessage[], options?: ChatOptions, stream = true): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream,
    };

    // Some upstream models reject `temperature` outright (capabilities.temperature
    // is `false`). Honor the advertised capability instead of forcing 1.0.
    if (omnirouteModelSupportsTemperature(model)) {
      body.temperature = options?.temperature ?? 1.0;
    }

    if (options?.topP !== undefined) {
      body.top_p = options.topP;
    }
    if (options?.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    }
    if (options?.stop?.length) {
      body.stop = options.stop;
    }
    if (options?.thinking) {
      body.thinking = options.thinking;
    }
    if (options?.reasoningEffort) {
      body.reasoning_effort = options.reasoningEffort;
    }
    if (options?.tools?.length) {
      body.tools = options.tools as unknown[];
    }
    if (options?.toolChoice) {
      body.tool_choice = options.toolChoice;
    }
    if (options?.extraBody) {
      Object.assign(body, options.extraBody);
    }

    return body;
  }

  private getEndpoint(path: string): string {
    // A configured chatEndpoint override wins for chat-completions calls;
    // everything else (discovery etc.) keeps using the standard base path.
    if (path === '/chat/completions') {
      return resolveCustomEndpoint(normalizeBaseUrl(getOmnirouteBaseUrl(), ''), getOmnirouteConfig().chatEndpoint, path);
    }
    return joinEndpoint(normalizeBaseUrl(getOmnirouteBaseUrl(), ''), path);
  }

  private buildHeaders(): Record<string, string> {
    const headers = buildOmnirouteRequestHeaders({ sessionId: this.sessionId });
    headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  override async *streamChat(
    model: string,
    messages: GenericMessage[],
    options?: ChatOptions,
    cancellationToken?: vscode.CancellationToken,
  ): AsyncGenerator<ChatCompletionChunk> {
    const abortController = new AbortController();
    const requestTimeout = setTimeout(
      () => abortController.abort(),
      getOmnirouteConfig().requestTimeoutMs,
    );
    const cancellationDisposable = cancellationToken?.onCancellationRequested(() =>
      abortController.abort(),
    );

    try {
      const response = await this.fetchImpl(this.getEndpoint('/chat/completions'), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(model, messages, options, true)),
        signal: abortController.signal,
        keepalive: true,
      });

      if (getOmnirouteConfig().logTelemetry) {
        logResponseTelemetry(response, model);
      }

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        throw toApiErrorFromResponse(response.status, body, headersToRecord(response.headers));
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!response.body) {
        throw new ApiError('Omniroute API error: empty response body', 0);
      }

      // Some upstreams reply with plain JSON even when `stream: true`.
      if (!contentType.includes('text/event-stream')) {
        const completion = (await response.json()) as Parameters<typeof toStreamChunkFromCompletion>[0];
        yield toStreamChunkFromCompletion(completion);
        return;
      }

      for await (const event of parseSseStream(response.body)) {
        if (cancellationToken?.isCancellationRequested) {
          return;
        }
        if (event && typeof event === 'object' && 'error' in event) {
          throw toApiErrorFromResponse(0, event);
        }
        if (Array.isArray(event.choices)) {
          yield event as unknown as ChatCompletionChunk;
        }
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      throw new ApiError(`Omniroute API error: ${error instanceof Error ? error.message : String(error)}`, 0);
    } finally {
      clearTimeout(requestTimeout);
      cancellationDisposable?.dispose();
    }
  }

  async chatNonStreaming(model: string, messages: GenericMessage[], options?: ChatOptions): Promise<string> {
    const abortController = new AbortController();
    const requestTimeout = setTimeout(
      () => abortController.abort(),
      getOmnirouteConfig().requestTimeoutMs,
    );

    try {
      const response = await this.fetchImpl(this.getEndpoint('/chat/completions'), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(this.buildBody(model, messages, options, false)),
        signal: abortController.signal,
        keepalive: true,
      });

      if (getOmnirouteConfig().logTelemetry) {
        logResponseTelemetry(response, model);
      }

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        throw toApiErrorFromResponse(response.status, body, headersToRecord(response.headers));
      }

      const completion = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = completion.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(`Omniroute API error: ${error instanceof Error ? error.message : String(error)}`, 0);
    } finally {
      clearTimeout(requestTimeout);
    }
  }
}
