import type * as vscode from 'vscode';
import { ProviderRegistry } from '../core/provider/registry';
import { createXiaomiDescriptor } from './xiaomi';
import { createZaiDescriptor } from './zai';
import { createGroqDescriptor } from './groq';
import { createNvidiaDescriptor } from './nvidia';
import { createOmnirouteDescriptor } from './omniroute/descriptor';
import { createAgentrouterDescriptor } from './agentrouter/descriptor';

/** Every provider the extension ships. Registration order is display order. */
export function createProviderRegistry(secrets: vscode.SecretStorage): ProviderRegistry {
  const registry = new ProviderRegistry(secrets);
  registry.register(createXiaomiDescriptor());
  registry.register(createZaiDescriptor());
  registry.register(createGroqDescriptor());
  registry.register(createNvidiaDescriptor());
  registry.register(createOmnirouteDescriptor());
  registry.register(createAgentrouterDescriptor());
  return registry;
}
