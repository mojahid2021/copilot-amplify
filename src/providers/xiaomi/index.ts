import { GenericApiClient } from '../../core/api/client';
import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { MIMO_MODELS } from '../../core/models/catalog';
import { StaticChatProvider } from '../static/chatProvider';

const BASE_URL = 'https://api.xiaomimimo.com/v1';
/** Token-plan keys (`tp-…`) are served from a dedicated gateway. */
const TOKEN_PLAN_URL = 'https://token-plan-sgp.xiaomimimo.com/v1';

class XiaomiChatProvider extends StaticChatProvider {
  protected override createProbeClient(apiKey: string): GenericApiClient {
    const url = apiKey.startsWith('tp-') ? TOKEN_PLAN_URL : BASE_URL;
    return new GenericApiClient(apiKey, url, 'Xiaomi MiMo', 0.7);
  }

  protected override getApiClient(apiKey: string): GenericApiClient {
    return this.createProbeClient(apiKey);
  }
}

export function createXiaomiDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'xiaomi',
    vendor: 'LuneCode.xiaomi',
    displayName: 'Xiaomi MiMo',
    treeIcon: 'device-mobile',
    modelCountLabel: MIMO_MODELS.length,
    createAuth: (secrets) =>
      new BaseAuthManager(secrets, 'copilot-amplify.xiaomi.apiKey', 'Xiaomi MiMo', 'xiaomi-mimo.apiKey'),
    createProvider: (auth) =>
      new XiaomiChatProvider(auth, {
        baseURL: BASE_URL,
        providerDisplayName: 'Xiaomi MiMo',
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
        },
      }),
  };
}
