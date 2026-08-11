import * as vscode from 'vscode';
import { SessionManager } from './sessionManager';
import { ContextManager } from './contextManager';
import { buildWebviewHtml, getNonce } from './webview/htmlBuilder';
import { WebviewToHostMessage } from './types/chat';
import { ChatController, ChatProviderConfig } from './chatController';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'copilot-amplify.chatView';
  private view?: vscode.WebviewView;
  private contextDisposable?: vscode.Disposable;
  private controller?: ChatController;

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
    this.controller = new ChatController(webviewView.webview, this.configs, this.sessionManager, this.contextManager);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = buildWebviewHtml(getNonce(), true);

    webviewView.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => {
      this.controller?.handleMessage(msg);
    });

    if (this.contextDisposable) {
      this.contextDisposable.dispose();
    }
    this.contextDisposable = this.contextManager.registerListener((ctx) => {
      this.controller?.notifyContextUpdate(ctx);
    });

    webviewView.onDidDispose(() => {
      this.contextDisposable?.dispose();
    });

    void this.controller.refreshState();
  }

  public publicRefresh(): Promise<void> {
    return this.controller ? this.controller.refreshState() : Promise.resolve();
  }
}
