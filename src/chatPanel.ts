import * as vscode from 'vscode';
import type { BaseAuthManager } from './baseAuth';
import type { GenericApiClient } from './baseApi';
import { OmnirouteApiClient } from './omnirouteApi';
import { fetchOmnirouteModels, decodeOmnirouteModelId, resolveOmnirouteUpstreamModelId } from './omnirouteProvider';
import { PROVIDERS, createApiClient } from './providers';
import { SessionManager } from './sessionManager';
import { ContextManager } from './contextManager';
import { buildWebviewHtml, getNonce } from './webview/htmlBuilder';
import { WebviewToHostMessage, ChatMessage, TelemetryData, ChatAttachment } from './types/chat';
import { ChatController, ChatProviderConfig, ModelInfo } from './chatController';

export { ChatProviderConfig, ModelInfo };

export function buildProviderConfigs(authManagers: Record<string, BaseAuthManager>): ChatProviderConfig[] {
  const configs: ChatProviderConfig[] = [];
  
  for (const [id, cfg] of Object.entries(PROVIDERS)) {
    if (id === 'omniroute') continue;
    configs.push({
      id: cfg.id,
      displayName: cfg.displayName,
      authManager: authManagers[id],
      apiClientFactory: (k) => createApiClient(id, k),
      defaultModel: cfg.chatProviderOptions?.models[0]?.id || '',
      models: cfg.chatProviderOptions?.models.map((m) => ({ id: m.id, name: m.name ?? m.id })) || [],
    });
  }

  // Add omniroute explicitly with dynamic models
  configs.push({
    id: 'omniroute',
    displayName: 'Omniroute',
    authManager: authManagers['omniroute'],
    apiClientFactory: (k, sessionId) => new OmnirouteApiClient(k, { sessionId }),
    defaultModel: 'auto/best-fast',
    models: [],
    loadModels: async (apiKey) => {
      const live = await fetchOmnirouteModels(apiKey);
      return live.map((m) => ({ id: decodeOmnirouteModelId(m.id), name: m.name ?? m.id }));
    },
    resolveModelId: resolveOmnirouteUpstreamModelId,
    allowZeroConfigApiKey: true,
  });

  return configs;
}

let activePanel: ChatPanel | undefined;

export class ChatPanel {
  private contextDisposable?: vscode.Disposable;
  private controller: ChatController;

  public static createOrShow(
    extensionUri: vscode.Uri,
    configs: ChatProviderConfig[],
    sessionManager: SessionManager,
    contextManager: ContextManager,
  ): ChatPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (activePanel) {
      activePanel.panel.reveal(column);
      return activePanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'copilotAmplifyChat',
      'Copilot Amplify Chat',
      column ?? vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [extensionUri],
        retainContextWhenHidden: true,
      },
    );

    activePanel = new ChatPanel(panel, extensionUri, configs, sessionManager, contextManager);
    return activePanel;
  }

  private constructor(
    public readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly configs: ChatProviderConfig[],
    private readonly sessionManager: SessionManager,
    private readonly contextManager: ContextManager,
  ) {
    this.controller = new ChatController(panel.webview, configs, sessionManager, contextManager);

    this.panel.webview.html = buildWebviewHtml(getNonce(), false);
    this.panel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => this.controller.handleMessage(msg));

    this.contextDisposable = this.contextManager.registerListener((ctx) => {
      this.controller.notifyContextUpdate(ctx);
    });

    this.panel.onDidDispose(() => {
      this.contextDisposable?.dispose();
      activePanel = undefined;
    });

    void this.controller.refreshState();
  }

  public publicRefresh(): Promise<void> {
    return this.controller.refreshState();
  }
}

export function openChatPanel(
  context: vscode.ExtensionContext,
  configs: ChatProviderConfig[],
  sessionManager: SessionManager,
  contextManager: ContextManager,
): void {
  ChatPanel.createOrShow(context.extensionUri, configs, sessionManager, contextManager);
}
