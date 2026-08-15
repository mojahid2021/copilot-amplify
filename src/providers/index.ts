/**
 * Provider Factory Module
 *
 * Consolidated exports for all LLM provider API clients and Auth managers.
 * Replaces individual micro-wrapper files with a single clean factory pattern.
 */

import * as vscode from 'vscode';
import { GenericApiClient } from '../baseApi';
import { ConfigurableChatProvider, ConfigurableChatProviderOptions } from '../baseProvider';
import { BaseAuthManager } from '../baseAuth';
import { GLM_MODELS, GROQ_MODELS, NIM_MODELS, MIMO_MODELS } from '../models';
import { OmnirouteApiClient } from '../omnirouteApi';

// ──────────────────────────────────────────────────────────────────────────────
// Base Configuration
// ──────────────────────────────────────────────────────────────────────────────

interface ProviderConfig {
  id: string;
  displayName: string;
  baseUrl: string;
  defaultTemperature: number;
  secretKey: string;
  legacySecretKey?: string;
  tokenPlanUrl?: string;
  chatProviderOptions?: Omit<ConfigurableChatProviderOptions, 'baseURL' | 'providerDisplayName'>;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  xiaomi: {
    id: 'xiaomi',
    displayName: 'Xiaomi MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    defaultTemperature: 0.7,
    secretKey: 'copilot-amplify.xiaomi.apiKey',
    legacySecretKey: 'xiaomi-mimo.apiKey',
    tokenPlanUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
    chatProviderOptions: {
      models: MIMO_MODELS,
      supportsThinking: false,
      errorMessages: {
        400: 'Invalid request format. Check parameters and message format.',
        401: 'Authentication failed. Use the Manage command to set a new key.',
        403: 'Access denied. The service may not be available in your region, or your API key is restricted.',
        421: 'Request blocked by content filter. Avoid unsafe or sensitive content.',
        429: 'Rate limit reached. Please wait and try again.',
        500: 'MiMo server error. Please try again later.',
        503: 'MiMo server overloaded. Please try again later.',
      }
    }
  },
  glm: {
    id: 'glm',
    displayName: 'Z.ai GLM',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    defaultTemperature: 0.7,
    secretKey: 'copilot-amplify.glm.apiKey',
    legacySecretKey: 'glm-chat-provider.apiKey',
    chatProviderOptions: {
      models: GLM_MODELS,
      supportsThinking: true,
      errorMessages: {
        400: 'Invalid request format. Check parameters and message format.',
        401: 'Authentication failed. Use the Manage command to set a new key.',
        403: 'Access denied. The API key may be restricted.',
        421: 'Request blocked by content filter. Avoid unsafe or sensitive content.',
        429: 'Rate limit reached. Please wait and try again.',
        500: 'GLM server error. Please try again later.',
        503: 'GLM server overloaded. Please try again later.',
      }
    }
  },
  groq: {
    id: 'groq',
    displayName: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultTemperature: 1.0,
    secretKey: 'copilot-amplify.groq.apiKey',
    chatProviderOptions: {
      models: GROQ_MODELS,
      errorMessages: {
        400: 'Invalid request format. Check parameters and message format.',
        401: 'Authentication failed. Please set a new key.',
        403: 'Access denied. The API key may be restricted for this model.',
        404: 'Model not found. Try a different Groq model.',
        429: 'Rate limit reached. Please wait and try again.',
        500: 'Groq server error. Please try again later.',
        503: 'Groq server overloaded. Please try again later.',
      }
    }
  },
  nvidia: {
    id: 'nvidia',
    displayName: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultTemperature: 0.7,
    secretKey: 'copilot-amplify.nvidia.apiKey',
    chatProviderOptions: {
      models: NIM_MODELS,
      mapModelId: (modelId: string) => {
        const NIM_MODEL_ID_MAP: Record<string, string> = {
          'gemma-4-31b-it': 'google/gemma-4-31b-it',
          'nemotron-3-ultra-550b-a55b': 'nvidia/nemotron-3-ultra-550b-a55b',
          'nemotron-3-super-120b-a12b': 'nvidia/nemotron-3-super-120b-a12b',
          'deepseek-v4-flash': 'deepseek-ai/deepseek-v4-flash',
          'deepseek-v4-pro': 'deepseek-ai/deepseek-v4-pro',
          'minimax-m3': 'minimaxai/minimax-m3',
          'step-3.5-flash': 'stepfun-ai/step-3.5-flash',
          'step-3.7-flash': 'stepfun-ai/step-3.7-flash',
          'glm-5.2': 'z-ai/glm-5.2',
          'devstral-2-123b-instruct-2512': 'mistralai/devstral-2-123b-instruct-2512',
          'kimi-k2.6': 'moonshotai/kimi-k2.6',
          'qwen3-coder-480b-a35b-instruct': 'qwen/qwen3-coder-480b-a35b-instruct',
          'granite-3.3-8b-instruct': 'ibm/granite-3.3-8b-instruct',
          'qwq-32b': 'qwen/qwq-32b',
          'falcon3-7b-instruct': 'tiiuae/falcon3-7b-instruct',
          'laguna-xs-2.1': 'poolside/laguna-xs-2.1',
          'llama-3.3-70b-instruct': 'meta/llama-3.3-70b-instruct',
        };
        return NIM_MODEL_ID_MAP[modelId] ?? modelId;
      },
      supportsThinking: (modelId: string) => ['glm-5.2', 'qwq-32b'].includes(modelId),
      errorMessages: {
        400: 'Invalid request format. Check parameters and message format.',
        401: 'Authentication failed. Please set a new key.',
        403: 'Access denied. The API key may be restricted for this model.',
        404: 'Model not found. Try a different NVIDIA NIM model.',
        421: 'Request blocked by content filter. Avoid unsafe or sensitive content.',
        429: 'Rate limit reached. Please wait and try again.',
        500: 'NVIDIA NIM server error. Please try again later.',
        503: 'NVIDIA NIM server overloaded. Please try again later.',
      }
    }
  },
  omniroute: {
    id: 'omniroute',
    displayName: 'Omniroute',
    baseUrl: 'http://localhost:20128/v1',
    defaultTemperature: 0.7,
    secretKey: 'copilot-amplify.omniroute.apiKey',
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// Auth Manager Factory
// ──────────────────────────────────────────────────────────────────────────────

export function createAuthManager(providerId: string, secrets: vscode.SecretStorage): BaseAuthManager {
  const cfg = PROVIDERS[providerId];
  if (!cfg) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return new BaseAuthManager(secrets, cfg.secretKey, cfg.displayName, cfg.legacySecretKey);
}

// ──────────────────────────────────────────────────────────────────────────────
// API Client Factory
// ──────────────────────────────────────────────────────────────────────────────

abstract class ProviderApiClient extends GenericApiClient {
  protected constructor(
    apiKey: string,
    baseUrl: string,
    displayName: string,
    defaultTemperature: number,
  ) {
    super(apiKey, baseUrl, displayName, defaultTemperature);
  }
}

class XiaomiApiClient extends ProviderApiClient {
  constructor(apiKey: string) {
    const cfg = PROVIDERS.xiaomi;
    const url = (apiKey.startsWith('tp-') && cfg.tokenPlanUrl) ? cfg.tokenPlanUrl : cfg.baseUrl;
    super(apiKey, url, cfg.displayName, cfg.defaultTemperature);
  }
}

class GlmApiClient extends ProviderApiClient {
  constructor(apiKey: string) {
    super(apiKey, PROVIDERS.glm.baseUrl, PROVIDERS.glm.displayName, PROVIDERS.glm.defaultTemperature);
  }
}

class GroqApiClient extends ProviderApiClient {
  constructor(apiKey: string) {
    super(apiKey, PROVIDERS.groq.baseUrl, PROVIDERS.groq.displayName, PROVIDERS.groq.defaultTemperature);
  }
}

class NvidiaApiClient extends ProviderApiClient {
  constructor(apiKey: string) {
    super(apiKey, PROVIDERS.nvidia.baseUrl, PROVIDERS.nvidia.displayName, PROVIDERS.nvidia.defaultTemperature);
  }
}

const apiClientCache = new Map<string, GenericApiClient>();

export function clearApiClientCache(): void {
  apiClientCache.clear();
}

export function createApiClient(providerId: string, apiKey: string, sessionId?: string): GenericApiClient {
  const cacheKey = `${providerId}:${apiKey}:${sessionId || ''}`;
  let client = apiClientCache.get(cacheKey);
  if (client) {
    return client;
  }

  switch (providerId) {
    case 'xiaomi':
      client = new XiaomiApiClient(apiKey);
      break;
    case 'glm':
      client = new GlmApiClient(apiKey);
      break;
    case 'groq':
      client = new GroqApiClient(apiKey);
      break;
    case 'nvidia':
      client = new NvidiaApiClient(apiKey);
      break;
    case 'omniroute':
      client = new OmnirouteApiClient(apiKey, { sessionId });
      break;
    default:
      throw new Error(`Unknown provider API client: ${providerId}`);
  }

  apiClientCache.set(cacheKey, client);
  return client;
}

// ──────────────────────────────────────────────────────────────────────────────
// Chat Provider Factory
// ──────────────────────────────────────────────────────────────────────────────

export function createConfigurableChatProvider(providerId: string, authManager: BaseAuthManager): ConfigurableChatProvider {
  const cfg = PROVIDERS[providerId];
  if (!cfg || !cfg.chatProviderOptions) {
    throw new Error(`Chat provider options not found for ${providerId}`);
  }
  return new ConfigurableChatProvider(authManager, {
    baseURL: cfg.baseUrl,
    providerDisplayName: cfg.displayName,
    ...cfg.chatProviderOptions,
  });
}
export { PROVIDERS };
