import * as vscode from 'vscode';
import { fetchOmnirouteModels, OmnirouteChatProvider, resolveOmnirouteUpstreamModelId } from './omnirouteProvider';
import { getOmnirouteLogChannel, OmnirouteApiClient } from './omnirouteApi';
import { GenericApiClient } from './baseApi';
import type { BaseAuthManager } from './baseAuth';
import { ProvidersTreeDataProvider, ProviderTreeItem, ModelTreeItem } from './treeProvider';
import { PROVIDERS, createAuthManager, createApiClient, createConfigurableChatProvider, clearApiClientCache } from './providers';

const PROVIDER_VENDORS = {
  xiaomi:    'LuneCode.xiaomi',
  glm:       'LuneCode.glm',
  groq:      'LuneCode.groq',
  nvidia:    'LuneCode.nvidia',
  omniroute: 'LuneCode.omniroute',
} as const;

interface ProviderConfig {
  id: keyof typeof PROVIDER_VENDORS;
  displayName: string;
  vendor:     string;
  authManager: BaseAuthManager;
  provider:   vscode.LanguageModelChatProvider;
  manageActions: Record<string, () => Promise<void>>;
}

type TestModelResolver = string | ((key: string) => Promise<string>);

function getAuthManager(id: string, authManagers: Record<string, BaseAuthManager>): BaseAuthManager | undefined {
  return authManagers[id];
}

function getTestInfo(id: string): { modelId: TestModelResolver, clientFactory: (k: string) => GenericApiClient } {
  if (id === 'omniroute') return { modelId: getLatestOmnirouteChatModel, clientFactory: (k) => new OmnirouteApiClient(k, {}) };
  if (id === 'xiaomi') return { modelId: getLatestXiaomiChatModel, clientFactory: (k) => createApiClient('xiaomi', k) };
  return { modelId: PROVIDERS[id]?.chatProviderOptions?.models[0]?.id || '', clientFactory: (k) => createApiClient(id, k) };
}

function displayName(id: string): string {
  return PROVIDERS[id]?.displayName || id;
}

async function testConnection(
  authManager: BaseAuthManager,
  clientFactory: (key: string) => GenericApiClient,
  modelId: TestModelResolver,
  providerDisplayName: string,
): Promise<void> {
  let key = await authManager.getApiKey();
  if (!key) {
    if (providerDisplayName === 'Omniroute') {
      key = 'omniroute';
    } else {
      const choice = await vscode.window.showInformationMessage(
        `${providerDisplayName} API key is not set. Would you like to set it now?`,
        'Set API Key',
      );
      if (choice === 'Set API Key') {
        await authManager.promptForApiKey();
      }
      return;
    }
  }
  const client = clientFactory(key);
  try {
    const resolvedModelId = typeof modelId === 'function' ? await modelId(key) : modelId;
    await client.chat(resolvedModelId, [{ role: 'user', content: 'Ping' }], { maxTokens: 1 });
    vscode.window.showInformationMessage(`${providerDisplayName} provider test succeeded.`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`${providerDisplayName} test failed: ${msg}`);
  }
}

