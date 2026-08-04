import * as vscode from 'vscode';
import { AuthManager } from './auth';
import { GlmAuthManager } from './glmAuth';
import { GlmChatProvider } from './glmProvider';
import { GroqAuthManager } from './groqAuth';
import { GroqChatProvider } from './groqProvider';
import { NvidiaAuthManager } from './nvidiaAuth';
import { NvidiaChatProvider } from './nvidiaProvider';
import { OmnirouteAuthManager } from './omnirouteAuth';
import { fetchOmnirouteModels, OmnirouteChatProvider, resolveOmnirouteUpstreamModelId } from './omnirouteProvider';
import { getOmnirouteLogChannel } from './omnirouteApi';
import { fetchXiaomiChatModels, MiMoChatProvider } from './provider';
import { MiMoApiClient } from './api';
import { GlmApiClient } from './glmApi';
import { GroqApiClient } from './groqApi';
import { NvidiaNimApiClient } from './nvidiaApi';
import { OmnirouteApiClient } from './omnirouteApi';
import { GenericApiClient } from './baseApi';
import type { BaseAuthManager } from './baseAuth';
import { ProvidersTreeDataProvider, ProviderTreeItem } from './treeProvider';
import { openChatPanel, buildProviderConfigs } from './chatPanel';

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
  displayName: string,
  provider: vscode.LanguageModelChatProvider,
): void {
  try {
    context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(vendorId, provider));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`Failed to register ${displayName} provider (${vendorId}): ${detail}`);
    void vscode.window.showWarningMessage(`Copilot Amplify: ${displayName} is unavailable (${detail}).`);
  }
}

function getAuthManager(
  id: string,
  xiaomi: AuthManager,
  glm: GlmAuthManager,
  groq: GroqAuthManager,
  nvidia: NvidiaAuthManager,
  omniroute: OmnirouteAuthManager,
): BaseAuthManager | null {
  switch (id) {
    case 'xiaomi':    return xiaomi;
    case 'glm':       return glm;
    case 'groq':      return groq;
    case 'nvidia':    return nvidia;
    case 'omniroute': return omniroute;
    default:          return null;
  }
}

async function getLatestXiaomiChatModel(apiKey: string): Promise<string> {
  const [model] = await fetchXiaomiChatModels(apiKey);
  if (!model) { throw new Error('Xiaomi returned no chat-capable MiMo models'); }
  return model.id;
}

async function getLatestOmnirouteChatModel(apiKey: string): Promise<string> {
  const models = await fetchOmnirouteModels(apiKey);
  // Prefer a regular chat model over a no-thinking variant for the ping.
  const preferred = models.find((m) => !m.id.includes('no-thinking')) ?? models[0];
  if (!preferred) { throw new Error('Omniroute returned no chat-capable models'); }
  // VS Code strips slashes from model IDs in the picker, so the provider encodes
  // `/` -> `__` before exposing the model. Resolve it back here so the test
  // request uses the real upstream id (e.g. `auto/best-coding`).
  return resolveOmnirouteUpstreamModelId(preferred.id);
}

function getTestInfo(id: string): { modelId: TestModelResolver; clientFactory: (key: string) => GenericApiClient } {
  switch (id) {
    case 'xiaomi':    return { modelId: getLatestXiaomiChatModel,  clientFactory: (k) => new MiMoApiClient(k)     };
    case 'glm':       return { modelId: 'glm-4.7-flash',           clientFactory: (k) => new GlmApiClient(k)      };
    case 'groq':      return { modelId: 'llama-3.3-70b-versatile', clientFactory: (k) => new GroqApiClient(k)     };
    case 'nvidia':    return { modelId: 'google/gemma-4-31b-it',   clientFactory: (k) => new NvidiaNimApiClient(k) };
    case 'omniroute': return { modelId: getLatestOmnirouteChatModel, clientFactory: (k) => new OmnirouteApiClient(k) };
    default:          return { modelId: 'mimo-v2.5-pro',           clientFactory: (k) => new MiMoApiClient(k)     };
  }
}

