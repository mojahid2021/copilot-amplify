/**
 * OmniRoute model discovery — pure mapping logic + one HTTP call.
 *
 * Kept free of provider-class concerns so it is directly unit-testable with an
 * injected fetch implementation.
 */
import type * as vscode from 'vscode';
import { joinEndpoint } from '../../core/url';
import { ApiError } from '../../core/api/client';

export interface OmnirouteModelCapabilities {
  tool_calling?: boolean;
  reasoning?: boolean;
  thinking?: boolean;
  temperature?: boolean;
  vision?: boolean;
  supportsThinking?: boolean;
}

export interface OmnirouteModelRaw {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  max_input_tokens?: unknown;
  max_output_tokens?: unknown;
  capabilities?: OmnirouteModelCapabilities;
  input_modalities?: unknown;
  type?: unknown;
}

export interface OmnirouteModelsResponse {
  data?: OmnirouteModelRaw[];
}

/**
 * OmniRoute advertises a `no-thinking` variant for thinking-capable Claude
 * models (`claude-3-omniroute-no-thinking/<model>`). We detect the variant so
 * the picker shows it, the request targets the real model, and no reasoning
 * fields are emitted for it.
 */
export const NO_THINKING_PREFIX = 'claude-3-omniroute-no-thinking/';

export function normalizeModelId(id: string): string {
  return id.replaceAll('__', '/');
}

export function isNoThinkingVariant(id: string): boolean {
  return normalizeModelId(id).startsWith(NO_THINKING_PREFIX);
}

export function stripNoThinkingPrefix(id: string): string {
  const norm = normalizeModelId(id);
  return isNoThinkingVariant(norm) ? norm.slice(NO_THINKING_PREFIX.length) : id;
}

export function isChatModel(model: OmnirouteModelRaw): boolean {
  // Skip explicit non-chat model types.
  const type = typeof model.type === 'string' ? model.type.toLowerCase() : '';
  if (
    type === 'video' ||
    type === 'image' ||
    type === 'audio' ||
    type === 'embedding' ||
    type === 'embeddings' ||
    type === 'rerank' ||
    type === 'moderation' ||
    type === 'tts' ||
    type === 'stt'
  ) {
    return false;
  }

  const id = typeof model.id === 'string' ? model.id.toLowerCase() : '';
  if (
    id.includes('/embed') ||
    id.includes('-embed') ||
    id.startsWith('embed') ||
    id.includes('embedding') ||
    id.includes('/rerank') ||
    id.includes('-rerank') ||
    id.includes('/tts') ||
    id.includes('/stt') ||
    id.includes('whisper') ||
    id.includes('/moderation')
  ) {
    return false;
  }

  // If modalities are present, require text input.
  if (Array.isArray(model.input_modalities)) {
    const modalities = model.input_modalities
      .filter((mod): mod is string => typeof mod === 'string')
      .map((mod) => mod.toLowerCase());
    if (modalities.length > 0) {
      return modalities.includes('text');
    }
  }

  // No modality info — most Omniroute models are chat models.
  return true;
}

export function supportsVision(model: OmnirouteModelRaw): boolean {
  if (model.capabilities?.vision === true) {
    return true;
  }
  if (Array.isArray(model.input_modalities)) {
    return model.input_modalities.some((mod) => typeof mod === 'string' && mod.toLowerCase() === 'image');
  }
  return false;
}

export function supportsTools(model: OmnirouteModelRaw): boolean {
  if (typeof model.capabilities?.tool_calling === 'boolean') {
    return model.capabilities.tool_calling;
  }
  return true;
}

export function rawModelSupportsThinking(model: OmnirouteModelRaw, id: string): boolean {
  if (
    model.capabilities?.thinking === true ||
    model.capabilities?.reasoning === true ||
    model.capabilities?.supportsThinking === true
  ) {
    return true;
  }
  return idLikelySupportsThinking(stripNoThinkingPrefix(id));
}

export function rawAdvertisesTemperature(model: OmnirouteModelRaw): boolean | undefined {
  return typeof model.capabilities?.temperature === 'boolean'
    ? model.capabilities.temperature
    : undefined;
}

/** Heuristic over ids known to expose reasoning capability. */
export function idLikelySupportsThinking(originalId: string): boolean {
  return /thinking|reasoning|reason|cogito|qwq|deepseek-r1/i.test(originalId);
}

