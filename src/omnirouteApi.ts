import type {
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions/completions';
import * as vscode from 'vscode';
import { GenericApiClient, ApiError, type ChatOptions, type GenericMessage, type GenericTool } from './baseApi';
import { getOmnirouteBaseUrl, getOmnirouteConfig } from './omnirouteConfig';
import { omnirouteModelSupportsTemperature } from './omnirouteModelRegistry';

// OmniRoute is a local OpenAI-compatible aggregator. Auth is a Bearer token
// configured on the local server.
//
// The server uses standard `/v1` prefixes for both chat and models:
//   - Chat completions: POST /v1/chat/completions
//   - Model discovery:  GET  /v1/models
//
// The effective base URL is configurable (`copilot-amplify.omniroute.baseUrl`)
// and defaults to `http://localhost:20128/v1`.

// Kept for backwards compatibility — resolves to the configured base URL.
export function getChatBaseUrl(): string {
  return getOmnirouteBaseUrl();
}

export const CHAT_BASE_URL = getChatBaseUrl();
export const MODELS_BASE_URL = getChatBaseUrl();
export const BASE_URL = CHAT_BASE_URL;

export type OmnirouteMessage = GenericMessage;
export type OmnirouteTool = GenericTool;
export { ApiError as OmnirouteApiError };

export interface OmnirouteClientOptions {
  /** Caller-supplied conversation tag. Beats the `sessionId` setting. */
  sessionId?: string;
}

let logChannel: vscode.OutputChannel | undefined;

/**
 * Output channel for OmniRoute telemetry (routing decisions, cost, latency,
 * cache hits). Lazily created on first use.
 */
export function getOmnirouteLogChannel(): vscode.OutputChannel {
  if (!logChannel) {
    logChannel = vscode.window.createOutputChannel('Omniroute');
  }
  return logChannel;
}

function logMessage(message: string): void {
  getOmnirouteLogChannel().appendLine(message);
}

function logTelemetry(headers: Headers, requestModel: string): void {
  const get = (name: string): string => headers.get(name) ?? '';

  const decision = get('x-omniroute-decision');
  const cost = get('x-omniroute-response-cost');
  const tokensIn = get('x-omniroute-tokens-in');
  const tokensOut = get('x-omniroute-tokens-out');
  const upstreamModel = get('x-omniroute-model') || requestModel;
  const provider = get('x-omniroute-provider');
  const latency = get('x-omniroute-latency-ms');
  const cacheHit = get('x-omniroute-cache-hit');
  const costSaved = get('x-omniroute-cost-saved');
  const compression = get('x-omniroute-compression');
  const cache = get('x-omniroute-cache');
  const session = get('x-omniroute-session-id');
  const version = get('x-omniroute-version');
  const requestId = get('x-omniroute-request-id') || get('x-request-id');
  const routeClass = get('x-omniroute-route-class');

  const parts: string[] = [];
  parts.push(`model=${upstreamModel}`);
  if (provider) { parts.push(`provider=${provider}`); }
  if (decision) { parts.push(`route=${decision}`); }
  if (latency) { parts.push(`latency_ms=${latency}`); }
  if (tokensIn || tokensOut) { parts.push(`tokens_in=${tokensIn || '0'}`, `tokens_out=${tokensOut || '0'}`); }
  if (cost && cost !== '0.0000000000') { parts.push(`cost_usd=${cost}`); }
  if (cache) { parts.push(`cache=${cache}`); }
  if (cacheHit === 'true') {
    parts.push('cache_hit=true');
    if (costSaved && costSaved !== '0.0000000000') { parts.push(`cost_saved_usd=${costSaved}`); }
  }
  if (compression) { parts.push(`compression=${compression}`); }
  if (session) { parts.push(`session=${session}`); }
  if (version) { parts.push(`version=${version}`); }
  if (requestId) { parts.push(`request_id=${requestId}`); }
  if (routeClass) { parts.push(`route_class=${routeClass}`); }

  logMessage(`[response] ${parts.join(' | ')}`);
}

/**
 * Build the OmniRoute custom request headers from the active configuration.
 * Only headers that are actually enabled/configured are emitted.
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
  const sessionId = (options?.sessionId ?? cfg.sessionId).trim();
  if (sessionId) {
    headers['X-OmniRoute-Session-Id'] = sessionId;
    headers['X-Session-Id'] = sessionId;
  }
  const compression = cfg.compression.trim();
  if (compression) {
    headers['x-omniroute-compression'] = compression;
  }

  return headers;
}

// ─── SSE parsing ─────────────────────────────────────────────────────────────

async function* parseSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { break; }
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);

        if (!line.startsWith('data:')) {
          continue;
        }
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          return;
        }
        if (!data) {
          continue;
        }
        try {
          yield JSON.parse(data) as Record<string, unknown>;
        } catch {
          // Skip malformed keep-alive / comment frames.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Convert an OpenAI non-streaming completion into a single streaming chunk. */
function toStreamChunkFromCompletion(
  completion: ChatCompletionCreateParamsNonStreaming & { id?: string; created?: number; choices?: Array<{ index?: number; message?: ChatCompletionMessage; finish_reason?: string | null }> },
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

function toApiErrorFromResponse(status: number, body: unknown): ApiError {
  let detail = '';
  if (body && typeof body === 'object') {
    const error = (body as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === 'string') {
      detail = error.message;
    }
  }
  return new ApiError(`Omniroute API error: ${status}${detail ? ` ${detail}` : ''}`, status, body);
}

export class OmnirouteApiClient extends GenericApiClient {
  private readonly apiKey: string;
  private readonly sessionId?: string;

  constructor(apiKey: string, options?: OmnirouteClientOptions) {
    super(apiKey, getOmnirouteBaseUrl(), 'Omniroute', 1.0);
    this.apiKey = apiKey;
    this.sessionId = options?.sessionId?.trim() || undefined;
  }

  /** True when the configured/derived conversation tag is present. */
  hasSessionId(): boolean {
    return Boolean(this.sessionId || getOmnirouteConfig().sessionId.trim());
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
    return `${getOmnirouteBaseUrl().replace(/\/+$/, '')}${path}`;
  }

  override async *streamChat(
    model: string,
    messages: GenericMessage[],
    options?: ChatOptions,
    cancellationToken?: vscode.CancellationToken,
  ): AsyncGenerator<ChatCompletionChunk> {
    const abortController = new AbortController();
    const cancellationDisposable = cancellationToken?.onCancellationRequested(() =>
      abortController.abort(),
    );

    const headers = buildOmnirouteRequestHeaders({ sessionId: this.sessionId });
    headers['Authorization'] = `Bearer ${this.apiKey}`;

    try {
      const response = await fetch(this.getEndpoint('/chat/completions'), {
        method: 'POST',
        headers,
        body: JSON.stringify(this.buildBody(model, messages, options, true)),
        signal: abortController.signal,
        keepalive: true,
      });

      if (getOmnirouteConfig().logTelemetry) {
        logTelemetry(response.headers, model);
      }

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        throw toApiErrorFromResponse(response.status, body);
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!response.body) {
        throw new ApiError('Omniroute API error: empty response body', 0);
      }

      // Some upstreams reply with a plain JSON completion even when `stream: true`.
      if (!contentType.includes('text/event-stream')) {
        const completion = (await response.json()) as Parameters<typeof toStreamChunkFromCompletion>[0];
        yield toStreamChunkFromCompletion(completion);
        return;
      }

      for await (const event of parseSseEvents(response.body)) {
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
      cancellationDisposable?.dispose();
    }
  }

  override async chat(model: string, messages: GenericMessage[], options?: ChatOptions): Promise<void> {
    const headers = buildOmnirouteRequestHeaders({ sessionId: this.sessionId });
    headers['Authorization'] = `Bearer ${this.apiKey}`;

    try {
      const response = await fetch(this.getEndpoint('/chat/completions'), {
        method: 'POST',
        headers,
        body: JSON.stringify(this.buildBody(model, messages, options, false)),
      });

      if (getOmnirouteConfig().logTelemetry) {
        logTelemetry(response.headers, model);
      }

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        throw toApiErrorFromResponse(response.status, body);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(`Omniroute API error: ${error instanceof Error ? error.message : String(error)}`, 0);
    }
  }

  override async chatNonStreaming(model: string, messages: GenericMessage[], options?: ChatOptions): Promise<string> {
    const headers = buildOmnirouteRequestHeaders({ sessionId: this.sessionId });
    headers['Authorization'] = `Bearer ${this.apiKey}`;

    try {
      const response = await fetch(this.getEndpoint('/chat/completions'), {
        method: 'POST',
        headers,
        body: JSON.stringify(this.buildBody(model, messages, options, false)),
      });

      if (getOmnirouteConfig().logTelemetry) {
        logTelemetry(response.headers, model);
      }

      if (!response.ok) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        throw toApiErrorFromResponse(response.status, body);
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
    }
  }
}
