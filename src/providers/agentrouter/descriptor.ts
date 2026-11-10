import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { AgentrouterChatProvider } from './provider';

// The `CA-` prefix on the vendor, settings and secret ids keeps them from colliding with other extensions
// that register an "agentrouter" vendor or settings section.
export const AGENTROUTER_VENDOR = 'LuneCode.CA-agentrouter';
export const AGENTROUTER_DISPLAY_NAME = 'AgentRouter';
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