export function toDisplayName(raw: OmnirouteModelRaw, id: string): string {
  const realId = stripNoThinkingPrefix(id);
  let display: string;
  if (typeof raw.name === 'string' && raw.name.trim().length > 0) {
    display = raw.name.trim();
  } else if (realId.includes('/')) {
    const [prefix, ...rest] = realId.split('/') as [string | undefined, ...string[]];
    const namePart = rest.join('/');
    const safePrefix = prefix ?? realId;
    const formattedPrefix = safePrefix.charAt(0).toUpperCase() + safePrefix.slice(1);
    const formattedName = namePart
      .split(/[-:_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    display = `${formattedPrefix} · ${formattedName}`;
  } else {
    display = realId
      .split(/[-:_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  return isNoThinkingVariant(id) ? `${display} (No-thinking)` : display;
}

/**
 * VS Code's Language Model API interprets `/` as a vendor/family separator,
 * so slashed model ids are silently dropped from the Copilot Chat picker.
 * Slash encoding via `__` is reversible and collision-free for OmniRoute ids.
 */
export function encodeOmnirouteModelId(id: string): string {
  return id.replaceAll('/', '__');
}

export function decodeOmnirouteModelId(id: string): string {
  return id.replaceAll('__', '/');
}

/** Encoded picker id → upstream id sent to the server. */
export function resolveOmnirouteUpstreamModelId(encodedId: string): string {
  return stripNoThinkingPrefix(decodeOmnirouteModelId(encodedId));
}

export interface MappedOmnirouteModel {
  info: vscode.LanguageModelChatInformation;
  /** Original upstream id (unencoded). */
  upstreamId: string;
  capabilities: OmnirouteModelCapabilities | undefined;
  supportsThinking: boolean;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function mapOmnirouteModel(raw: OmnirouteModelRaw, originalId: string): MappedOmnirouteModel {
  const maxInput =
    toNumber(raw.max_input_tokens) ?? toNumber(raw.context_length) ?? 128_000;
  const maxOutput = toNumber(raw.max_output_tokens) ?? 8_192;
  const thinking = rawModelSupportsThinking(raw, originalId);

  return {
    upstreamId: originalId,
    capabilities: raw.capabilities,
    supportsThinking: thinking,
    info: {
      id: encodeOmnirouteModelId(originalId),
      name: toDisplayName(raw, originalId),
      family: 'omniroute',
      version: originalId,
      tooltip: isNoThinkingVariant(originalId) ? 'Omniroute · No-thinking' : 'Omniroute',
      detail: isNoThinkingVariant(originalId) ? 'Omniroute · No-thinking' : 'Omniroute',
      maxInputTokens: maxInput,
      maxOutputTokens: maxOutput,
      capabilities: {
        imageInput: supportsVision(raw),
        toolCalling: supportsTools(raw),
      },
    },
  };
}

/**
 * Filter + map the raw `/models` payload into picker-ready entries.
 * Returns an empty array when nothing is chat-capable.
 */
export function mapOmnirouteModelsResponse(json: OmnirouteModelsResponse): MappedOmnirouteModel[] {
  if (!Array.isArray(json.data)) {
    return [];
  }
  return json.data
    .filter((model): model is OmnirouteModelRaw & { id: string } =>
      Boolean(model) && typeof model.id === 'string' && isChatModel(model))
    .map((model) => mapOmnirouteModel(model, model.id));
}

const ANONYMOUS_KEY = 'omniroute';

export interface FetchModelsArgs {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  token?: vscode.CancellationToken;
  fetchImpl?: typeof fetch;
  /** External abort signal — when aborted, the request is canceled cooperatively. */
  signal?: AbortSignal;
}

/**
 * Low-level `GET {baseUrl}/models` returning validated chat models.
 * Throws ApiError on non-2xx responses (status preserved).
 */
export async function fetchOmnirouteModels(args: FetchModelsArgs): Promise<MappedOmnirouteModel[]> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), args.timeoutMs);
  timeout.unref?.();
  const cancellationDisposable = args.token?.onCancellationRequested(() => abortController.abort());
  // Bridge the external signal into our internal AbortController.
  const onExternalAbort = () => abortController.abort();
  if (args.signal) {
    if (args.signal.aborted) {
      abortController.abort();
    } else {
      args.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    const endpoint = joinEndpoint(args.baseUrl, '/models');
    const key = args.apiKey && args.apiKey.trim().length > 0 ? args.apiKey.trim() : ANONYMOUS_KEY;

    const response = await (args.fetchImpl ?? fetch)(endpoint, {
      headers: { Authorization: `Bearer ${key}` },
      signal: abortController.signal,
    });

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      // Capture headers so Retry-After from discovery responses is honored.
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      throw toApiError(response.status, body, headers);
    }

    const json = (await response.json()) as OmnirouteModelsResponse;
    return mapOmnirouteModelsResponse(json);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw error; // AbortError / network errors handled by callers
  } finally {
    clearTimeout(timeout);
    args.signal?.removeEventListener('abort', onExternalAbort);
    cancellationDisposable?.dispose();
  }
}

function toApiError(status: number, body: unknown, headers?: Record<string, string>): ApiError {
  let detail = '';
  if (body && typeof body === 'object') {
    const error = (body as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === 'string') {
      detail = error.message;
    }
  }
  return new ApiError(`Omniroute API error: ${status}${detail ? ` ${detail}` : ''}`, status, body, headers);
}
