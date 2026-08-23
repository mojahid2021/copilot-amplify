export { OmnirouteChatProvider } from './provider';
export { OmnirouteApiClient, buildOmnirouteRequestHeaders } from './api';
export {
  encodeOmnirouteModelId,
  decodeOmnirouteModelId,
  resolveOmnirouteUpstreamModelId,
  fetchOmnirouteModels,
  isNoThinkingVariant,
  stripNoThinkingPrefix,
} from './models';
export { getOmnirouteBaseUrl, getOmnirouteConfig, onDidChangeOmnirouteConfig, DEFAULT_BASE_URL } from './config';
export { testOmnirouteConnection } from './connectionTest';
export { buildOmnirouteDiagnostics, showOmnirouteDiagnostics } from './diagnostics';
export { clearOmnirouteModelCapabilities } from './modelRegistry';
export { resolveOmnirouteSessionId } from './session';
