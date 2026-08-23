import { GenericApiClient } from '../../core/api/client';
import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { GLM_MODELS } from '../../core/models/catalog';
import { StaticChatProvider } from '../static/chatProvider';

const BASE_URL = 'https://api.z.ai/api/coding/paas/v4';

class GlmChatProvider extends StaticChatProvider {
  protected override createProbeClient(apiKey: string): GenericApiClient {
    return new GenericApiClient(apiKey, BASE_URL, 'Z.ai GLM', 0.7);
  }

  protected override getApiClient(apiKey: string): GenericApiClient {
    return this.createProbeClient(apiKey);
  }
}

export function createZaiDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'glm',
    vendor: 'LuneCode.glm',
    displayName: 'Z.ai GLM',
    treeIcon: 'hubot',
    modelCountLabel: GLM_MODELS.length,
    createAuth: (secrets) =>
      new BaseAuthManager(secrets, 'copilot-amplify.glm.apiKey', 'Z.ai GLM', 'glm-chat-provider.apiKey'),
    createProvider: (auth) =>
      new GlmChatProvider(auth, {
        baseURL: BASE_URL,
        providerDisplayName: 'Z.ai GLM',
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
        },
      }),
  };
}
