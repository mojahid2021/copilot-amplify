import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { OmnirouteChatProvider } from './provider';

/**
 * OmniRoute descriptor — a first-class provider sibling of Xiaomi, Z.ai,
 * Groq and NVIDIA NIM. Its internal multi-provider routing lives entirely on
 * the OmniRoute server; Copilot Amplify only ever talks to the configured
 * base URL.
 */
export function createOmnirouteDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'omniroute',
    vendor: 'LuneCode.omniroute',
    displayName: 'OmniRoute',
    treeIcon: 'circuit-board',
    modelCountLabel: 'live',
    createAuth: (secrets) =>
      new BaseAuthManager(secrets, 'copilot-amplify.omniroute.apiKey', 'OmniRoute'),
    createProvider: (auth) => new OmnirouteChatProvider(auth),
  };
}
