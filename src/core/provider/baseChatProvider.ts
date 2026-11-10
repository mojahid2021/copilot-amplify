import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions';
import * as vscode from 'vscode';
import { ApiError, GenericApiClient, type ReasoningEffort, type ThinkingOption } from '../api/client';
import type { BaseAuthManager } from '../auth/authManager';
import { convertMessages, convertTools, parseToolArguments } from '../context/converter';
import { prepareContextMessages, estimateMessageTokens } from '../context/contextManager';
import { THINKING_BLOCK_CLOSE, THINKING_BLOCK_OPEN, type ThinkingState, processThinkingContent } from '../thinking/thinking';
import { executeWithRetry } from '../retry/retryHandler';
import { CircuitBreaker, type CircuitState } from '../resilience/circuitBreaker';
import { AVAILABILITY_HINTS, classifyAvailability } from '../resilience/saturation';
import { NetworkQualityTracker, type NetworkQuality } from '../resilience/networkQuality';
import { isCancellation } from '../errors';
import { logger } from '../logging/logger';
import { getGlobalConfig } from '../globalConfig';

/**
 * Shared implementation of VS Code's `LanguageModelChatProvider`.
 *
 * A chat request flows through:
 *   provideLanguageModelChatResponse
 *     → resolveApiKey()                       (override: anonymous access, no prompt)
 *     → runChatOperation()                    (retry + circuit breaker + health stats)
 *       → sendChatRequest()                   (override: pick another transport)
 *         → streamResponse() → consumeChatStream()
 *     → throwMappedError()                    (HTTP status → readable message)
 *
 * Subclasses supply the endpoint, models and error texts, and override the
 * small hooks below only when a provider really differs.
 */

/** Outcome of the most recent chat request, for health() and diagnostics. */
export interface ProviderRequestOutcome {
  ok: boolean;
  /** HTTP status when the failure came from an API response. */
  statusCode?: number;
  /** Failure classification; absent for successful requests. */
  category?: 'saturated' | 'rate-limited' | 'maintenance' | 'unavailable' | 'auth-failed' | 'error';
  at: number;
}

type ResponseOptions = vscode.ProvideLanguageModelChatResponseOptions;
type Progress = vscode.Progress<vscode.LanguageModelResponsePart>;

/** Read a per-request model option. Newer VS Code builds call it `modelConfiguration`. */
export function getModelOption(options: ResponseOptions, name: string): unknown {
  const modelConfiguration = (options as { modelConfiguration?: Record<string, unknown> }).modelConfiguration;
  return modelConfiguration?.[name] ?? options.modelOptions?.[name];
}

export function getNumberModelOption(options: ResponseOptions, name: string): number | undefined {
  const value = getModelOption(options, name);
  return typeof value === 'number' ? value : undefined;
}

export abstract class BaseChatProvider implements vscode.LanguageModelChatProvider, vscode.Disposable {
  protected abstract readonly baseURL: string;
  protected abstract readonly providerDisplayName: string;
  /** Provider-specific messages by HTTP status; anything missing uses defaultErrorMessage(). */
  protected readonly errorMessages: Record<number, string> = {};
  protected abstract readonly models: vscode.LanguageModelChatInformation[];

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void> = this.changeEmitter.event;

  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  private readonly clientCache = new Map<string, GenericApiClient>();
  private readonly qualityTracker = new NetworkQualityTracker();
  private lastRequestOutcome?: ProviderRequestOutcome;
  /** Time to first token of the latest stream; set by consumeChatStream. */
  private lastTtftMs?: number;
  private _breaker?: CircuitBreaker;
  private _log?: ReturnType<typeof logger.child>;

