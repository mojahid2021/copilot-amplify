/**
 * Provider registry assembly.
 *
 * Every provider is registered here as an equal sibling. Adding a provider =
 * adding a descriptor module + one `register()` call below. No core changes.
 */

import type * as vscode from 'vscode';
import { ProviderRegistry } from '../core/provider/registry';
import { createXiaomiDescriptor } from './xiaomi';
import { createZaiDescriptor } from './zai';
import { createGroqDescriptor } from './groq';
import { createNvidiaDescriptor } from './nvidia';
import { createOmnirouteDescriptor } from './omniroute/descriptor';

export type { ProviderId, AmplifyProviderDescriptor, ProviderHealth, ConnectionTestResult, ProviderTreeModel } from '../core/provider/registry';
export { ProviderRegistry } from '../core/provider/registry';

export function createProviderRegistry(secrets: vscode.SecretStorage): ProviderRegistry {
  const registry = new ProviderRegistry(secrets);
  registry.register(createXiaomiDescriptor());
  registry.register(createZaiDescriptor());
  registry.register(createGroqDescriptor());
  registry.register(createNvidiaDescriptor());
  registry.register(createOmnirouteDescriptor());
  return registry;
}

/** Provider ids in stable display order (used by QuickPicks and the tree). */
export const PROVIDER_ORDER = ['xiaomi', 'glm', 'groq', 'nvidia', 'omniroute'] as const;
