import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { AgentrouterChatProvider } from './provider';

/**
 * AgentRouter descriptor — a first-class provider sibling of Xiaomi, Z.ai,
 * Groq, NVIDIA NIM and OmniRoute. Surfaces the AgentRouter gateway with a
 * single API key and a per-model transport (Anthropic-native for Claude,
 * OpenAI-compatible for everything else).
 *
 * The `CA-` prefix on the vendor, display name, settings section and
 * secret key keeps every externally-visible identifier scoped to
 * Copilot Amplify. This avoids collisions with other extensions that
 * might register the same vendor (`LuneCode.*`) or the same settings
 * section (`copilot-amplify.agentrouter.*`) on a user's machine.
 */
export const AGENTROUTER_VENDOR = 'LuneCode.CA-agentrouter';
export const AGENTROUTER_DISPLAY_NAME = 'CA-AgentRouter';
export const AGENTROUTER_SETTINGS_SECTION = 'copilot-amplify.CA-agentrouter';
export const AGENTROUTER_SECRET_KEY = 'copilot-amplify.CA-agentrouter.apiKey';

export function createAgentrouterDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'agentrouter',
    vendor: AGENTROUTER_VENDOR,
    displayName: AGENTROUTER_DISPLAY_NAME,
    treeIcon: 'globe',
    modelCountLabel: 'live',
    createAuth: (secrets) =>
      new BaseAuthManager(secrets, AGENTROUTER_SECRET_KEY, AGENTROUTER_DISPLAY_NAME),
    createProvider: (auth) => new AgentrouterChatProvider(auth),
  };
}