  constructor(protected readonly authManager: BaseAuthManager) {
    this.addDisposables(
      authManager.onDidChangeApiKey(() => {
        this.clientCache.clear();
        this.fireModelInformationChanged();
      }),
      // Clients capture the timeout when they are created; rebuild them when it changes.
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('copilot-amplify.requestTimeoutMs')) {
          this.clientCache.clear();
        }
      }),
    );
  }

  dispose(): void {
    this.clientCache.clear();
    this._breaker?.reset();
    this.qualityTracker.reset();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  protected addDisposables(...disposables: vscode.Disposable[]): void {
    this.disposables.push(...disposables);
  }

  // Lazy: `providerDisplayName` is only set once the subclass constructor ran.
  protected get log(): ReturnType<typeof logger.child> {
    return (this._log ??= logger.child({ provider: this.providerDisplayName }));
  }

  protected get breaker(): CircuitBreaker {
    return (this._breaker ??= new CircuitBreaker(this.providerDisplayName, readCircuitBreakerOptions()));
  }

  /** Tell VS Code to re-query the model list (e.g. after discovery). */
  protected fireModelInformationChanged(): void {
    this.changeEmitter.fire();
  }

  // ── Hooks ────────────────────────────────────────────────────────────────

  /** Catalog id → id the API expects. */
  protected mapModelId(modelId: string): string {
    return modelId;
  }

  protected supportsThinking(_modelId: string): boolean {
    void _modelId;
    return false;
  }

  /** The Z.ai-style `thinking` body field. */
  protected getThinkingOption(modelId: string, options: ResponseOptions): ThinkingOption | undefined {
    if (!this.supportsThinking(modelId)) {
      return undefined;
    }
    const enabled = getGlobalConfig().enableReasoning && getModelOption(options, 'reasoningEffort') !== 'none';
    return { type: enabled ? 'enabled' : 'disabled', clear_thinking: true };
  }

  /** The OpenAI-style `reasoning_effort` body field. */
  protected getReasoningEffort(modelId: string, options: ResponseOptions): ReasoningEffort | undefined {
    if (!this.supportsThinking(modelId) || !getGlobalConfig().enableReasoning) {
      return undefined;
    }
    const effort = getModelOption(options, 'reasoningEffort');
    if (effort === 'none') {
      return undefined;
    }
    return effort === 'max' || effort === 'xhigh' || effort === 'ultracode' ? 'max' : 'high';
  }

  protected getApiClient(apiKey: string): GenericApiClient {
    return new GenericApiClient(apiKey, this.baseURL, this.providerDisplayName);
  }

  /**
   * The key for a chat request. Default: the stored key, else prompt for one.
   * Throws when there is none.
   */
  protected async resolveApiKey(): Promise<string> {
    const apiKey = await this.authManager.getOrPromptApiKey();
    if (!apiKey) {
      throw new Error(`API key not configured. Use the Manage command for ${this.providerDisplayName}.`);
    }
    return apiKey;
  }

  /** Send one chat request. Override to route some models to another transport. */
  protected sendChatRequest(
    apiKey: string,
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: ResponseOptions,
    progress: Progress,
    token: vscode.CancellationToken,
  ): Promise<void> {
    return this.streamResponse(this.getOrCreateClient(apiKey), model, messages, options, progress, token);
  }

  // ── VS Code Language Model API ──────────────────────────────────────────

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (token.isCancellationRequested) {
      return [];
    }
    if (await this.authManager.getApiKey()) {
      return this.models;
    }
    if (!options.silent && (await this.authManager.promptForApiKey())) {
      return this.models;
    }
    return [];
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: ResponseOptions,
    progress: Progress,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const apiKey = await this.resolveApiKey();
    try {
      await this.runChatOperation(
        () => this.sendChatRequest(apiKey, model, messages, options, progress, token),
        token,
      );
    } catch (error) {
      if (token.isCancellationRequested) {
        return;
      }
      this.throwMappedError(error);
    }
  }

  provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
  ): Thenable<number> {
    if (typeof text === 'string') {
      return Promise.resolve(Math.ceil(text.length / 3.8));
    }
    const total = convertMessages([text], true).reduce((sum, message) => sum + estimateMessageTokens(message), 0);
    return Promise.resolve(total);
  }

  // ── Health ───────────────────────────────────────────────────────────────

  getLatestRequestOutcome(): ProviderRequestOutcome | undefined {
    return this.lastRequestOutcome;
  }

  getCircuitState(): CircuitState {
    return this.breaker.currentState;
  }

  getNetworkQuality(): NetworkQuality {
    const quality = this.qualityTracker.getQuality();
    // An open circuit refuses every request, whatever the recent latency was.
    return this.breaker.currentState === 'open' ? { ...quality, level: 'poor' } : quality;
  }

  // ── Request pipeline ────────────────────────────────────────────────────

  /**
   * Run one chat operation under retry + circuit breaker and record the
   * outcome for health reporting. The final error is rethrown.
   */
  protected async runChatOperation(operation: () => Promise<void>, token?: vscode.CancellationToken): Promise<void> {
    const startMs = Date.now();
    this.lastTtftMs = undefined;
    try {
      await executeWithRetry(() => this.breaker.execute(operation), token);
      // Time to first token reflects network/server latency; total time would
      // mostly measure how long the answer is.
      // shortcut: lastTtftMs is per provider, so two overlapping chats can swap samples; fine for a rolling average.
      this.qualityTracker.record(this.lastTtftMs ?? Date.now() - startMs, true);
      this.lastRequestOutcome = { ok: true, at: Date.now() };
    } catch (error) {
      if (!isCancellation(error) && !token?.isCancellationRequested) {
        this.qualityTracker.record(Date.now() - startMs, false);
        this.lastRequestOutcome = { ...outcomeFromError(error), at: Date.now() };
      }
      throw error;
    }
  }

  protected getOrCreateClient(apiKey: string): GenericApiClient {
    const cacheKey = apiKey.trim();
    let client = this.clientCache.get(cacheKey);
    if (!client) {
      client = this.getApiClient(cacheKey);
      if (this.clientCache.size >= 8) {
        // Keys change rarely; drop the oldest instead of growing forever.
        const oldest = this.clientCache.keys().next();
        if (!oldest.done) {
          this.clientCache.delete(oldest.value);
        }
      }
      this.clientCache.set(cacheKey, client);
    }
    return client;
  }

  /** Stream through an OpenAI-compatible client, with a non-streaming fallback. */
  protected async streamResponse(
    client: GenericApiClient,
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: ResponseOptions,
    progress: Progress,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const maxTokens = getNumberModelOption(options, 'maxTokens') ?? model.maxOutputTokens ?? 4096;
    const preparedMessages = prepareContextMessages(messages, model.capabilities.imageInput === true, {
      maxInputTokens: model.maxInputTokens ?? 128_000,
      reserveOutputTokens: maxTokens,
    });
    const tools = model.capabilities.toolCalling ? convertTools(options.tools) : undefined;
    const modelId = this.mapModelId(model.id);

    const { reported, error: streamError } = await this.consumeChatStream(
      client.streamChat(
        modelId,
        preparedMessages,
        {
          maxTokens,
          tools,
          toolChoice: tools?.length
            ? options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto'
            : undefined,
          thinking: this.getThinkingOption(model.id, options),
          reasoningEffort: this.getReasoningEffort(model.id, options),
        },
        token,
      ),
      model.id,
      progress,
      token,
    );

    if (reported || token.isCancellationRequested) {
      return;
    }
    // An HTTP error (429, 401, 400, ...) fails the same way without streaming;
    // retrying it non-streaming would only double the request count.
    if (streamError instanceof ApiError && streamError.statusCode > 0) {
      throw streamError;
    }

    // Some gateways break streaming but answer plain requests fine.
    this.log.warn('streaming yielded no parts; retrying via non-streaming completion');
    try {
      const content = await client.chatNonStreaming(modelId, preparedMessages, { maxTokens, tools }, token);
      if (content.trim()) {
        progress.report(new vscode.LanguageModelTextPart(content));
      }
    } catch (fallbackError) {
      if (token.isCancellationRequested) {
        return;
      }
      this.log.warn('non-streaming fallback also failed', { error: errorText(fallbackError) });
      throw streamError ?? fallbackError;
    }
  }

  /**
   * Turn an OpenAI-shaped chunk stream (from any transport) into response
   * parts: text, reasoning and tool calls.
   *
   * - A user cancel ends quietly; it is not a provider failure.
   * - An error after output was shown is rethrown.
   * - An error before any output is returned, so the caller can fall back.
   */
  protected async consumeChatStream(
    stream: AsyncIterable<ChatCompletionChunk>,
    modelId: string,
    progress: Progress,
    token: vscode.CancellationToken,
  ): Promise<{ reported: boolean; error?: unknown }> {
    const toolCalls = new Map<number, ToolCallBuilder>();
    let thinkingState: ThinkingState = { buffer: '', insideThinking: false };
    let reasoningOpen = false;
    let reported = false;
    let streamError: unknown;

    const startTime = Date.now();
    let ttft: number | undefined;
    let chunkCount = 0;

    const closeReasoning = () => {
      if (reasoningOpen) {
        closeReasoningBlock(progress);
        reasoningOpen = false;
      }
    };

    try {
      for await (const chunk of stream) {
        if (token.isCancellationRequested) {
          break;
        }
        // Gateways are untrusted: a malformed chunk must not crash the loop.
        for (const choice of Array.isArray(chunk.choices) ? chunk.choices : []) {
          if (!choice.delta) {
            continue;
          }

          const reasoning = reasoningFromDelta(choice.delta);
          if (reasoning) {
            ttft ??= Date.now() - startTime;
            reportReasoningDelta(reasoning, reasoningOpen, progress);
            reasoningOpen = true;
            reported = true;
          }

          const content = choice.delta.content ?? (choice.delta as { text?: unknown }).text;
          if (typeof content === 'string' && content) {
            ttft ??= Date.now() - startTime;
            closeReasoning();
            // Some models inline their reasoning as <think>…</think> in the text.
            const result = processThinkingContent(content, thinkingState);
            thinkingState = result.state;
            if (result.output) {
              progress.report(new vscode.LanguageModelTextPart(result.output));
              chunkCount++;
            }
            reported = true;
          }

          collectToolCalls(choice.delta.tool_calls, toolCalls);
          if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
            closeReasoning();
          }
          if (choice.finish_reason === 'tool_calls') {
            reportToolCalls(progress, toolCalls);
            reported = true;
          }
        }
      }
    } catch (error) {
      // A user cancel aborts the fetch. Swallow it here so it never counts as
      // a circuit-breaker failure.
      if (!token.isCancellationRequested) {
        if (reported) {
          throw error;
        }
        streamError = error;
        this.log.warn('stream failed before producing output', { error: errorText(error) });
      }
    }

    if (thinkingState.buffer) {
      progress.report(new vscode.LanguageModelTextPart(thinkingState.buffer));
    }
    closeReasoning();
    reportToolCalls(progress, toolCalls);

    if (ttft !== undefined) {
      this.lastTtftMs = ttft;
    }
    this.log.info('stream complete', { model: modelId, ttftMs: ttft ?? 0, chunks: chunkCount, totalMs: Date.now() - startTime });

    return { reported, error: streamError };
  }

  // ── Errors ───────────────────────────────────────────────────────────────

  /**
   * Turn an API failure into a readable message. Never deletes the stored
   * key: a 401 from a flaky gateway must not wipe a valid key.
   */
  protected throwMappedError(error: unknown): never {
    if (!(error instanceof ApiError)) {
      throw error;
    }

    const status = error.statusCode;
    const message = this.errorMessages[status] ?? defaultErrorMessage(this.providerDisplayName, status, error.message);
    // A saturated upstream queue reads very differently from maintenance, so
    // say which one it is when the response body tells us.
    const availability = classifyAvailability(error);
    const hint = availability && availability !== 'unavailable' ? `\n\n${AVAILABILITY_HINTS[availability]}` : '';
    throwUserError(`${message}${hint}`);
  }
}