function registerProviderSafely(
  context: vscode.ExtensionContext,
  vendorId: string,
  dName: string,
  provider: vscode.LanguageModelChatProvider,
): void {
  try {
    context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(vendorId, provider));
  } catch (err) {
    console.warn(`Could not register provider for ${dName}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function getLatestOmnirouteChatModel(key: string): Promise<string> {
  const models = await fetchOmnirouteModels(key);
  const best = models.find((m) => m.id.includes('best-coding'));
  if (best) return resolveOmnirouteUpstreamModelId(best.id);
  if (models.length > 0) return resolveOmnirouteUpstreamModelId(models[0].id);
  throw new Error('No models found for test connection.');
}

async function getLatestXiaomiChatModel(): Promise<string> {
  return 'mimo-v2.5-pro';
}

export function activate(context: vscode.ExtensionContext): void {
  const authManagers: Record<string, BaseAuthManager> = {};
  for (const id of Object.keys(PROVIDERS)) {
    const authManager = createAuthManager(id, context.secrets);
    authManagers[id] = authManager;
    context.subscriptions.push(authManager);
  }

  const omnirouteChatProvider = new OmnirouteChatProvider(authManagers['omniroute']);

  context.subscriptions.push(
    omnirouteChatProvider,
  );

  const treeDataProvider = new ProvidersTreeDataProvider(authManagers, context);

  context.subscriptions.push(
    treeDataProvider,
    vscode.window.createTreeView('copilot-amplify.providers', { treeDataProvider }),
  );

  const providers: ProviderConfig[] = [];

  for (const [id, cfg] of Object.entries(PROVIDERS)) {
    const isOmniroute = id === 'omniroute';
    const authManager = authManagers[id];

    // Dynamic models for Xiaomi and Omniroute testing
    const testModelResolver = id === 'omniroute'
      ? getLatestOmnirouteChatModel
      : id === 'xiaomi'
        ? getLatestXiaomiChatModel
        : cfg.chatProviderOptions?.models[0]?.id || '';

    const providerInstance = isOmniroute
      ? omnirouteChatProvider
      : createConfigurableChatProvider(id, authManager);

    if (!isOmniroute) {
      context.subscriptions.push(providerInstance);
    }

    providers.push({
      id: id as keyof typeof PROVIDER_VENDORS,
      displayName: cfg.displayName,
      vendor: PROVIDER_VENDORS[id as keyof typeof PROVIDER_VENDORS],
      authManager,
      provider: providerInstance,
      manageActions: {
        'Set API Key':    async () => {
          try {
            await authManager.promptForApiKey();
            clearApiClientCache();
            if (isOmniroute) omnirouteChatProvider.invalidateModelCache();
            treeDataProvider.refresh();
          } catch {
            /* ignore error on action prompt cancel */
          }
        },
        'Clear API Key':  async () => {
          try {
            await authManager.deleteApiKey();
            clearApiClientCache();
            if (isOmniroute) omnirouteChatProvider.invalidateModelCache();
            treeDataProvider.refresh();
          } catch {
            /* ignore error on action clear cancel */
          }
        },
        'Test Connection': () => testConnection(
          authManager,
          isOmniroute ? (k) => new OmnirouteApiClient(k, {}) : (k) => createApiClient(id, k),
          testModelResolver,
          cfg.displayName
        ),
      },
    });
  }

  // Register all language model providers
  for (const cfg of providers) {
    registerProviderSafely(context, cfg.vendor, cfg.displayName, cfg.provider);
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-amplify.refresh', () => {
      clearApiClientCache();
      omnirouteChatProvider.invalidateModelCache();
      treeDataProvider.refresh();
    }),

    vscode.commands.registerCommand('copilot-amplify.provider.click', async (item: ProviderTreeItem) => {
      const id = item?.providerId;
      if (!id) { return; }
      const auth = getAuthManager(id, authManagers);
      if (!auth) { return; }
      if (id === 'omniroute' || (await auth.getApiKey())) {
        const { modelId, clientFactory } = getTestInfo(id);
        await testConnection(auth, clientFactory, modelId, displayName(id));
      } else {
        await auth.promptForApiKey();
        treeDataProvider.refresh();
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.setApiKey', async (item: ProviderTreeItem) => {
      const id = item?.providerId;
      if (!id) { return; }
      const auth = getAuthManager(id, authManagers);
      if (auth) { await auth.promptForApiKey(); treeDataProvider.refresh(); }
    }),

    vscode.commands.registerCommand('copilot-amplify.testConnection', async (item: ProviderTreeItem) => {
      const id = item?.providerId;
      if (!id) { return; }
      const auth = getAuthManager(id, authManagers);
      if (auth) { const { modelId, clientFactory } = getTestInfo(id); await testConnection(auth, clientFactory, modelId, displayName(id)); }
    }),

    vscode.commands.registerCommand('copilot-amplify.clearApiKey', async (item: ProviderTreeItem) => {
      const id = item?.providerId;
      if (!id) { return; }
      const auth = getAuthManager(id, authManagers);
      if (auth) { await auth.deleteApiKey(); vscode.window.showInformationMessage(`${displayName(id)} API key cleared`); treeDataProvider.refresh(); }
    }),

    vscode.commands.registerCommand('copilot-amplify.pinModel', (item?: ModelTreeItem) => {
      if (item && item.providerId && item.modelId) {
        const name = typeof item.label === 'string' ? item.label : item.modelId;
        treeDataProvider.pinModel(item.providerId, item.modelId, name);
        vscode.window.showInformationMessage(`Pinned ${name} to Favorites`);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.unpinModel', (item?: ModelTreeItem) => {
      if (item && item.providerId && item.modelId) {
        treeDataProvider.unpinModel(item.providerId, item.modelId);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.selectModel', async (item?: ModelTreeItem) => {
      if (item && item.providerId && item.modelId) {
        treeDataProvider.setActiveModel(item.providerId, item.modelId);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.documentation', () => {
      void vscode.env.openExternal(vscode.Uri.parse('https://github.com/mojahid2021/copilot-amplify#readme'));
    }),
    vscode.commands.registerCommand('copilot-amplify.report', () => {
      void vscode.env.openExternal(vscode.Uri.parse('https://github.com/mojahid2021/copilot-amplify/issues/new'));
    }),
    vscode.commands.registerCommand('copilot-amplify.omniroute.showTelemetry', () => {
      getOmnirouteLogChannel().show(true);
    })
  );
}

export function deactivate(): void {
  const channel = getOmnirouteLogChannel();
  if (channel) {
    channel.dispose();
  }
}
