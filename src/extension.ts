import * as vscode from 'vscode';
import { AuthManager } from './auth';
import { GlmAuthManager } from './glmAuth';
import { GlmChatProvider } from './glmProvider';
import { GroqAuthManager } from './groqAuth';
import { GroqChatProvider } from './groqProvider';
import { NvidiaAuthManager } from './nvidiaAuth';
import { NvidiaChatProvider } from './nvidiaProvider';
import { MiMoChatProvider } from './provider';
import { MiMoApiClient } from './api';
import { GlmApiClient } from './glmApi';
import { GroqApiClient } from './groqApi';
import { NvidiaNimApiClient } from './nvidiaApi';
import { GenericApiClient } from './baseApi';
import type { BaseAuthManager } from './baseAuth';
import { ProvidersTreeDataProvider, ProviderTreeItem } from './treeProvider';

const PROVIDER_VENDORS = {
  xiaomi: 'LuneCode.xiaomi',
  glm: 'LuneCode.glm',
  groq: 'LuneCode.groq',
  nvidia: 'LuneCode.nvidia',
} as const;

interface ProviderConfig {
  id: keyof typeof PROVIDER_VENDORS;
  displayName: string;
  vendor: string;
  authManager: BaseAuthManager;
  provider: vscode.LanguageModelChatProvider;
  testModelId: string;
  testClientFactory: (key: string) => GenericApiClient;
  manageActions: Record<string, () => Promise<void>>;
}

async function testConnection(
  authManager: BaseAuthManager,
  clientFactory: (key: string) => GenericApiClient,
  modelId: string,
  providerDisplayName: string,
): Promise<void> {
  const key = await authManager.getApiKey();
  if (!key) {
    const shouldSetKey = await vscode.window.showInformationMessage(
      `${providerDisplayName} API key is not set. Would you like to set it now?`,
      'Set API Key',
    );
    if (shouldSetKey === 'Set API Key') {
      await authManager.promptForApiKey();
    }
    return;
  }

  const client = clientFactory(key);
  try {
    await client.chat(modelId, [{ role: 'user', content: 'Ping' }], {
      maxTokens: 1,
    });
    vscode.window.showInformationMessage(`${providerDisplayName} provider test succeeded.`);
  } catch (error) {
    let message = `${providerDisplayName} test failed: ${String(error)}`;
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 401) {
      message = 'Invalid API key. Please set a new key.';
    } else if (error instanceof Error) {
      message = `${providerDisplayName} test failed: ${error.message}`;
    }
    vscode.window.showErrorMessage(message);
  }
}

function registerProviderSafely(
  context: vscode.ExtensionContext,
  providerId: string,
  displayName: string,
  provider: vscode.LanguageModelChatProvider,
): void {
  try {
    context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(providerId, provider));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error(`Failed to register ${displayName} provider (${providerId}): ${details}`);
    void vscode.window.showWarningMessage(
      `Copilot Amplify: ${displayName} is unavailable (${details}).`,
    );
  }
}

function getAuthManager(
  providerId: string,
  xiaomiAuth: AuthManager,
  glmAuth: GlmAuthManager,
  groqAuth: GroqAuthManager,
  nvidiaAuth: NvidiaAuthManager,
): BaseAuthManager | null {
  switch (providerId) {
    case 'xiaomi': return xiaomiAuth;
    case 'glm': return glmAuth;
    case 'groq': return groqAuth;
    case 'nvidia': return nvidiaAuth;
    default: return null;
  }
}

function getProviderDisplayName(providerId: string): string {
  switch (providerId) {
    case 'xiaomi': return 'Xiaomi MiMo';
    case 'glm': return 'Z.ai GLM';
    case 'groq': return 'Groq';
    case 'nvidia': return 'NVIDIA NIM';
    default: return providerId.charAt(0).toUpperCase() + providerId.slice(1);
  }
}

