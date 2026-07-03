import type * as vscode from 'vscode';
import { BaseChatProvider } from './baseProvider';
import { MIMO_MODELS } from './models';
import { BASE_URL, MiMoApiClient, TOKEN_PLAN_BASE_URL } from './api';
import type { BaseAuthManager } from './baseAuth';

interface XiaomiModelListResponse {
  data?: { id?: unknown }[];
}

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

function getModelsEndpoint(apiKey: string): string {
  const baseURL = apiKey.startsWith('tp-') ? TOKEN_PLAN_BASE_URL : BASE_URL;
  return `${baseURL}/models`;
}

function isXiaomiChatModelId(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.startsWith('mimo-') && !/(?:-asr|-tts)(?:$|-)/.test(id);
}

function toDisplayName(modelId: string): string {
  return `MiMo-${modelId
    .replace(/^mimo-/i, '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.toUpperCase().startsWith('V')
      ? part.toUpperCase()
      : part.charAt(0).toUpperCase() + part.slice(1))
    .join('-')}`;
}

function supportsImageInput(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id === 'mimo-v2.5' || id.includes('omni') || id.includes('vision');
}

function toModelInfo(modelId: string): vscode.LanguageModelChatInformation {
  const id = modelId.toLowerCase();

  return {
    id: modelId,
    name: toDisplayName(modelId),
    family: 'mimo',
    version: modelId.replace(/^mimo-/i, ''),
    tooltip: 'Xiaomi',
    detail: 'Xiaomi',
    maxInputTokens: id.includes('pro') ? 1048576 : 262144,
    maxOutputTokens: 131072,
    capabilities: {
      imageInput: supportsImageInput(modelId),
      toolCalling: true,
    },
  };
}

export async function fetchXiaomiChatModels(
  apiKey: string,
  token?: vscode.CancellationToken,
): Promise<vscode.LanguageModelChatInformation[]> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 8000);
  const cancellationDisposable = token?.onCancellationRequested(() => abortController.abort());

  try {
    const response = await fetch(getModelsEndpoint(apiKey), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Xiaomi models request failed with HTTP ${response.status}`);
    }

    const json = (await response.json()) as XiaomiModelListResponse;
    const models = Array.isArray(json.data)
      ? json.data
        .map((model) => typeof model.id === 'string' ? model.id : undefined)
        .filter((modelId): modelId is string => (
          typeof modelId === 'string' && isXiaomiChatModelId(modelId)
        ))
        .map((modelId) => toModelInfo(modelId))
      : [];

    if (!models.length) {
      throw new Error('Xiaomi did not return any chat-capable MiMo models');
    }

    return models;
  } finally {
    clearTimeout(timeout);
    cancellationDisposable?.dispose();
  }
}

export class MiMoChatProvider extends BaseChatProvider {
  protected override readonly baseURL = BASE_URL;
  protected override readonly providerDisplayName = 'Xiaomi';
  protected override readonly models = MIMO_MODELS;

  private modelCache?: vscode.LanguageModelChatInformation[];
  private modelCacheExpiresAt = 0;

  constructor(authManager: BaseAuthManager) {
    super(authManager);
    this.authManager.onDidChangeApiKey(() => {
      this.modelCache = undefined;
      this.modelCacheExpiresAt = 0;
    });
  }

  protected override getApiClient(apiKey: string): MiMoApiClient {
    return new MiMoApiClient(apiKey);
  }

  private async getModels(
    apiKey: string,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const now = Date.now();
    if (this.modelCache && now < this.modelCacheExpiresAt) {
      return this.modelCache;
    }

    try {
      const models = await fetchXiaomiChatModels(apiKey, token);
      this.modelCache = models;
      this.modelCacheExpiresAt = now + MODEL_CACHE_TTL_MS;
      return models;
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      console.warn(`Extra Chat Providers: using bundled Xiaomi model list (${details}).`);
      return this.models;
    }
  }

  override async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const apiKey = await this.authManager.getApiKey();
    if (apiKey) {
      return this.getModels(apiKey, token);
    }

    if (!options.silent) {
      await this.authManager.promptForApiKey();
      const newKey = await this.authManager.getApiKey();
      if (newKey) {
        return this.getModels(newKey, token);
      }
    }

    return [];
  }

  protected override readonly errorMessages: Record<number, string> = {
    400: 'Invalid request format. Check parameters and message format.',
    401: 'Authentication failed. Use the Manage command to set a new key.',
    403: 'Access denied. The service may not be available in your region, or your API key is restricted.',
    421: 'Request blocked by content filter. Avoid unsafe or sensitive content.',
    429: 'Rate limit reached. Please wait and try again.',
    500: 'MiMo server error. Please try again later.',
    503: 'MiMo server overloaded. Please try again later.',
  };
}
