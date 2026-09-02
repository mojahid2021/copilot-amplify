/**
 * AgentRouter provider barrel.
 *
 * Re-exports the descriptor (consumed by `src/providers/index.ts`) and the
 * provider class (re-exported for tests and the optional `warmupNow`
 * call sites).
 */

export { createAgentrouterDescriptor } from './descriptor';
export { AgentrouterChatProvider } from './provider';
export {
  getAgentrouterConfig,
  getAgentrouterOpenaiBaseUrl,
  getAgentrouterAnthropicBaseUrl,
  getAgentrouterDiscoveryBaseUrl,
  onDidChangeAgentrouterConfig,
  disposeAgentrouterConfig,
} from './config';
export {
  fetchAgentrouterPricing,
  fetchAgentrouterPricingFromConfig,
  mapAgentrouterPricingResponse,
  mapAgentrouterModel,
  type DiscoveredAgentrouterModel,
  type AgentrouterEndpointType,
} from './discovery';
export {
  buildAgentrouterCatalog,
  resolveAgentrouterTransport,
  agentrouterDisplayName,
} from './catalog';
export { testAgentrouterConnection } from './connectionTest';
