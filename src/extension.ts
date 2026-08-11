import * as vscode from 'vscode';
import { fetchOmnirouteModels, OmnirouteChatProvider, resolveOmnirouteUpstreamModelId } from './omnirouteProvider';
import { getOmnirouteLogChannel, OmnirouteApiClient } from './omnirouteApi';
import { GenericApiClient } from './baseApi';
import type { BaseAuthManager } from './baseAuth';
import { ProvidersTreeDataProvider, ProviderTreeItem } from './treeProvider';
import { openChatPanel, buildProviderConfigs } from './chatPanel';
import { SessionManager } from './sessionManager';
import { ContextManager } from './contextManager';
import { ChatViewProvider } from './chatViewProvider';
import { PROVIDERS, createAuthManager, createApiClient, createConfigurableChatProvider } from './providers';

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
    console.warn(`Could not register provider for ${dName}. It may already be registered.`);
  }
}

async function getLatestOmnirouteChatModel(key: string): Promise<string> {
  const models = await fetchOmnirouteModels(key);
  const best = models.find((m) => m.id.includes('best-coding'));
  if (best) return resolveOmnirouteUpstreamModelId(best.id);
  if (models.length > 0) return resolveOmnirouteUpstreamModelId(models[0].id);
  throw new Error('No models found for test connection.');
}

async function getLatestXiaomiChatModel(key: string): Promise<string> {
  return 'mimo-v2.5-pro';
}

export function activate(context: vscode.ExtensionContext): void {
  const authManagers: Record<string, BaseAuthManager> = {};
  for (const id of Object.keys(PROVIDERS)) {
    authManagers[id] = createAuthManager(id, context.secrets);
  }

  const omnirouteChatProvider = new OmnirouteChatProvider(authManagers['omniroute']);
  const contextManager = new ContextManager();
  const sessionManager = new SessionManager(context);
  
  context.subscriptions.push(
    omnirouteChatProvider,
    contextManager,
  );

  const treeDataProvider = new ProvidersTreeDataProvider(authManagers);

  context.subscriptions.push(
    vscode.window.createTreeView('copilot-amplify.providers', { treeDataProvider }),
  );

  const chatProviderConfigs = buildProviderConfigs(authManagers);
  const chatViewProvider = new ChatViewProvider(
    context.extensionUri,
    chatProviderConfigs,
    sessionManager,
    contextManager,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
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
            if (isOmniroute) omnirouteChatProvider.invalidateModelCache();
            treeDataProvider.refresh();
          } catch (err) { }
        },
        'Clear API Key':  async () => {
          try {
            await authManager.deleteApiKey();
            if (isOmniroute) omnirouteChatProvider.invalidateModelCache();
            treeDataProvider.refresh();
          } catch (err) { }
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
      omnirouteChatProvider.invalidateModelCache();
      treeDataProvider.refresh();
      void chatViewProvider.publicRefresh();
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

    vscode.commands.registerCommand('copilot-amplify.documentation', () => {
      void vscode.env.openExternal(vscode.Uri.parse('https://github.com/mojahid2021/copilot-amplify#readme'));
    }),
    vscode.commands.registerCommand('copilot-amplify.report', () => {
      void vscode.env.openExternal(vscode.Uri.parse('https://github.com/mojahid2021/copilot-amplify/issues/new'));
    }),
    vscode.commands.registerCommand('copilot-amplify.omniroute.showTelemetry', () => {
      getOmnirouteLogChannel().show(true);
    }),

    vscode.commands.registerCommand('copilot-amplify.openChat', () => {
      openChatPanel(context, chatProviderConfigs, sessionManager, contextManager);
    })
  );

  if (vscode.window.registerWebviewPanelSerializer) {
    vscode.window.registerWebviewPanelSerializer('copilotAmplifyChat', {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, _state: any) {
        // ChatPanel handles its own state restoration via SessionManager.
        openChatPanel(context, chatProviderConfigs, sessionManager, contextManager);
      }
    });
  }
}

export function deactivate(): void {
  const channel = getOmnirouteLogChannel();
  if (channel) {
    channel.dispose();
  }
}
