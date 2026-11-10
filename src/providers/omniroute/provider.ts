import type * as vscode from 'vscode';
import type { BaseAuthManager } from '../../core/auth/authManager';
import { DynamicCatalogProvider } from '../../core/provider/dynamicCatalogProvider';
import type { ConnectionTestResult, ProviderHealth } from '../../core/provider/registry';
import { OmnirouteApiClient } from './api';
import {
  getOmnirouteBaseUrl,
  getOmnirouteConfig,
  isOmnirouteBaseUrlConfigured,
  onDidChangeOmnirouteConfig,
} from './config';
import { testOmnirouteConnection } from './connectionTest';
import {
  clearOmnirouteModelCapabilities,
  omnirouteModelAdvertisesThinking,
  registerOmnirouteModelCapabilities,
} from './modelRegistry';
import {
  ANONYMOUS_KEY,
  decodeOmnirouteModelId,
  fetchOmnirouteModels,
  isNoThinkingVariant,
  resolveOmnirouteUpstreamModelId,
  stripNoThinkingPrefix,
} from './models';

/**
 * OmniRoute: a self-hosted, OpenAI-compatible router. The user points us at
 * the server URL; an API key is optional (anonymous access works).
 */
export class OmnirouteChatProvider extends DynamicCatalogProvider {
  protected override readonly providerDisplayName = 'OmniRoute';
  protected override readonly errorMessages: Record<number, string> = {
    421: "The request was blocked by OmniRoute's content filter. Try rephrasing it.",
    502: 'The model behind OmniRoute is unavailable right now. Try again, or pick another model.',
    504: 'The model behind OmniRoute took too long to respond. Try again, or pick another model.',
  };

  private thinkingModelIds = new Set<string>();

  constructor(authManager: BaseAuthManager) {
    super(authManager, {
      cacheTtlMs: getOmnirouteConfig().modelCacheTtlMs,
      onDidChangeConfig: onDidChangeOmnirouteConfig,
      settingsSection: 'copilot-amplify.CA-omniroute',
    });
  }

  protected override get baseURL(): string {
    return getOmnirouteBaseUrl();
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const apiKey = await this.authManager.getApiKey();
    return testOmnirouteConnection({ baseUrl: getOmnirouteBaseUrl(), apiKey });
  }

  override refreshCaches(): void {
    super.refreshCaches();
    clearOmnirouteModelCapabilities();
  }

  protected override async canLoadModels(): Promise<boolean> {
    return isOmnirouteBaseUrlConfigured();
  }

  protected override setupHealth(): ProviderHealth | undefined {
    return isOmnirouteBaseUrlConfigured()
      ? undefined
      : { configured: false, status: 'setup-required', detail: 'Set the server URL to load models' };
  }

  protected override async fetchModels(signal?: AbortSignal): Promise<vscode.LanguageModelChatInformation[]> {
    const discovered = await fetchOmnirouteModels({
      baseUrl: getOmnirouteBaseUrl(),
      apiKey: await this.authManager.getApiKey(),
      timeoutMs: getOmnirouteConfig().discoveryTimeoutMs,
      signal,
    });
    if (!discovered.length) {
      throw new Error('OmniRoute did not return any chat-capable models');
    }

    this.thinkingModelIds = new Set(discovered.filter((m) => m.supportsThinking).map((m) => m.upstreamId));
    for (const model of discovered) {
      const temperature = model.capabilities?.temperature;
      registerOmnirouteModelCapabilities(model.upstreamId, {
        ...(temperature !== undefined ? { temperature } : {}),
        ...(model.supportsThinking ? { thinking: true } : {}),
      });
    }
    return discovered.map((m) => m.info);
  }

  protected override displayModelId(modelId: string): string {
    return decodeOmnirouteModelId(modelId);
  }

  protected override modelSupportsReasoning(modelId: string): boolean {
    return this.thinkingModelIds.has(decodeOmnirouteModelId(modelId));
  }

  /** OmniRoute allows anonymous access, so never prompt for a key. */
  protected override async resolveApiKey(): Promise<string> {
    return (await this.authManager.getApiKey()) || ANONYMOUS_KEY;
  }

  protected override getApiClient(apiKey: string): OmnirouteApiClient {
    return new OmnirouteApiClient(apiKey);
  }

  protected override mapModelId(modelId: string): string {
    return resolveOmnirouteUpstreamModelId(modelId);
  }

  protected override supportsThinking(modelId: string): boolean {
    const decoded = decodeOmnirouteModelId(modelId);
    if (isNoThinkingVariant(decoded)) {
      return false;
    }
    return omnirouteModelAdvertisesThinking(stripNoThinkingPrefix(decoded)) ?? this.thinkingModelIds.has(decoded);
  }
}
