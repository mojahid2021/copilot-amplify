import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { GLM_MODELS } from '../../core/models/catalog';
import { StaticChatProvider } from '../static/chatProvider';

const BASE_URL = 'https://api.z.ai/api/coding/paas/v4';

export function createZaiDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'glm',
    vendor: 'LuneCode.CA-glm',
    displayName: 'Z.ai GLM',
    treeIcon: 'hubot',
    modelCountLabel: GLM_MODELS.length,
    createAuth: (secrets) =>
      new BaseAuthManager(secrets, 'copilot-amplify.CA-glm.apiKey', 'Z.ai GLM', 'glm-chat-provider.apiKey'),
    createProvider: (auth) =>
      new StaticChatProvider(auth, {
        baseURL: BASE_URL,
        providerDisplayName: 'Z.ai GLM',
        models: GLM_MODELS,
        supportsThinking: true,
        defaultTemperature: 0.7,
        errorMessages: {
          421: "The request was blocked by Z.ai's content filter. Try rephrasing it.",
        },
      }),
  };
}
