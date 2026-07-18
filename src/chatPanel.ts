import * as vscode from 'vscode';
import type { BaseAuthManager } from './baseAuth';
import type { GenericApiClient } from './baseApi';
import { MiMoApiClient } from './api';
import { GlmApiClient } from './glmApi';
import { GroqApiClient } from './groqApi';
import { NvidiaNimApiClient } from './nvidiaApi';
import {
  MIMO_MODELS,
  GLM_MODELS,
  GROQ_MODELS,
  NIM_MODELS,
} from './models';

export interface ModelInfo {
  id: string;
  name: string;
}

export interface ChatProviderConfig {
  id: string;
  displayName: string;
  authManager: BaseAuthManager;
  apiClientFactory: (apiKey: string) => GenericApiClient;
  defaultModel: string;
  models: ModelInfo[];
}

export function buildProviderConfigs(
  xiaomiAuth: BaseAuthManager,
  glmAuth:    BaseAuthManager,
  groqAuth:   BaseAuthManager,
  nvidiaAuth: BaseAuthManager,
): ChatProviderConfig[] {
  return [
    {
      id: 'xiaomi', displayName: 'Xiaomi MiMo',
      authManager: xiaomiAuth,
      apiClientFactory: (k) => new MiMoApiClient(k),
      defaultModel: 'mimo-v2.5-pro',
      models: MIMO_MODELS.map((m) => ({ id: m.id, name: m.name ?? m.id })),
    },
    {
      id: 'glm', displayName: 'Z.ai GLM',
      authManager: glmAuth,
      apiClientFactory: (k) => new GlmApiClient(k),
      defaultModel: 'glm-5',
      models: GLM_MODELS.map((m) => ({ id: m.id, name: m.name ?? m.id })),
    },
    {
      id: 'groq', displayName: 'Groq',
      authManager: groqAuth,
      apiClientFactory: (k) => new GroqApiClient(k),
      defaultModel: 'llama-3.3-70b-versatile',
      models: GROQ_MODELS.map((m) => ({ id: m.id, name: m.name ?? m.id })),
    },
    {
      id: 'nvidia', displayName: 'NVIDIA NIM',
      authManager: nvidiaAuth,
      apiClientFactory: (k) => new NvidiaNimApiClient(k),
      defaultModel: 'google/gemma-4-31b-it',
      models: NIM_MODELS.map((m) => ({ id: m.id, name: m.name ?? m.id })),
    },
  ];
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  sender: string;
  isAssistantStreaming?: boolean;
  isError?: boolean;
  timestamp: number;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CSS = `
:root {
  --bg: #1e1e1e; --surface: #252526; --border: #3c3c3c;
  --text: #cccccc; --text-muted: #858585;
  --accent: #0078d4; --accent-hover: #1a8cde;
  --danger: #f14c4c; --success: #4ec9b0;
  --user-bg: #094771; --user-text: #ffffff;
  --assistant-bg: #2d2d2d; --radius: 6px;
  --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

.header {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; background: var(--surface);
  border-bottom: 1px solid var(--border); flex-shrink: 0;
  flex-wrap: wrap;
}
.provider-select, .model-select {
  background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 5px 8px; font-size: 12px; outline: none; cursor: pointer;
}
.provider-select:focus, .model-select:focus { border-color: var(--accent); }
.provider-select { min-width: 130px; }
.model-select { min-width: 200px; flex: 1; max-width: 340px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.status-dot.connected { background: var(--success); }
.status-dot.disconnected { background: var(--danger); }
.header-right { display: flex; align-items: center; gap: 8px; margin-left: auto; }

.error-banner { background: #f3e2a2; color: #1a1a1a; font-size: 12px; padding: 6px 12px; border-bottom: 1px solid #d4a917; flex-shrink: 0; display: none; }

.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }

.empty-state {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; color: var(--text-muted); font-size: 13px; text-align: center; padding: 32px;
}
.empty-state .icon { font-size: 40px; opacity: 0.4; }

.message { max-width: 82%; padding: 10px 14px; border-radius: var(--radius); font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.message.user { align-self: flex-end; background: var(--user-bg); color: var(--user-text); border-bottom-right-radius: 2px; }
.message.assistant { align-self: flex-start; background: var(--assistant-bg); border-bottom-left-radius: 2px; }
.message.error { align-self: flex-start; background: #3d1f1f; color: var(--danger); }
.message .sender { font-size: 11px; opacity: 0.55; margin-bottom: 4px; font-weight: 600; }
.message.assistant .content { color: #d4d4d4; }

.input-area {
  display: flex; gap: 8px; padding: 12px 16px;
  background: var(--surface); border-top: 1px solid var(--border); flex-shrink: 0;
}
.input-area textarea {
  flex: 1; background: var(--bg); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 8px 12px; font-size: 13px; resize: none; min-height: 38px;
  max-height: 120px; font-family: var(--font); outline: none; field-sizing: content;
}
.input-area textarea:focus { border-color: var(--accent); }
.input-area textarea::placeholder { color: var(--text-muted); }
.send-btn {
  background: var(--accent); color: white; border: none; border-radius: var(--radius);
  padding: 0 16px; font-size: 13px; cursor: pointer; white-space: nowrap;
  transition: background 0.15s; font-weight: 600;
}
.send-btn:hover:not(:disabled) { background: var(--accent-hover); }
.send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.send-btn.streaming { background: var(--danger); }
`;

// ─── Webview Script ───────────────────────────────────────────────────────────

const SCRIPT = `<script>
const vscode = acquireVsCodeApi();
let messages = [];
let streaming = false;
let cfg = null;

const messagesEl   = document.getElementById('messages');
const emptyEl       = document.getElementById('empty-state');
const inputEl       = document.getElementById('chat-input');
const sendBtn       = document.getElementById('send-btn');
const providerEl    = document.getElementById('provider-select');
const modelEl       = document.getElementById('model-select');
const statusDotEl   = document.getElementById('status-dot');
const errorBannerEl = document.getElementById('error-banner');

function escapeHtml(s) { return String(s).replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>'); }

function setState(data) {
  cfg = data;
  messages = [];
  renderMessages();
  syncUI(data.providerId, data.models, data.defaultModelId, data.apiKeyConfigured);
}

function syncUI(providerId, models, defaultModelId, hasKey) {
  // Update provider dropdown
  providerEl.value = providerId;

  // Update model dropdown
  modelEl.innerHTML = '';
  (models || []).forEach(function(m) {
    var opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    if (m.id === defaultModelId) opt.selected = true;
    modelEl.appendChild(opt);
  });

  // Status dot
  statusDotEl.className = 'status-dot ' + (hasKey ? 'connected' : 'disconnected');

  // Input state
  const canSend = hasKey && !streaming;
  inputEl.disabled = !hasKey;
  sendBtn.disabled = !canSend;
  inputEl.placeholder = hasKey ? 'Ask anything... (Enter to send, Shift+Enter for newline)' : 'Set API key first via the Providers panel';
}

function renderMessages() {
  if (!messagesEl) return;
  if (messages.length === 0) {
    emptyEl.style.display = ''; messagesEl.innerHTML = '';
  } else {
    emptyEl.style.display = 'none';
    messagesEl.innerHTML = messages.map(function(m) {
      if (m.isError) {
        return '<div class="message error"><div class="sender">Error</div><div class="content">' + escapeHtml(m.content) + '</div></div>';
      }
      return '<div class="message ' + m.role + '"><div class="sender">' + escapeHtml(m.sender) + '</div><div class="content">' + escapeHtml(m.content) + '</div></div>';
    }).join('');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

providerEl.addEventListener('change', function() {
  messages = [];
  renderMessages();
  vscode.postMessage({ type: 'changeProvider', providerId: providerEl.value });
});

modelEl.addEventListener('change', function() {
  vscode.postMessage({ type: 'changeModel', modelId: modelEl.value });
});

sendBtn.addEventListener('click', function() {
  if (streaming) { vscode.postMessage({ type: 'cancelStream' }); return; }
  var text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  vscode.postMessage({ type: 'sendMessage', text, modelId: modelEl.value });
});

inputEl.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
});

window.addEventListener('message', function(e) {
  var msg = e.data;
  switch (msg.type) {
    case 'state': setState(msg); break;
    case 'streamingStart':
      streaming = true;
      sendBtn.textContent = 'Stop'; sendBtn.className = 'send-btn streaming'; sendBtn.disabled = false;
      inputEl.disabled = true;
      messages.push({ role: 'user', content: msg.userText, sender: 'You', timestamp: Date.now() });
      renderMessages();
      break;
    case 'chunk': {
      var last = messages[messages.length - 1];
      if (last && last.isAssistantStreaming) { last.content += msg.text; }
      else { messages.push({ role: 'assistant', content: msg.text, sender: msg.sender || 'Assistant', isAssistantStreaming: true, timestamp: Date.now() }); }
      renderMessages();
      break;
    }
    case 'streamingEnd': {
      streaming = false;
      var last2 = messages[messages.length - 1];
      if (last2 && last2.isAssistantStreaming) { last2.isAssistantStreaming = false; last2.sender = cfg ? cfg.displayName : 'Assistant'; }
      sendBtn.textContent = 'Send'; sendBtn.className = 'send-btn'; sendBtn.disabled = !cfg || !cfg.apiKeyConfigured;
      inputEl.disabled = !cfg || !cfg.apiKeyConfigured;
      renderMessages();
      break;
    }
    case 'error':
      streaming = false;
      sendBtn.textContent = 'Send'; sendBtn.className = 'send-btn';
      if (errorBannerEl) { errorBannerEl.textContent = msg.message; errorBannerEl.style.display = ''; }
      messages.push({ role: 'assistant', content: msg.message, sender: 'Error', isError: true, timestamp: Date.now() });
      if (cfg) { inputEl.disabled = !cfg.apiKeyConfigured; }
      renderMessages();
      break;
    case 'cleared': messages = []; renderMessages(); break;
  }
});
</script>`;

function buildHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${CSS}</style></head><body>
<div class="header">
  <select id="provider-select" class="provider-select">
    <option value="xiaomi">Xiaomi MiMo</option>
    <option value="glm">Z.ai GLM</option>
    <option value="groq">Groq</option>
    <option value="nvidia">NVIDIA NIM</option>
  </select>
  <select id="model-select" class="model-select"></select>
  <div class="header-right">
    <div id="status-dot" class="status-dot disconnected"></div>
  </div>
</div>
<div id="error-banner" class="error-banner"></div>
<div id="messages" class="messages"></div>
<div id="empty-state" class="empty-state">
  <div class="icon">💬</div>
  <div>Select a provider and model, then start chatting</div>
  <div style="font-size:12px;opacity:0.6">Powered by Copilot Amplify</div>
</div>
<div class="input-area">
  <textarea id="chat-input" rows="1" placeholder="Ask anything..."></textarea>
  <button id="send-btn" class="send-btn" disabled>Send</button>
</div>
${SCRIPT}
</body></html>`;
}

// ─── Active panel tracking ─────────────────────────────────────────────────────

let activePanel: ChatPanel | undefined;

// ─── ChatPanel class ───────────────────────────────────────────────────────────

class ChatPanel {
  private abortCtrl: AbortController | null = null;
  private currentProviderId = 'xiaomi';
  private selectedModelId: string = 'mimo-v2.5-pro';
  private conversation: ChatMessage[] = [];

  constructor(
    public readonly panel: vscode.WebviewPanel,
    private readonly configs: ChatProviderConfig[],
  ) {
    panel.webview.html = buildHtml();
    panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    void this.refreshState();
  }

  private async onMessage(msg: Record<string, unknown>): Promise<void> {
    switch (msg.type) {
      case 'changeProvider':
        this.currentProviderId = msg.providerId as string;
        this.conversation = [];
        this.selectedModelId = this.getCurrentConfig()?.defaultModel ?? '';
        this.panel.webview.postMessage({ type: 'cleared' });
        await this.refreshState();
        break;
      case 'changeModel':
        this.selectedModelId = msg.modelId as string;
        break;
      case 'sendMessage':
        await this.sendMessage(msg.text as string, msg.modelId as string);
        break;
      case 'cancelStream':
        this.abortCtrl?.abort();
        break;
    }
  }

  private getCurrentConfig(): ChatProviderConfig | undefined {
    return this.configs.find((c) => c.id === this.currentProviderId);
  }

  private async refreshState(): Promise<void> {
    const cfg = this.getCurrentConfig();
    if (!cfg) return;
    const apiKey = await cfg.authManager.getApiKey();
    this.selectedModelId = cfg.defaultModel;
    this.panel.webview.postMessage({
      type: 'state',
      providerId: cfg.id,
      models: cfg.models,
      defaultModelId: cfg.defaultModel,
      apiKeyConfigured: Boolean(apiKey),
      displayName: cfg.displayName,
    });
  }

  private async sendMessage(text: string, modelId: string): Promise<void> {
    const cfg = this.getCurrentConfig();
    if (!cfg) return;

    const apiKey = await cfg.authManager.getApiKey();
    if (!apiKey) {
      this.panel.webview.postMessage({ type: 'error', message: `${cfg.displayName} API key is not configured. Set it via the Providers panel.` });
      return;
    }

    const actualModel = modelId || this.selectedModelId || cfg.defaultModel;
    this.abortCtrl = new AbortController();
    const client = cfg.apiClientFactory(apiKey);

    this.conversation.push({ role: 'user', content: text, sender: 'You', timestamp: Date.now() });
    this.panel.webview.postMessage({ type: 'streamingStart', userText: text });

    try {
      const openAiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: 'You are a helpful AI assistant. Keep responses concise and informative.' },
        ...this.conversation.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];

      let fullResponse = '';
      const stream = client.streamChat(actualModel, openAiMessages, { maxTokens: 8192 }, undefined);

      for await (const chunk of stream) {
        if (this.abortCtrl.signal.aborted) break;
        for (const choice of chunk.choices) {
          if (choice.delta.content) {
            fullResponse += choice.delta.content;
            this.panel.webview.postMessage({ type: 'chunk', text: choice.delta.content, sender: cfg.displayName });
          }
        }
      }

      if (!this.abortCtrl.signal.aborted) {
        this.conversation.push({ role: 'assistant', content: fullResponse, sender: cfg.displayName, timestamp: Date.now() });
        this.panel.webview.postMessage({ type: 'streamingEnd' });
      } else {
        this.panel.webview.postMessage({ type: 'streamingEnd' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({ type: 'error', message });
      this.panel.webview.postMessage({ type: 'streamingEnd' });
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function openChatPanel(
  context: vscode.ExtensionContext,
  configs: ChatProviderConfig[],
): void {
  if (activePanel) {
    activePanel.panel.reveal(undefined, true);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'copilot-amplify.chat',
    'Copilot Amplify Chat',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true },
  );

  activePanel = new ChatPanel(panel, configs);
  panel.onDidDispose(() => { activePanel = undefined; });
}
