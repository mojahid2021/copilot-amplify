import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { MIMO_MODELS } from '../../core/models/catalog';
import { OpenAiCompatibleProvider } from '../openaiCompatible/provider';

const BASE_URL = 'https://api.xiaomimimo.com/v1';
/** Token-plan keys (`tp-…`) are served from a dedicated gateway. */
const TOKEN_PLAN_URL = 'https://token-plan-sgp.xiaomimimo.com/v1';

export function createXiaomiDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'xiaomi',
    vendor: 'LuneCode.CA-xiaomi',
    displayName: 'Xiaomi MiMo',
    treeIcon: 'device-mobile',
    createAuth: (secrets) =>
      new BaseAuthManager(secrets, 'copilot-amplify.CA-xiaomi.apiKey', 'Xiaomi MiMo', 'xiaomi-mimo.apiKey'),
    createProvider: (auth, state) =>
      new OpenAiCompatibleProvider(auth, state, {
        id: 'xiaomi',
        displayName: 'Xiaomi MiMo',
        baseURL: BASE_URL,
        baseUrlForKey: (apiKey) => (apiKey.startsWith('tp-') ? TOKEN_PLAN_URL : BASE_URL),
        // A model-list endpoint is not documented; without one the known models are used.
        knownModels: MIMO_MODELS,
        notChat: /tts|voice/i,
        newModelDefaults: { maxInputTokens: 32_768, maxOutputTokens: 8_192, toolCalling: true },
        defaultTemperature: 0.7,
        errorMessages: {
          403: 'Xiaomi MiMo denied access. The service may not be available in your region, or your API key is restricted.',
          421: "The request was blocked by Xiaomi MiMo's content filter. Try rephrasing it.",
        },
      }),
  };
}
