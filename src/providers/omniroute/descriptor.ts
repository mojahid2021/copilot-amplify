import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { OmnirouteChatProvider } from './provider';

export function createOmnirouteDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'omniroute',
    vendor: 'LuneCode.CA-omniroute',
    displayName: 'OmniRoute',
    treeIcon: 'circuit-board',
    modelCountLabel: 'live',
    createAuth: (secrets) =>
      new BaseAuthManager(secrets, 'copilot-amplify.CA-omniroute.apiKey', 'OmniRoute'),
    createProvider: (auth) => new OmnirouteChatProvider(auth),
  };
}
