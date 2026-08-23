import { GenericApiClient } from '../../core/api/client';
import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { NIM_MODELS } from '../../core/models/catalog';
import { StaticChatProvider } from '../static/chatProvider';

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

/** Short catalog ids → NVIDIA NIM namespaced ids. */
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

const THINKING_MODEL_IDS = new Set(['glm-5.2', 'qwq-32b']);

class NvidiaChatProvider extends StaticChatProvider {
  protected override createProbeClient(apiKey: string): GenericApiClient {
    return new GenericApiClient(apiKey, BASE_URL, 'NVIDIA NIM', 0.7);
  }

  protected override getApiClient(apiKey: string): GenericApiClient {
    return this.createProbeClient(apiKey);
  }

  protected override mapModelId(modelId: string): string {
    return NIM_MODEL_ID_MAP[modelId] ?? modelId;
  }
}

export function createNvidiaDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'nvidia',
    vendor: 'LuneCode.nvidia',
    displayName: 'NVIDIA NIM',
    treeIcon: 'server',
    modelCountLabel: NIM_MODELS.length,
    createAuth: (secrets) => new BaseAuthManager(secrets, 'copilot-amplify.nvidia.apiKey', 'NVIDIA NIM'),
    createProvider: (auth) =>
      new NvidiaChatProvider(auth, {
        baseURL: BASE_URL,
        providerDisplayName: 'NVIDIA NIM',
        models: NIM_MODELS,
        supportsThinking: (modelId: string) => THINKING_MODEL_IDS.has(modelId),
        errorMessages: {
          400: 'Invalid request format. Check parameters and message format.',
          401: 'Authentication failed. Please set a new key.',
          403: 'Access denied. The API key may be restricted for this model.',
          404: 'Model not found. Try a different NVIDIA NIM model.',
          421: 'Request blocked by content filter. Avoid unsafe or sensitive content.',
          429: 'Rate limit reached. Please wait and try again.',
          500: 'NVIDIA NIM server error. Please try again later.',
          503: 'NVIDIA NIM server overloaded. Please try again later.',
        },
      }),
  };
}
