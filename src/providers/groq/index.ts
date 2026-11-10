import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { GROQ_MODELS } from '../../core/models/catalog';
import { StaticChatProvider } from '../static/chatProvider';

const BASE_URL = 'https://api.groq.com/openai/v1';

export function createGroqDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'groq',
    vendor: 'LuneCode.CA-groq',
    displayName: 'Groq',
    treeIcon: 'rocket',
    modelCountLabel: GROQ_MODELS.length,
    createAuth: (secrets) => new BaseAuthManager(secrets, 'copilot-amplify.CA-groq.apiKey', 'Groq'),
    createProvider: (auth) =>
      new StaticChatProvider(auth, {
        baseURL: BASE_URL,
        providerDisplayName: 'Groq',
        models: GROQ_MODELS,
      }),
  };
}
