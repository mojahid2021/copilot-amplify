import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { NIM_MODELS } from '../../core/models/catalog';
import { StaticChatProvider } from '../static/chatProvider';

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

/** Short catalog ids → the namespaced ids NIM expects. */
const NIM_MODEL_IDS: Readonly<Record<string, string>> = {
  'deepseek-v4-pro-0813': 'deepseek-ai/deepseek-v4-pro-0813',
  'deepseek-v4-flash-0731': 'deepseek-ai/deepseek-v4-flash-0731',
  'nemotron-3-ultra-550b-a55b': 'nvidia/nemotron-3-ultra-550b-a55b',
  'kimi-k3': 'moonshotai/kimi-k3',
  'laguna-xs-2.1': 'poolside/laguna-xs-2.1',
  'minimax-m3': 'minimaxai/minimax-m3',
  'gemma-4-31b-it': 'google/gemma-4-31b-it',
  'gpt-oss-120b': 'openai/gpt-oss-120b',
  'mistral-nemotron': 'mistralai/mistral-nemotron',
};

const THINKING_MODEL_IDS: ReadonlySet<string> = new Set(['kimi-k3']);

export function createNvidiaDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'nvidia',
    vendor: 'LuneCode.CA-nvidia',
    displayName: 'NVIDIA NIM',
    treeIcon: 'server',
    modelCountLabel: NIM_MODELS.length,
    createAuth: (secrets) => new BaseAuthManager(secrets, 'copilot-amplify.CA-nvidia.apiKey', 'NVIDIA NIM'),
    createProvider: (auth) =>
      new StaticChatProvider(auth, {
        baseURL: BASE_URL,
        providerDisplayName: 'NVIDIA NIM',
        models: NIM_MODELS,
        mapModelId: (modelId) => NIM_MODEL_IDS[modelId] ?? modelId,
        supportsThinking: (modelId) => THINKING_MODEL_IDS.has(modelId),
        // 0.7 keeps reasoning models' tool-call JSON stable.
        defaultTemperature: 0.7,
        errorMessages: {
          415: 'NVIDIA NIM does not accept this attachment type.',
          422: "The request was blocked by NVIDIA NIM's content policy. Try rephrasing it.",
          451: 'NVIDIA NIM does not offer this model in your region.',
        },
      }),
  };
}
