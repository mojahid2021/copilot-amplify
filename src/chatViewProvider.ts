import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { ContextManager } from './contextManager';
import { ChatProviderConfig } from './chatPanel';
import { buildWebviewHtml } from './webview/htmlBuilder';
import { WebviewToHostMessage, ChatMessage, TelemetryData, ChatAttachment } from './types/chat';

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'copilot-amplify.chatView';
  private view?: vscode.WebviewView;
  private cancellationTokenSource: vscode.CancellationTokenSource | null = null;
  private contextDisposable?: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly configs: ChatProviderConfig[],
    private readonly sessionManager: SessionManager,
    private readonly contextManager: ContextManager,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = buildWebviewHtml(getNonce(), true);

    webviewView.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => this.onMessage(msg));

    this.contextDisposable = this.contextManager.registerListener((ctx) => {
      void webviewView.webview.postMessage({
        type: 'activeContextUpdate',
        fileName: ctx.fileName,
        selectionSnippet: ctx.selectionSnippet,
        hasSelection: ctx.hasSelection,
      });
    });

    webviewView.onDidDispose(() => {
      this.contextDisposable?.dispose();
    });

    void this.refreshState();
  }

  private getCurrentConfig(providerId: string): ChatProviderConfig | undefined {
    return this.configs.find((c) => c.id === providerId);
  }

  private async refreshState(): Promise<void> {
    if (!this.view) return;

    const session = this.sessionManager.getActiveSession();
    const cfg = this.getCurrentConfig(session.providerId);
    if (!cfg) return;

    const storedApiKey = await cfg.authManager.getApiKey();
    const effectiveApiKey = storedApiKey || (cfg.allowZeroConfigApiKey ? 'omniroute' : undefined);
    const hasKey = cfg.allowZeroConfigApiKey || Boolean(storedApiKey);

    let models = cfg.models;
    if (cfg.loadModels && effectiveApiKey) {
      try {
        models = await cfg.loadModels(effectiveApiKey);
        if (models.length > 0 && !models.some((m) => m.id === session.modelId)) {
          session.modelId = cfg.defaultModel && models.some((m) => m.id === cfg.defaultModel)
            ? cfg.defaultModel
            : models[0].id;
          this.sessionManager.updateSession(session);
        }
      } catch (err) {
        console.warn(`[${cfg.displayName}] live model load failed:`, err);
      }
    }

    const activeCtx = this.contextManager.getActiveContext();

    await this.view.webview.postMessage({
      type: 'state',
      providerId: cfg.id,
      models,
      defaultModelId: session.modelId || cfg.defaultModel,
      apiKeyConfigured: hasKey,
      displayName: cfg.displayName,
      currentSession: session,
      sessionsList: this.sessionManager.getSessionsList(),
      activeContext: {
        fileName: activeCtx.fileName,
        selectionSnippet: activeCtx.selectionSnippet,
        hasSelection: activeCtx.hasSelection,
      },
    });
  }

  private async onMessage(msg: WebviewToHostMessage): Promise<void> {
    switch (msg.type) {
      case 'changeProvider': {
        const session = this.sessionManager.getActiveSession();
        const cfg = this.getCurrentConfig(msg.providerId);
        if (cfg) {
          this.sessionManager.updateActiveSessionProviderAndModel(cfg.id, cfg.defaultModel);
        }
        await this.refreshState();
        break;
      }

      case 'changeModel': {
        const session = this.sessionManager.getActiveSession();
        session.modelId = msg.modelId;
        this.sessionManager.updateSession(session);
        break;
      }

      case 'sendMessage':
        await this.sendMessage(msg.text, msg.modelId, msg.attachments, msg.parameters);
        break;

      case 'cancelStream':
        this.cancellationTokenSource?.cancel();
        break;

      case 'newSession': {
        const session = this.sessionManager.getActiveSession();
        this.sessionManager.createSession(session.providerId, session.modelId);
        await this.refreshState();
        break;
      }

      case 'loadSession':
        this.sessionManager.setActiveSession(msg.sessionId);
        await this.refreshState();
        break;

      case 'deleteSession':
        this.sessionManager.deleteSession(msg.sessionId);
        await this.refreshState();
        break;

      case 'renameSession':
        this.sessionManager.renameSession(msg.sessionId, msg.title);
        await this.refreshState();
        break;

      case 'updateParameters':
        this.sessionManager.updateActiveSessionParameters(msg.parameters);
        break;

      case 'copyToClipboard':
        await vscode.env.clipboard.writeText(msg.text);
        break;

      case 'insertAtCursor':
        await this.contextManager.insertAtCursor(msg.text);
        break;

      case 'applyToActiveFile':
        await this.contextManager.applyToActiveFile(msg.text);
        break;

      case 'openKeyInput':
        await vscode.commands.executeCommand('copilot-amplify.setApiKey', msg.providerId);
        await this.refreshState();
        break;

      case 'popOutPanel':
        await vscode.commands.executeCommand('copilot-amplify.openChat');
        break;

      case 'requestActiveContext': {
        const ctx = this.contextManager.getActiveContext();
        void this.view?.webview.postMessage({
          type: 'activeContextUpdate',
          fileName: ctx.fileName,
          selectionSnippet: ctx.selectionSnippet,
          hasSelection: ctx.hasSelection,
        });
        break;
      }

      case 'exportChat': {
        const session = this.sessionManager.getActiveSession();
        let content = '';
        if (msg.format === 'json') {
          content = JSON.stringify(session, null, 2);
        } else {
          content = `# ${session.title}\n\n`;
          for (const m of session.messages) {
            content += `### ${m.sender} (${new Date(m.timestamp).toLocaleTimeString()})\n\n${m.content}\n\n---\n\n`;
          }
        }
        const doc = await vscode.workspace.openTextDocument({ content, language: msg.format === 'json' ? 'json' : 'markdown' });
        await vscode.window.showTextDocument(doc);
        break;
      }
    }
  }

  private async sendMessage(
    text: string,
    modelId: string,
    attachments?: ChatAttachment[],
    parameters?: any,
  ): Promise<void> {
    const session = this.sessionManager.getActiveSession();
    const cfg = this.getCurrentConfig(session.providerId);
    if (!cfg || !this.view) return;

    const storedApiKey = await cfg.authManager.getApiKey();
    const apiKey = storedApiKey || (cfg.allowZeroConfigApiKey ? 'omniroute' : undefined);
    if (!apiKey) {
      void this.view.webview.postMessage({
        type: 'error',
        message: `${cfg.displayName} API key is not configured. Click the dot status icon to set it.`,
      });
      return;
    }

    const rawModel = modelId || session.modelId || cfg.defaultModel;
    const actualModel = cfg.resolveModelId ? cfg.resolveModelId(rawModel) : rawModel;
    this.cancellationTokenSource = new vscode.CancellationTokenSource();
    const client = cfg.apiClientFactory(apiKey, session.id);

    let fullPromptContent = text;
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (att.type === 'code_selection') {
          fullPromptContent += `\n\n[Attached Selection: ${att.name}]\n\`\`\`\n${att.content}\n\`\`\``;
        }
      }
    }

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: fullPromptContent,
      sender: 'You',
      timestamp: Date.now(),
      attachments,
    };

    this.sessionManager.addMessageToActiveSession(userMsg);
    void this.view.webview.postMessage({ type: 'streamingStart', userMessage: userMsg });

    const assistantMsgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startTime = Date.now();

    try {
      const systemContent = parameters?.systemPrompt || session.parameters.systemPrompt || 'You are a helpful AI assistant. Keep responses concise and informative.';
      const openAiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemContent },
        ...session.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];

      let fullResponse = '';
      let reasoningResponse = '';
      const stream = client.streamChat(
        actualModel,
        openAiMessages,
        {
          maxTokens: parameters?.maxTokens || 8192,
          temperature: parameters?.temperature ?? session.parameters.temperature ?? 0.7,
        },
        this.cancellationTokenSource.token,
      );

      for await (const chunk of stream) {
        for (const choice of chunk.choices) {
          const deltaContent = choice.delta?.content || '';
          const deltaReasoning = (choice.delta as any)?.reasoning_content || '';
          if (deltaContent || deltaReasoning) {
            fullResponse += deltaContent;
            reasoningResponse += deltaReasoning;
            void this.view.webview.postMessage({
              type: 'chunk',
              messageId: assistantMsgId,
              text: deltaContent,
              reasoningText: deltaReasoning,
            });
          }
        }
      }

      const latencyMs = Date.now() - startTime;
      const telemetry: TelemetryData = { latencyMs };

      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: fullResponse,
        sender: cfg.displayName,
        timestamp: Date.now(),
        reasoningContent: reasoningResponse || undefined,
        telemetry,
      };

      this.sessionManager.addMessageToActiveSession(assistantMsg);

      void this.view.webview.postMessage({
        type: 'streamingEnd',
        messageId: assistantMsgId,
        sender: cfg.displayName,
        telemetry,
      });
    } catch (err: unknown) {
      if (this.cancellationTokenSource?.token.isCancellationRequested) {
        void this.view.webview.postMessage({
          type: 'streamingEnd',
          messageId: assistantMsgId,
          sender: cfg.displayName,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      void this.view.webview.postMessage({ type: 'error', message });
    }
  }

  public publicRefresh(): Promise<void> {
    return this.refreshState();
  }
}