function getTestInfo(providerId: string): { modelId: string; clientFactory: (key: string) => GenericApiClient } {
  switch (providerId) {
    case 'xiaomi': return { modelId: 'mimo-v2-flash', clientFactory: (key) => new MiMoApiClient(key) };
    case 'glm': return { modelId: 'glm-4.7-flash', clientFactory: (key) => new GlmApiClient(key) };
    case 'groq': return { modelId: 'llama-3.3-70b-versatile', clientFactory: (key) => new GroqApiClient(key) };
    case 'nvidia': return { modelId: 'google/gemma-4-31b-it', clientFactory: (key) => new NvidiaNimApiClient(key) };
    default: return { modelId: 'mimo-v2-flash', clientFactory: (key) => new MiMoApiClient(key) };
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const xiaomiAuthManager = new AuthManager(context.secrets);
  const glmAuthManager = new GlmAuthManager(context.secrets);
  const groqAuthManager = new GroqAuthManager(context.secrets);
  const nvidiaAuthManager = new NvidiaAuthManager(context.secrets);

  // Create tree data provider
  const treeDataProvider = new ProvidersTreeDataProvider(
    xiaomiAuthManager,
    glmAuthManager,
    groqAuthManager,
    nvidiaAuthManager,
  );

  // Register tree view
  const treeView = vscode.window.createTreeView('copilot-amplify.providers', {
    treeDataProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  const providers: ProviderConfig[] = [
    {
      id: 'xiaomi',
      displayName: 'Xiaomi MiMo',
      vendor: PROVIDER_VENDORS.xiaomi,
      authManager: xiaomiAuthManager,
      provider: new MiMoChatProvider(xiaomiAuthManager),
      testModelId: 'mimo-v2-flash',
      testClientFactory: (key) => new MiMoApiClient(key),
      manageActions: {
        'Set API Key': () => xiaomiAuthManager.promptForApiKey().then(() => treeDataProvider.refresh()),
        'Clear API Key': () => xiaomiAuthManager.deleteApiKey().then(() => {
          vscode.window.showInformationMessage('Xiaomi MiMo API key cleared');
          treeDataProvider.refresh();
        }),
        'Test Connection': () => testConnection(xiaomiAuthManager, (key) => new MiMoApiClient(key), 'mimo-v2-flash', 'Xiaomi MiMo'),
      },
    },
    {
      id: 'glm',
      displayName: 'Z.ai GLM',
      vendor: PROVIDER_VENDORS.glm,
      authManager: glmAuthManager,
      provider: new GlmChatProvider(glmAuthManager),
      testModelId: 'glm-4.7-flash',
      testClientFactory: (key) => new GlmApiClient(key),
      manageActions: {
        'Set API Key': () => glmAuthManager.promptForApiKey().then(() => treeDataProvider.refresh()),
        'Clear API Key': () => glmAuthManager.deleteApiKey().then(() => {
          vscode.window.showInformationMessage('Z.ai GLM API key cleared');
          treeDataProvider.refresh();
        }),
        'Test Connection': () => testConnection(glmAuthManager, (key) => new GlmApiClient(key), 'glm-4.7-flash', 'Z.ai GLM'),
      },
    },
    {
      id: 'groq',
      displayName: 'Groq',
      vendor: PROVIDER_VENDORS.groq,
      authManager: groqAuthManager,
      provider: new GroqChatProvider(groqAuthManager),
      testModelId: 'llama-3.3-70b-versatile',
      testClientFactory: (key) => new GroqApiClient(key),
      manageActions: {
        'Set API Key': () => groqAuthManager.promptForApiKey().then(() => treeDataProvider.refresh()),
        'Clear API Key': () => groqAuthManager.deleteApiKey().then(() => {
          vscode.window.showInformationMessage('Groq API key cleared');
          treeDataProvider.refresh();
        }),
        'Test Connection': () => testConnection(groqAuthManager, (key) => new GroqApiClient(key), 'llama-3.3-70b-versatile', 'Groq'),
      },
    },
    {
      id: 'nvidia',
      displayName: 'NVIDIA NIM',
      vendor: PROVIDER_VENDORS.nvidia,
      authManager: nvidiaAuthManager,
      provider: new NvidiaChatProvider(nvidiaAuthManager),
      testModelId: 'google/gemma-4-31b-it',
      testClientFactory: (key) => new NvidiaNimApiClient(key),
      manageActions: {
        'Set API Key': () => nvidiaAuthManager.promptForApiKey().then(() => treeDataProvider.refresh()),
        'Clear API Key': () => nvidiaAuthManager.deleteApiKey().then(() => {
          vscode.window.showInformationMessage('NVIDIA NIM API key cleared');
          treeDataProvider.refresh();
        }),
        'Test Connection': () => testConnection(nvidiaAuthManager, (key) => new NvidiaNimApiClient(key), 'google/gemma-4-31b-it', 'NVIDIA NIM'),
      },
    },
  ];

  const commands: vscode.Disposable[] = [];

  // Register tree view commands
  commands.push(
    vscode.commands.registerCommand('copilot-amplify.refresh', () => {
      treeDataProvider.refresh();
    }),
  );

  commands.push(
    vscode.commands.registerCommand('copilot-amplify.setApiKey', async (item: ProviderTreeItem) => {
      if (item && item.providerId) {
        const auth = getAuthManager(item.providerId, xiaomiAuthManager, glmAuthManager, groqAuthManager, nvidiaAuthManager);
        if (auth) {
          await auth.promptForApiKey();
          treeDataProvider.refresh();
        }
      }
    }),
  );

  commands.push(
    vscode.commands.registerCommand('copilot-amplify.testConnection', async (item: ProviderTreeItem) => {
      if (item && item.providerId) {
        const auth = getAuthManager(item.providerId, xiaomiAuthManager, glmAuthManager, groqAuthManager, nvidiaAuthManager);
        if (auth) {
          const { modelId, clientFactory } = getTestInfo(item.providerId);
          const displayName = getProviderDisplayName(item.providerId);
          await testConnection(auth, clientFactory, modelId, displayName);
        }
      }
    }),
  );

  commands.push(
    vscode.commands.registerCommand('copilot-amplify.clearApiKey', async (item: ProviderTreeItem) => {
      if (item && item.providerId) {
        const auth = getAuthManager(item.providerId, xiaomiAuthManager, glmAuthManager, groqAuthManager, nvidiaAuthManager);
        if (auth) {
          await auth.deleteApiKey();
          const displayName = getProviderDisplayName(item.providerId);
          vscode.window.showInformationMessage(`${displayName} API key cleared`);
          treeDataProvider.refresh();
        }
      }
    }),
  );

  // Register all provider manage commands
  for (const config of providers) {
    registerProviderSafely(context, config.vendor, config.displayName, config.provider);

    commands.push(
      vscode.commands.registerCommand(`copilot-amplify.${config.id}.manage`, async () => {
        const choice = await vscode.window.showQuickPick(Object.keys(config.manageActions), {
          placeHolder: `Manage ${config.displayName}`,
        });
        if (choice) { await config.manageActions[choice](); }
      }),
    );
  }

  context.subscriptions.push(...commands);
}

export function deactivate(): void { }