// ── Module helpers ────────────────────────────────────────────────────────

interface ToolCallBuilder {
  id: string;
  name: string;
  arguments: string;
}

/** Tool calls arrive in fragments keyed by index; stitch them together. */
function collectToolCalls(
  deltas: ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined,
  builders: Map<number, ToolCallBuilder>,
): void {
  for (const call of deltas ?? []) {
    const index = call.index ?? 0;
    const builder = builders.get(index) ?? { id: '', name: '', arguments: '' };
    builder.id = call.id || builder.id;
    builder.name = call.function?.name || builder.name;
    builder.arguments += call.function?.arguments ?? '';
    builders.set(index, builder);
  }
}

function reportToolCalls(progress: Progress, builders: Map<number, ToolCallBuilder>): void {
  for (const builder of builders.values()) {
    if (builder.id && builder.name) {
      progress.report(new vscode.LanguageModelToolCallPart(builder.id, builder.name, parseToolArguments(builder.arguments)));
    }
  }
  builders.clear();
}

/** Providers disagree on the field name for streamed reasoning. */
function reasoningFromDelta(delta: ChatCompletionChunk.Choice.Delta): string | undefined {
  const fields = delta as Record<string, unknown>;
  for (const name of ['reasoning_content', 'reasoning', 'thought', 'thinking', 'reasoning_text']) {
    if (typeof fields[name] === 'string') {
      return fields[name];
    }
  }
  return undefined;
}

