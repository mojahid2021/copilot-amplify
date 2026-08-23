import { GenericApiClient } from '../../core/api/client';
import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { GROQ_MODELS } from '../../core/models/catalog';
import { StaticChatProvider } from '../static/chatProvider';

const BASE_URL = 'https://api.groq.com/openai/v1';

class GroqChatProvider extends StaticChatProvider {
  protected override createProbeClient(apiKey: string): GenericApiClient {
    return new GenericApiClient(apiKey, BASE_URL, 'Groq', 1.0);
  }

  protected override getApiClient(apiKey: string): GenericApiClient {
    return this.createProbeClient(apiKey);
  }
}

export function createGroqDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'groq',
    vendor: 'LuneCode.groq',
    displayName: 'Groq',
    treeIcon: 'rocket',
    modelCountLabel: GROQ_MODELS.length,
    createAuth: (secrets) => new BaseAuthManager(secrets, 'copilot-amplify.groq.apiKey', 'Groq'),
    createProvider: (auth) =>
      new GroqChatProvider(auth, {
        baseURL: BASE_URL,
        providerDisplayName: 'Groq',
        models: GROQ_MODELS,
        errorMessages: {
          400: 'Invalid request format. Check parameters and message format.',
          401: 'Authentication failed. Please set a new key.',
          403: 'Access denied. The API key may be restricted for this model.',
          404: 'Model not found. Try a different Groq model.',
          429: 'Rate limit reached. Please wait and try again.',
          500: 'Groq server error. Please try again later.',
          503: 'Groq server overloaded. Please try again later.',
        },
      }),
  };
}