function displayName(id: string): string {
  switch (id) {
    case 'xiaomi':    return 'Xiaomi MiMo';
    case 'glm':       return 'Z.ai GLM';
    case 'groq':      return 'Groq';
    case 'nvidia':    return 'NVIDIA NIM';
    case 'omniroute': return 'Omniroute';
    default:          return id.charAt(0).toUpperCase() + id.slice(1);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const xiaomiAuth    = new AuthManager(context.secrets);
  const glmAuth       = new GlmAuthManager(context.secrets);
  const groqAuth      = new GroqAuthManager(context.secrets);
  const nvidiaAuth    = new NvidiaAuthManager(context.secrets);
  const omnirouteAuth = new OmnirouteAuthManager(context.secrets);

  const omnirouteChatProvider = new OmnirouteChatProvider(omnirouteAuth);

  const treeDataProvider = new ProvidersTreeDataProvider(
    xiaomiAuth,
    glmAuth,
    groqAuth,
    nvidiaAuth,
    omnirouteAuth,
  );

  context.subscriptions.push(
    vscode.window.createTreeView('copilot-amplify.providers', { treeDataProvider }),
  );

  const providers: ProviderConfig[] = [
    {
      id: 'xiaomi',
      displayName: 'Xiaomi MiMo',
      vendor: PROVIDER_VENDORS.xiaomi,
      authManager: xiaomiAuth,
      provider: new MiMoChatProvider(xiaomiAuth),
      manageActions: {
        'Set API Key':    () => xiaomiAuth.promptForApiKey().then(() => treeDataProvider.refresh()),
        'Clear API Key':  () => xiaomiAuth.deleteApiKey().then(() => { vscode.window.showInformationMessage('Xiaomi MiMo API key cleared'); treeDataProvider.refresh(); }),
        'Test Connection': () => testConnection(xiaomiAuth, (k) => new MiMoApiClient(k), getLatestXiaomiChatModel, 'Xiaomi MiMo'),
      },
    },
    {
      id: 'glm',
      displayName: 'Z.ai GLM',
      vendor: PROVIDER_VENDORS.glm,
      authManager: glmAuth,
      provider: new GlmChatProvider(glmAuth),
      manageActions: {
        'Set API Key':    () => glmAuth.promptForApiKey().then(() => treeDataProvider.refresh()),
        'Clear API Key':  () => glmAuth.deleteApiKey().then(() => { vscode.window.showInformationMessage('Z.ai GLM API key cleared'); treeDataProvider.refresh(); }),
        'Test Connection': () => testConnection(glmAuth, (k) => new GlmApiClient(k), 'glm-4.7-flash', 'Z.ai GLM'),
      },
    },
    {
      id: 'groq',
      displayName: 'Groq',
      vendor: PROVIDER_VENDORS.groq,
      authManager: groqAuth,
      provider: new GroqChatProvider(groqAuth),
      manageActions: {
        'Set API Key':    () => groqAuth.promptForApiKey().then(() => treeDataProvider.refresh()),
        'Clear API Key':  () => groqAuth.deleteApiKey().then(() => { vscode.window.showInformationMessage('Groq API key cleared'); treeDataProvider.refresh(); }),
        'Test Connection': () => testConnection(groqAuth, (k) => new GroqApiClient(k), 'llama-3.3-70b-versatile', 'Groq'),
      },
    },
    {
      id: 'nvidia',
      displayName: 'NVIDIA NIM',
      vendor: PROVIDER_VENDORS.nvidia,
      authManager: nvidiaAuth,
      provider: new NvidiaChatProvider(nvidiaAuth),
      manageActions: {
        'Set API Key':    () => nvidiaAuth.promptForApiKey().then(() => treeDataProvider.refresh()),
        'Clear API Key':  () => nvidiaAuth.deleteApiKey().then(() => { vscode.window.showInformationMessage('NVIDIA NIM API key cleared'); treeDataProvider.refresh(); }),
        'Test Connection': () => testConnection(nvidiaAuth, (k) => new NvidiaNimApiClient(k), 'google/gemma-4-31b-it', 'NVIDIA NIM'),
      },
    },
    {
      id: 'omniroute',
      displayName: 'Omniroute',
      vendor: PROVIDER_VENDORS.omniroute,
      authManager: omnirouteAuth,
      provider: omnirouteChatProvider,
      manageActions: {
        'Set API Key':    () => omnirouteAuth.promptForApiKey().then(() => { omnirouteChatProvider.invalidateModelCache(); treeDataProvider.refresh(); }),
        'Clear API Key':  () => omnirouteAuth.deleteApiKey().then(() => { vscode.window.showInformationMessage('Omniroute API key cleared'); omnirouteChatProvider.invalidateModelCache(); treeDataProvider.refresh(); }),
        'Test Connection': () => testConnection(omnirouteAuth, (k) => new OmnirouteApiClient(k), getLatestOmnirouteChatModel, 'Omniroute'),
      },
    },
  ];

  // Register all 5 language model providers
  for (const cfg of providers) {
    registerProviderSafely(context, cfg.vendor, cfg.displayName, cfg.provider);
  }

  // ── Commands ───────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-amplify.refresh', () => {
      omnirouteChatProvider.invalidateModelCache();
      treeDataProvider.refresh();
      vscode.window.showInformationMessage('Refreshed providers and model lists.');
    }),

    // Central manage dialog — shown as Quick Pick when "Manage Providers..." is clicked
    vscode.commands.registerCommand('copilot-amplify.manage', async () => {
      const choices = providers.map((p) => p.displayName);
      const picked = await vscode.window.showQuickPick(choices, { placeHolder: 'Select a provider to manage' });
      if (!picked) { return; }
      const cfg = providers.find((p) => p.displayName === picked);
      if (!cfg) { return; }
      const action = await vscode.window.showQuickPick(Object.keys(cfg.manageActions), {
        placeHolder: `Manage ${cfg.displayName}`,
      });
      if (action) { await cfg.manageActions[action](); }
    }),

    // Provider row: click → test connection (or prompt for key)
    vscode.commands.registerCommand('copilot-amplify.provider.click', async (item: ProviderTreeItem) => {
      const id = item?.providerId;
      if (!id) { return; }
      const auth = getAuthManager(id, xiaomiAuth, glmAuth, groqAuth, nvidiaAuth, omnirouteAuth);
      if (!auth) { return; }
      if (id === 'omniroute' || (await auth.getApiKey())) {
        const { modelId, clientFactory } = getTestInfo(id);
        await testConnection(auth, clientFactory, modelId, displayName(id));
      } else {
        await auth.promptForApiKey();
        treeDataProvider.refresh();
      }
    }),

    // Right-click: Set API Key
    vscode.commands.registerCommand('copilot-amplify.setApiKey', async (item: ProviderTreeItem) => {
      const id = item?.providerId;
      if (!id) { return; }
      const auth = getAuthManager(id, xiaomiAuth, glmAuth, groqAuth, nvidiaAuth, omnirouteAuth);
      if (auth) { await auth.promptForApiKey(); treeDataProvider.refresh(); }
    }),

    // Right-click: Test Connection
    vscode.commands.registerCommand('copilot-amplify.testConnection', async (item: ProviderTreeItem) => {
      const id = item?.providerId;
      if (!id) { return; }
      const auth = getAuthManager(id, xiaomiAuth, glmAuth, groqAuth, nvidiaAuth, omnirouteAuth);
      if (auth) { const { modelId, clientFactory } = getTestInfo(id); await testConnection(auth, clientFactory, modelId, displayName(id)); }
    }),

    // Right-click: Clear API Key
    vscode.commands.registerCommand('copilot-amplify.clearApiKey', async (item: ProviderTreeItem) => {
      const id = item?.providerId;
      if (!id) { return; }
      const auth = getAuthManager(id, xiaomiAuth, glmAuth, groqAuth, nvidiaAuth, omnirouteAuth);
      if (auth) { await auth.deleteApiKey(); vscode.window.showInformationMessage(`${displayName(id)} API key cleared`); treeDataProvider.refresh(); }
    }),

    // Per-provider manage commands (kept for toolbar buttons if desired)
    vscode.commands.registerCommand('copilot-amplify.xiaomi.manage', async () => {
      const action = await vscode.window.showQuickPick(Object.keys(providers[0].manageActions), { placeHolder: 'Manage Xiaomi MiMo' });
      if (action) { await providers[0].manageActions[action](); }
    }),
    vscode.commands.registerCommand('copilot-amplify.glm.manage', async () => {
      const action = await vscode.window.showQuickPick(Object.keys(providers[1].manageActions), { placeHolder: 'Manage Z.ai GLM' });
      if (action) { await providers[1].manageActions[action](); }
    }),
    vscode.commands.registerCommand('copilot-amplify.groq.manage', async () => {
      const action = await vscode.window.showQuickPick(Object.keys(providers[2].manageActions), { placeHolder: 'Manage Groq' });
      if (action) { await providers[2].manageActions[action](); }
    }),
    vscode.commands.registerCommand('copilot-amplify.nvidia.manage', async () => {
      const action = await vscode.window.showQuickPick(Object.keys(providers[3].manageActions), { placeHolder: 'Manage NVIDIA NIM' });
      if (action) { await providers[3].manageActions[action](); }
    }),
    vscode.commands.registerCommand('copilot-amplify.omniroute.manage', async () => {
      const action = await vscode.window.showQuickPick(Object.keys(providers[4].manageActions), { placeHolder: 'Manage Omniroute' });
      if (action) { await providers[4].manageActions[action](); }
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

    // Right panel: open chat panel
    vscode.commands.registerCommand('copilot-amplify.openChat', () => {
      const configs = buildProviderConfigs(xiaomiAuth, glmAuth, groqAuth, nvidiaAuth, omnirouteAuth);
      openChatPanel(context, configs);
    }),
  );
}

export function deactivate(): void {}