type ThinkingPartCtor = new (
  value: string | string[],
  id?: string,
  metadata?: { readonly [key: string]: unknown },
) => vscode.LanguageModelResponsePart;

/** `LanguageModelThinkingPart` is a proposed API; older VS Code builds lack it. */
function getThinkingPartCtor(): ThinkingPartCtor | undefined {
  return (vscode as { LanguageModelThinkingPart?: ThinkingPartCtor }).LanguageModelThinkingPart;
}

function reportReasoningDelta(reasoning: string, alreadyOpen: boolean, progress: Progress): void {
  const ThinkingPart = getThinkingPartCtor();
  if (ThinkingPart) {
    progress.report(new ThinkingPart(reasoning));
    return;
  }
  // Fallback: a collapsible <details> block inside the markdown answer.
  if (!alreadyOpen) {
    progress.report(new vscode.LanguageModelTextPart(THINKING_BLOCK_OPEN));
  }
  progress.report(new vscode.LanguageModelTextPart(escapeHtml(reasoning)));
}

function closeReasoningBlock(progress: Progress): void {
  const ThinkingPart = getThinkingPartCtor();
  progress.report(
    ThinkingPart
      ? new ThinkingPart('', '', { vscode_reasoning_done: true })
      : new vscode.LanguageModelTextPart(THINKING_BLOCK_CLOSE),
  );
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Plain-language message for an HTTP status. Shown in the chat panel. */
function defaultErrorMessage(provider: string, status: number, detail: string): string {
  switch (status) {
    case 0:
      return `Couldn't reach ${provider}. Check your network connection and try again. (${detail})`;
    case 400:
      return `${provider} rejected the request. Try another model or start a new chat.`;
    case 401:
      return `${provider} didn't accept your API key. Update it with "Copilot Amplify: Set API Key…". Your saved key was not changed.`;
    case 403:
      return `${provider} denied access (HTTP 403). Your API key may not include this model.`;
    case 404:
      return `${provider} doesn't offer this model anymore. Pick another model.`;
    case 408:
      return `${provider} took too long to respond. Please try again.`;
    case 413:
      return 'This conversation is too large for the model. Remove some attachments or start a new chat.';
    case 429:
      return `You've hit ${provider}'s rate limit. Wait a moment and try again.`;
    case 500:
      return `${provider} had an internal error. Please try again shortly.`;
    case 502:
    case 503:
    case 504:
    case 529:
      return `${provider} is temporarily unavailable. Please try again shortly.`;
    default:
      return `${provider} returned an error (HTTP ${status}). ${detail}`;
  }
}

function outcomeFromError(error: unknown): Omit<ProviderRequestOutcome, 'at'> {
  if (!(error instanceof ApiError)) {
    return { ok: false, category: 'error' };
  }
  const status = error.statusCode;
  const category = classifyAvailability(error)
    ?? (status === 401 || status === 403 ? 'auth-failed' : status === 429 ? 'rate-limited' : 'error');
  return { ok: false, statusCode: status > 0 ? status : undefined, category };
}

function readCircuitBreakerOptions(): { failureThreshold: number; resetTimeoutMs: number; enabled: boolean } {
  const cfg = vscode.workspace.getConfiguration('copilot-amplify.circuitBreaker');
  return {
    failureThreshold: cfg.get<number>('failureThreshold', 5),
    resetTimeoutMs: cfg.get<number>('resetTimeoutSeconds', 30) * 1000,
    enabled: cfg.get<boolean>('enabled', true),
  };
}

/** Throw an Error whose stack does not point into this file (VS Code shows it to the user). */
function throwUserError(message: string): never {
  const error = new Error(message);
  error.stack = error.stack?.split('\n').slice(1).join('\n');
  throw error;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
