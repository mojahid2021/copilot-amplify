import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { NIM_KNOWN_MODELS } from '../../core/models/catalog';
import { OpenAiCompatibleProvider } from '../openaiCompatible/provider';

/** Models that take the `thinking` request field. */
const THINKING_MODEL_IDS: ReadonlySet<string> = new Set(['moonshotai/kimi-k3']);

export function createNvidiaDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'nvidia',
    vendor: 'LuneCode.CA-nvidia',
    displayName: 'NVIDIA NIM',
    treeIcon: 'server',
    createAuth: (secrets) => new BaseAuthManager(secrets, 'copilot-amplify.CA-nvidia.apiKey', 'NVIDIA NIM'),
    createProvider: (auth, state) =>
      new OpenAiCompatibleProvider(auth, state, {
        id: 'nvidia',
        displayName: 'NVIDIA NIM',
        baseURL: 'https://integrate.api.nvidia.com/v1',
        knownModels: NIM_KNOWN_MODELS,
        // The NIM list mixes in embedding, retrieval, safety, reward, parsing and
        // translation models, plus vision models that use their own endpoints.
        notChat: /embed|rerank|retriever|guard|safety|reward|clip|parse|deplot|kosmos|detector|translate|diffusion|vila|neva/i,
        // The list has no limits at all; stay inside what every chat model accepts.
        newModelDefaults: { maxInputTokens: 32_768, maxOutputTokens: 4_096, toolCalling: true },
        supportsThinking: (id) => THINKING_MODEL_IDS.has(id),
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
