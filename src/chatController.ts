import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { ContextManager, ActiveContextInfo } from './contextManager';
import { WebviewToHostMessage, ChatMessage, TelemetryData, ChatAttachment } from './types/chat';

export interface ModelInfo {
  id: string;
  name: string;
}

export interface ChatProviderConfig {
  id: string;
  displayName: string;
  authManager: { getApiKey(): Promise<string | undefined> };
  apiClientFactory: (apiKey: string, sessionId?: string) => any;
  defaultModel: string;
  models: ModelInfo[];
  loadModels?: (apiKey: string) => Promise<ModelInfo[]>;
  resolveModelId?: (id: string) => string;
  allowZeroConfigApiKey?: boolean;
}

export class ChatController {
  private cancellationTokenSource: vscode.CancellationTokenSource | null = null;
  private readonly webview: vscode.Webview;

  constructor(
    webview: vscode.Webview,
    private readonly configs: ChatProviderConfig[],
    private readonly sessionManager: SessionManager,
    private readonly contextManager: ContextManager,
  ) {
    this.webview = webview;
  }

  private getCurrentConfig(providerId: string): ChatProviderConfig | undefined {
    return this.configs.find((c) => c.id === providerId);
  }

  public async refreshState(): Promise<void> {
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

    await this.webview.postMessage({
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

  public notifyContextUpdate(ctx: ActiveContextInfo): void {
    void this.webview.postMessage({
      type: 'activeContextUpdate',
      fileName: ctx.fileName,
      selectionSnippet: ctx.selectionSnippet,
      hasSelection: ctx.hasSelection,
    });
  }

  public async handleMessage(msg: WebviewToHostMessage): Promise<void> {
    switch (msg.type) {
      case 'changeProvider': {
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
        this.notifyContextUpdate(ctx);
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
    if (!cfg) return;

    const storedApiKey = await cfg.authManager.getApiKey();
    const apiKey = storedApiKey || (cfg.allowZeroConfigApiKey ? 'omniroute' : undefined);
    if (!apiKey) {
      void this.webview.postMessage({
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
    void this.webview.postMessage({ type: 'streamingStart', userMessage: userMsg });

    const assistantMsgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startTime = Date.now();

    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      sender: cfg.displayName,
      timestamp: Date.now(),
      telemetry: {},
    };

    // Add assistant message immediately so that partial content is saved if interrupted
    this.sessionManager.addMessageToActiveSession(assistantMsg);

    let fullResponse = '';
    let reasoningResponse = '';

    try {
      const systemContent = parameters?.systemPrompt || session.parameters.systemPrompt || 'You are a helpful AI assistant. Keep responses concise and informative.';
      
      // Prune chat history to optimize AI context window, TTFT latency, and token consumption
      const MAX_CONTEXT_MESSAGES = 30;
      const MAX_CONTEXT_CHARS = 120000;

      const priorMessages = session.messages.filter(m => m.id !== assistantMsgId);
      let trimmedMessages = priorMessages.length > MAX_CONTEXT_MESSAGES 
        ? priorMessages.slice(-MAX_CONTEXT_MESSAGES) 
        : priorMessages;

      let totalChars = trimmedMessages.reduce((sum, m) => sum + m.content.length, 0);
      while (trimmedMessages.length > 2 && totalChars > MAX_CONTEXT_CHARS) {
        const removed = trimmedMessages.shift();
        if (removed) {
          totalChars -= removed.content.length;
        }
      }

      const openAiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: systemContent },
        ...trimmedMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];

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

            // Update in-memory message object for current stream view
            assistantMsg.content = fullResponse;
            if (reasoningResponse) {
              assistantMsg.reasoningContent = reasoningResponse;
            }

            void this.webview.postMessage({
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

      assistantMsg.telemetry = telemetry;
      // Persist session state once stream completes successfully
      this.sessionManager.updateSession(session);

      void this.webview.postMessage({
        type: 'streamingEnd',
        messageId: assistantMsgId,
        sender: cfg.displayName,
        telemetry,
      });
    } catch (err: unknown) {
      assistantMsg.content = fullResponse;
      if (reasoningResponse) {
        assistantMsg.reasoningContent = reasoningResponse;
      }
      this.sessionManager.updateSession(session);

      if (this.cancellationTokenSource?.token.isCancellationRequested) {
        void this.webview.postMessage({
          type: 'streamingEnd',
          messageId: assistantMsgId,
          sender: cfg.displayName,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      void this.webview.postMessage({ type: 'error', message });
    }
  }
}