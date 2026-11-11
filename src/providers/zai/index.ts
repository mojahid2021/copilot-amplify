import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { GLM_MODELS } from '../../core/models/catalog';
import { OpenAiCompatibleProvider } from '../openaiCompatible/provider';

const BASE_URL = 'https://api.z.ai/api/coding/paas/v4';

export function createZaiDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'glm',
    vendor: 'LuneCode.CA-glm',
    displayName: 'Z.ai GLM',
    treeIcon: 'hubot',
    createAuth: (secrets) =>
      new BaseAuthManager(secrets, 'copilot-amplify.CA-glm.apiKey', 'Z.ai GLM', 'glm-chat-provider.apiKey'),
    createProvider: (auth, state) =>
      new OpenAiCompatibleProvider(auth, state, {
        id: 'glm',
        displayName: 'Z.ai GLM',
        baseURL: BASE_URL,
        // Z.ai documents no model-list endpoint; without one the known models are used.
        knownModels: GLM_MODELS,
        notChat: /embed|rerank|tts|asr|cogview|cogvideo|image|video/i,
        newModelDefaults: { maxInputTokens: 32_768, maxOutputTokens: 8_192, toolCalling: true },
        supportsThinking: true,
        defaultTemperature: 0.7,
        errorMessages: {
          421: "The request was blocked by Z.ai's content filter. Try rephrasing it.",
        },
      }),
  };
}
