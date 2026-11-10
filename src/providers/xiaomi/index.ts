import { GenericApiClient } from '../../core/api/client';
import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { MIMO_MODELS } from '../../core/models/catalog';
import { StaticChatProvider } from '../static/chatProvider';

const BASE_URL = 'https://api.xiaomimimo.com/v1';
/** Token-plan keys (`tp-…`) are served from a dedicated gateway. */
const TOKEN_PLAN_URL = 'https://token-plan-sgp.xiaomimimo.com/v1';

class XiaomiChatProvider extends StaticChatProvider {
  protected override getApiClient(apiKey: string): GenericApiClient {
    const url = apiKey.startsWith('tp-') ? TOKEN_PLAN_URL : BASE_URL;
    return new GenericApiClient(apiKey, url, this.providerDisplayName, this.defaultTemperature);
  }
}

export function createXiaomiDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'xiaomi',
    vendor: 'LuneCode.CA-xiaomi',
    displayName: 'Xiaomi MiMo',
    treeIcon: 'device-mobile',
    modelCountLabel: MIMO_MODELS.length,
    createAuth: (secrets) =>
      new BaseAuthManager(secrets, 'copilot-amplify.CA-xiaomi.apiKey', 'Xiaomi MiMo', 'xiaomi-mimo.apiKey'),
    createProvider: (auth) =>
      new XiaomiChatProvider(auth, {
        baseURL: BASE_URL,
        providerDisplayName: 'Xiaomi MiMo',
        models: MIMO_MODELS,
        defaultTemperature: 0.7,
        errorMessages: {
          403: 'Xiaomi MiMo denied access. The service may not be available in your region, or your API key is restricted.',
          421: "The request was blocked by Xiaomi MiMo's content filter. Try rephrasing it.",
        },
      }),
  };
}
