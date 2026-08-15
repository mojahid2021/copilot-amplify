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

  for (const [id, cfg] of Object.entries(PROVIDERS)) {
    const isOmniroute = id === 'omniroute';
    const authManager = authManagers[id];

    const providerInstance = isOmniroute
      ? omnirouteChatProvider
      : createConfigurableChatProvider(id, authManager);

    if (!isOmniroute) {
      context.subscriptions.push(providerInstance);
    }

    const vendor = PROVIDER_VENDORS[id as keyof typeof PROVIDER_VENDORS];
    if (vendor) {
      registerProviderSafely(context, vendor, cfg.displayName, providerInstance);
    }
  }

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'copilot-amplify.manage';
  const initialModel = context.globalState.get<string>('activeModelId', '');
  statusBarItem.text = initialModel ? `$(sparkle) Amplify: ${initialModel}` : '$(sparkle) Copilot Amplify';
  statusBarItem.tooltip = 'Copilot Amplify: Click to manage providers & active models';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // ── Commands ───────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-amplify.manage', async () => {
      const selectedAction = await vscode.window.showQuickPick(
        [
          { label: '$(key) Set API Key', action: 'setApiKey', description: 'Configure credentials for a provider' },
          { label: '$(plug) Test Connection', action: 'test', description: 'Verify provider connection & model availability' },
          { label: '$(trash) Clear API Key', action: 'clearApiKey', description: 'Remove saved credentials' },
          { label: '$(sync) Refresh Providers & Models', action: 'refresh', description: 'Refetch live models and update state' },
          { label: '$(output) Show Telemetry Logs', action: 'telemetry', description: 'Open Omniroute response logs' },
        ],
        { placeHolder: 'Manage Copilot Amplify Providers' },
      );

      if (!selectedAction) {
        return;
      }

      if (selectedAction.action === 'refresh') {
        clearApiClientCache();
        omnirouteChatProvider.invalidateModelCache();
        treeDataProvider.refresh();
        return;
      }
      if (selectedAction.action === 'telemetry') {
        getOmnirouteLogChannel().show(true);
        return;
      }

      const providerChoices = Object.entries(PROVIDERS).map(([id, cfg]) => ({
        label: cfg.displayName,
        id,
      }));

      const selectedProvider = await vscode.window.showQuickPick(providerChoices, {
        placeHolder: `Select provider to ${selectedAction.label.toLowerCase()}`,
      });

      if (!selectedProvider) {
        return;
      }

      const id = selectedProvider.id;
      const auth = getAuthManager(id, authManagers);
      if (!auth) {
        return;
      }

      if (selectedAction.action === 'setApiKey') {
        await auth.promptForApiKey();
        clearApiClientCache();
        if (id === 'omniroute') {
          omnirouteChatProvider.invalidateModelCache();
        }
        treeDataProvider.refresh();
      } else if (selectedAction.action === 'test') {
        const { modelId, clientFactory } = getTestInfo(id);
        await testConnection(auth, clientFactory, modelId, displayName(id));
      } else if (selectedAction.action === 'clearApiKey') {
        await auth.deleteApiKey();
        clearApiClientCache();
        if (id === 'omniroute') {
          omnirouteChatProvider.invalidateModelCache();
        }
        treeDataProvider.refresh();
        vscode.window.showInformationMessage(`${displayName(id)} API key cleared`);
      }
    }),

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
        statusBarItem.text = `$(sparkle) Amplify: ${item.modelId}`;
        vscode.window.showInformationMessage(`Selected model ${item.modelId}`);
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
