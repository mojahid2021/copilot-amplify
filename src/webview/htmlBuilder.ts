import * as crypto from 'crypto';

export function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function buildWebviewHtml(nonce: string, isSidebar: boolean = true): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' var:; script-src 'nonce-${nonce}' 'unsafe-eval'; img-src data: https: http:;">
  <title>Copilot Amplify Chat</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
      --fg: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #cccccc));
      --surface: var(--vscode-editorWidget-background, #252526);
      --border: var(--vscode-sideBar-border, var(--vscode-widget-border, rgba(255,255,255,0.1)));
      --input-bg: var(--vscode-input-background, #3c3c3c);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --input-border: var(--vscode-input-border, #454545);
      --accent: var(--vscode-button-background, #0078d4);
      --accent-hover: var(--vscode-button-hoverBackground, #026ec1);
      --accent-fg: var(--vscode-button-foreground, #ffffff);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      --error-bg: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      --error-border: var(--vscode-inputValidation-errorBorder, #be1111);
      --success: #4ec9b0;
      --warning: #cca700;
      --code-bg: var(--vscode-textCodeBlock-background, #1e1e1e);
      --radius: 6px;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --mono-font: var(--vscode-editor-font-family, "Consolas", "Courier New", monospace);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font);
      background-color: var(--bg);
      color: var(--fg);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-size: 13px;
    }

    /* Top Navigation Header */
    .header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      z-index: 10;
    }

    .header-btn {
      background: transparent;
      color: var(--fg);
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 4px 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      opacity: 0.8;
      transition: all 0.15s;
    }
    .header-btn:hover {
      opacity: 1;
      background: rgba(255,255,255,0.08);
      border-color: var(--border);
    }

    .provider-select, .model-select {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 11px;
      outline: none;
      cursor: pointer;
    }
    .provider-select { min-width: 100px; }
    .model-select { flex: 1; min-width: 110px; max-width: 220px; text-overflow: ellipsis; }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .status-dot.connected { background: var(--success); box-shadow: 0 0 6px var(--success); }
    .status-dot.disconnected { background: var(--error-border); box-shadow: 0 0 6px var(--error-border); }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    }

    /* Error Toast */
    .error-banner {
      background: var(--error-bg);
      color: #ffcccc;
      border-bottom: 1px solid var(--error-border);
      padding: 6px 12px;
      font-size: 11px;
      display: none;
      align-items: center;
      justify-content: space-between;
    }
    .error-banner .close-btn { cursor: pointer; opacity: 0.8; font-weight: bold; }

    /* Main Chat Container */
    .chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
    }

    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--fg);
      opacity: 0.7;
      text-align: center;
      padding: 24px;
    }
    .empty-state .logo { font-size: 32px; }
    .empty-state h3 { font-weight: 600; font-size: 14px; margin-bottom: 2px; }
    .empty-state p { font-size: 11px; max-width: 260px; line-height: 1.4; opacity: 0.75; }

    /* Quick Action Chips */
    .quick-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: center;
      margin-top: 8px;
    }
    .action-chip {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--fg);
      border-radius: 12px;
      padding: 4px 10px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .action-chip:hover {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: var(--accent);
    }

    /* Messages UI */
    .message-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 96%;
    }
    .message-row.user { align-self: flex-end; }
    .message-row.assistant { align-self: flex-start; }

    .message-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      opacity: 0.65;
      padding: 0 4px;
    }
    .message-row.user .message-header { justify-content: flex-end; }

    .message-bubble {
      padding: 10px 12px;
      border-radius: var(--radius);
      line-height: 1.5;
      word-break: break-word;
    }
    .message-row.user .message-bubble {
      background: var(--accent);
      color: var(--accent-fg);
      border-bottom-right-radius: 2px;
    }
    .message-row.assistant .message-bubble {
      background: var(--surface);
      border: 1px solid var(--border);
      border-bottom-left-radius: 2px;
    }
    .message-row.error .message-bubble {
      background: var(--error-bg);
      border: 1px solid var(--error-border);
      color: #ffcccc;
    }

    /* Thinking Foldout */
    .thinking-box {
      margin-bottom: 8px;
      background: rgba(0, 0, 0, 0.15);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 11px;
    }
    .thinking-box summary {
      cursor: pointer;
      font-weight: 600;
      opacity: 0.8;
      user-select: none;
    }
    .thinking-box summary:hover { opacity: 1; }
    .thinking-content {
      margin-top: 6px;
      white-space: pre-wrap;
      opacity: 0.85;
      font-family: var(--mono-font);
      font-size: 10.5px;
      max-height: 180px;
      overflow-y: auto;
    }

    /* Attachments tag */
    .attachment-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 10px;
      margin-bottom: 6px;
    }

    /* Telemetry Tag */
    .telemetry-tag {
      font-size: 10px;
      opacity: 0.55;
      margin-top: 4px;
      display: flex;
      gap: 8px;
      padding: 0 4px;
    }

    /* Formatting in Markdown */
    .message-bubble p { margin-bottom: 8px; }
    .message-bubble p:last-child { margin-bottom: 0; }
    .message-bubble ul, .message-bubble ol { margin-left: 18px; margin-bottom: 8px; }
    .message-bubble inline-code {
      font-family: var(--mono-font);
      background: rgba(255,255,255,0.12);
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 11.5px;
    }

    /* Code Blocks */
    .code-block-wrapper {
      margin: 8px 0;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--border);
      background: var(--code-bg);
    }
    .code-block-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 8px;
      background: rgba(0,0,0,0.25);
      border-bottom: 1px solid var(--border);
      font-family: var(--mono-font);
      font-size: 10px;
      opacity: 0.85;
    }
    .code-actions { display: flex; gap: 4px; }
    .code-btn {
      background: transparent;
      color: var(--fg);
      border: none;
      padding: 2px 6px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      opacity: 0.75;
      transition: opacity 0.15s;
    }
    .code-btn:hover { opacity: 1; background: rgba(255,255,255,0.15); }
    .code-block-body {
      padding: 10px;
      overflow-x: auto;
      font-family: var(--mono-font);
      font-size: 12px;
      line-height: 1.45;
      white-space: pre;
    }

    /* Active Context Bar */
    .context-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      background: var(--surface);
      border-top: 1px solid var(--border);
      font-size: 11px;
      flex-shrink: 0;
    }
    .context-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      font-size: 10px;
    }
    .context-chip.active { border-color: var(--accent); color: var(--accent-fg); background: var(--accent); }

    /* Input Controls */
    .input-area {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 12px 10px 12px;
      background: var(--surface);
      border-top: 1px solid var(--border);
      flex-shrink: 0;
    }
    .input-row {
      display: flex;
      gap: 6px;
      align-items: flex-end;
    }
    .input-area textarea {
      flex: 1;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: var(--radius);
      padding: 8px 10px;
      font-size: 12.5px;
      resize: none;
      min-height: 38px;
      max-height: 140px;
      font-family: var(--font);
      outline: none;
      line-height: 1.4;
    }
    .input-area textarea:focus { border-color: var(--accent); }
    .input-area textarea::placeholder { opacity: 0.5; }

    .icon-btn {
      background: transparent;
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      width: 34px;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 14px;
      flex-shrink: 0;
      opacity: 0.8;
      transition: all 0.15s;
    }
    .icon-btn:hover { opacity: 1; background: rgba(255,255,255,0.08); }

    .send-btn {
      background: var(--accent);
      color: var(--accent-fg);
      border: none;
      border-radius: var(--radius);
      padding: 0 14px;
      height: 34px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .send-btn:hover:not(:disabled) { background: var(--accent-hover); }
    .send-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .send-btn.streaming { background: var(--error-border); }

    /* Slide-out Modals / Drawers */
    .drawer {
      position: absolute;
      top: 38px;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--bg);
      z-index: 50;
      display: none;
      flex-direction: column;
      padding: 12px;
      border-top: 1px solid var(--border);
      overflow-y: auto;
    }
    .drawer.open { display: flex; }
    .drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--border);
    }
    .drawer-header h4 { font-weight: 600; font-size: 13px; }

    .session-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      border-radius: 4px;
      cursor: pointer;
      margin-bottom: 4px;
      border: 1px solid transparent;
      background: var(--surface);
    }
    .session-item:hover { border-color: var(--accent); }
    .session-item.active { border-color: var(--accent); background: rgba(0, 120, 212, 0.15); }
    .session-title { font-weight: 500; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
    .session-time { font-size: 10px; opacity: 0.5; }
    .session-actions { display: flex; gap: 4px; }

    .setting-group {
      margin-bottom: 14px;
    }
    .setting-group label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 4px;
      opacity: 0.85;
    }
    .setting-group select, .setting-group input[type="text"], .setting-group textarea {
      width: 100%;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 11px;
    }
    .setting-group input[type="range"] { width: 100%; }

    /* Image Attachment Preview */
    .image-preview-bar {
      display: none;
      gap: 6px;
      padding: 4px;
      margin-bottom: 4px;
    }
    .image-preview-thumb {
      position: relative;
      width: 44px;
      height: 44px;
      border-radius: 4px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    .image-preview-thumb img { width: 100%; height: 100%; object-fit: cover; }
    .image-preview-thumb .remove-img {
      position: absolute;
      top: 2px;
      right: 2px;
      background: rgba(0,0,0,0.7);
      color: white;
      border-radius: 50%;
      width: 14px;
      height: 14px;
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
  </style>
</head>
<body>

  <!-- Top Header Navigation -->
  <div class="header">
    <select id="provider-select" class="provider-select" title="Select AI Provider">
      <option value="xiaomi">Xiaomi MiMo</option>
      <option value="glm">Z.ai GLM</option>
      <option value="groq">Groq</option>
      <option value="nvidia">NVIDIA NIM</option>
      <option value="omniroute">Omniroute</option>
    </select>
    <select id="model-select" class="model-select" title="Select AI Model"></select>
    <div id="status-dot" class="status-dot disconnected" title="API Key Status"></div>

    <div class="header-actions">
      <button id="history-btn" class="header-btn" title="Chat History">💬</button>
      <button id="settings-btn" class="header-btn" title="Model & Provider Parameters">⚙️</button>
      ${isSidebar ? `<button id="popout-btn" class="header-btn" title="Pop out to Editor Tab">↗️</button>` : ''}
    </div>
  </div>

  <!-- Error Notification Banner -->
  <div id="error-banner" class="error-banner">
    <span id="error-msg"></span>
    <span class="close-btn" id="close-error-btn">✕</span>
  </div>

  <!-- Main Chat Conversation View -->
  <div id="chat-container" class="chat-container">
    <div id="empty-state" class="empty-state">
      <div class="logo">⚡</div>
      <h3>Copilot Amplify</h3>
      <p>Select your favorite provider & model to start coding with AI power.</p>
      
      <div class="quick-actions">
        <button class="action-chip" data-action="explain">💡 Explain Code</button>
        <button class="action-chip" data-action="fix">🐞 Fix Errors</button>
        <button class="action-chip" data-action="refactor">⚡ Refactor</button>
        <button class="action-chip" data-action="test">🧪 Add Tests</button>
      </div>
    </div>
    <div id="messages-list"></div>
  </div>

  <!-- History Drawer -->
  <div id="history-drawer" class="drawer">
    <div class="drawer-header">
      <h4>Chat History</h4>
      <div style="display:flex; gap:6px;">
        <button id="new-chat-btn" class="send-btn" style="height:24px; padding:0 8px; font-size:10px;">+ New Chat</button>
        <button id="close-history-btn" class="header-btn">✕</button>
      </div>
    </div>
    <div id="sessions-container"></div>
  </div>

  <!-- Settings Drawer -->
  <div id="settings-drawer" class="drawer">
    <div class="drawer-header">
      <h4>Parameters & Prompt Settings</h4>
      <button id="close-settings-btn" class="header-btn">✕</button>
    </div>
    <div class="setting-group">
      <label>System Persona Prompt</label>
      <select id="persona-preset" style="margin-bottom:6px;">
        <option value="default">General AI Assistant</option>
        <option value="typescript">Senior TypeScript Specialist</option>
        <option value="refactor">Refactoring & Code Quality Specialist</option>
        <option value="security">Security & Bug Hunter</option>
        <option value="custom">Custom System Prompt</option>
      </select>
      <textarea id="system-prompt-input" rows="3" placeholder="Enter custom system prompt..."></textarea>
    </div>
    <div class="setting-group">
      <label>Temperature (<span id="temp-val">0.7</span>)</label>
      <input type="range" id="temp-range" min="0" max="1" step="0.05" value="0.7">
    </div>
    <div class="setting-group" id="reasoning-group">
      <label>Reasoning Effort</label>
      <select id="reasoning-select">
        <option value="none">None</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high" selected>High</option>
        <option value="max">Max</option>
      </select>
    </div>
    <div class="setting-group" id="omniroute-settings" style="display:none;">
      <label>Omniroute Toggles</label>
      <div style="display:flex; gap:12px; margin-top:4px;">
        <label style="font-weight:normal;"><input type="checkbox" id="omniroute-nocache"> Bypass Cache</label>
        <label style="font-weight:normal;"><input type="checkbox" id="omniroute-nomemory" checked> Skip Memory</label>
      </div>
    </div>
  </div>

  <!-- Context Bar above Input -->
  <div id="context-bar" class="context-bar">
    <span style="opacity:0.6; font-size:10px;">Context:</span>
    <div id="selection-chip" class="context-chip" style="display:none;">
      📎 <span id="chip-filename">Selection</span>
    </div>
    <span id="no-context-lbl" style="opacity:0.5; font-size:10px;">No active code selection</span>
  </div>

  <!-- Input Area -->
  <div class="input-area">
    <div id="image-preview-bar" class="image-preview-bar"></div>
    <div class="input-row">
      <button id="attach-img-btn" class="icon-btn" title="Attach Image (Vision Models)">📷</button>
      <input type="file" id="image-file-input" accept="image/*" style="display:none;">
      <textarea id="chat-input" rows="1" placeholder="Ask anything... (Enter to send, Shift+Enter for newline)"></textarea>
      <button id="send-btn" class="send-btn" disabled>Send</button>
    </div>
  </div>

  <!-- Client Script Engine -->
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let currentSession = null;
    let sessionsList = [];
    let streaming = false;
    let activeContext = null;
    let attachedImage = null;

    // Elements
    const providerEl = document.getElementById('provider-select');
    const modelEl = document.getElementById('model-select');
    const statusDotEl = document.getElementById('status-dot');
    const errorBannerEl = document.getElementById('error-banner');
    const errorMsgEl = document.getElementById('error-msg');
    const closeErrorBtn = document.getElementById('close-error-btn');
    const chatContainerEl = document.getElementById('chat-container');
    const emptyStateEl = document.getElementById('empty-state');
    const messagesListEl = document.getElementById('messages-list');
    const inputEl = document.getElementById('chat-input');
    const sendBtn = document.getElementById('send-btn');
    
    // Drawers
    const historyBtn = document.getElementById('history-btn');
    const historyDrawer = document.getElementById('history-drawer');
    const closeHistoryBtn = document.getElementById('close-history-btn');
    const sessionsContainer = document.getElementById('sessions-container');
    const newChatBtn = document.getElementById('new-chat-btn');

    const settingsBtn = document.getElementById('settings-btn');
    const settingsDrawer = document.getElementById('settings-drawer');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const popoutBtn = document.getElementById('popout-btn');

    // Context & Attachments
    const selectionChip = document.getElementById('selection-chip');
    const chipFilename = document.getElementById('chip-filename');
    const noContextLbl = document.getElementById('no-context-lbl');
    const attachImgBtn = document.getElementById('attach-img-btn');
    const imageFileInput = document.getElementById('image-file-input');
    const imagePreviewBar = document.getElementById('image-preview-bar');

    // Settings elements
    const personaPreset = document.getElementById('persona-preset');
    const systemPromptInput = document.getElementById('system-prompt-input');
    const tempRange = document.getElementById('temp-range');
    const tempVal = document.getElementById('temp-val');
    const reasoningSelect = document.getElementById('reasoning-select');
    const omnirouteSettings = document.getElementById('omniroute-settings');
    const omnirouteNoCache = document.getElementById('omniroute-nocache');
    const omnirouteNoMemory = document.getElementById('omniroute-nomemory');

    // Simple Markdown Formatter
    function formatMarkdown(text) {
      if (!text) return '';
      let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // Thinking details extraction
      html = html.replace(/&lt;think&gt;([\\s\\S]*?)(?:&lt;\\/think&gt;|$)/gi, function(match, p1) {
        return '<details class="thinking-box"><summary>🧠 Thinking Process...</summary><div class="thinking-content">' + p1.trim() + '</div></details>';
      });

      const tick = String.fromCharCode(96);
      // Code blocks
      const codeBlockPattern = tick + tick + tick + '(\\\\w*)\\\\n([\\\\s\\\\S]*?)' + tick + tick + tick;
      const codeBlockRegex = new RegExp(codeBlockPattern, 'g');
      html = html.replace(codeBlockRegex, function(match, lang, code) {
        const cleanLang = lang || 'code';
        const escapedCode = code.trim();
        return '<div class="code-block-wrapper">' +
          '<div class="code-block-header">' +
            '<span>' + cleanLang + '</span>' +
            '<div class="code-actions">' +
              '<button class="code-btn" onclick="copyCode(this)">Copy</button>' +
              '<button class="code-btn" onclick="insertAtCursor(this)">Insert</button>' +
            '</div>' +
          '</div>' +
          '<div class="code-block-body"><code>' + escapedCode + '</code></div>' +
        '</div>';
      });

      // Inline code
      const inlineCodePattern = tick + '([^' + tick + ']+)' + tick;
      const inlineCodeRegex = new RegExp(inlineCodePattern, 'g');
      html = html.replace(inlineCodeRegex, '<span class="inline-code">$1</span>');
      // Paragraphs & Line breaks
      html = html.replace(/\\n\\n/g, '</p><p>').replace(/\\n/g, '<br>');
      return '<p>' + html + '</p>';
    }

    window.copyCode = function(btn) {
      const wrapper = btn.closest('.code-block-wrapper');
      const code = wrapper.querySelector('.code-block-body').innerText;
      vscode.postMessage({ type: 'copyToClipboard', text: code });
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy', 1500);
    };

    window.insertAtCursor = function(btn) {
      const wrapper = btn.closest('.code-block-wrapper');
      const code = wrapper.querySelector('.code-block-body').innerText;
      vscode.postMessage({ type: 'insertAtCursor', text: code });
    };

    function renderMessages() {
      if (!currentSession || !currentSession.messages || currentSession.messages.length === 0) {
        emptyStateEl.style.display = 'flex';
        messagesListEl.innerHTML = '';
        return;
      }

      emptyStateEl.style.display = 'none';
      messagesListEl.innerHTML = currentSession.messages.map(m => {
        const isUser = m.role === 'user';
        const isError = m.isError;
        let reasoningHtml = '';
        if (m.reasoningContent) {
          reasoningHtml = '<details class="thinking-box"><summary>🧠 Thinking Process</summary><div class="thinking-content">' + escapeHtml(m.reasoningContent) + '</div></details>';
        }

        let telemetryHtml = '';
        if (m.telemetry) {
          const parts = [];
          if (m.telemetry.latencyMs) parts.push(m.telemetry.latencyMs + 'ms');
          if (m.telemetry.totalTokens) parts.push(m.telemetry.totalTokens + ' tokens');
          if (m.telemetry.cacheHit) parts.push('⚡ Cache Hit');
          if (parts.length > 0) telemetryHtml = '<div class="telemetry-tag">' + parts.join(' • ') + '</div>';
        }

        let attachmentsHtml = '';
        if (m.attachments && m.attachments.length > 0) {
          attachmentsHtml = m.attachments.map(a => '<div class="attachment-tag">📎 ' + escapeHtml(a.name) + '</div>').join('');
        }

        return '<div class="message-row ' + (isUser ? 'user' : (isError ? 'error' : 'assistant')) + '" id="msg-' + m.id + '">' +
          '<div class="message-header"><span>' + escapeHtml(m.sender) + '</span></div>' +
          '<div class="message-bubble">' +
            attachmentsHtml +
            reasoningHtml +
            (isUser ? escapeHtml(m.content) : formatMarkdown(m.content)) +
          '</div>' +
          telemetryHtml +
        '</div>';
      }).join('');

      chatContainerEl.scrollTop = chatContainerEl.scrollHeight;
    }

    function escapeHtml(s) {
      return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function syncUI(data) {
      currentSession = data.currentSession;
      sessionsList = data.sessionsList || [];
      const hasKey = data.apiKeyConfigured;

      providerEl.value = data.providerId;
      omnirouteSettings.style.display = data.providerId === 'omniroute' ? 'block' : 'none';

      modelEl.innerHTML = '';
      (data.models || []).forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        if (m.id === data.defaultModelId) opt.selected = true;
        modelEl.appendChild(opt);
      });

      statusDotEl.className = 'status-dot ' + (hasKey ? 'connected' : 'disconnected');
      statusDotEl.title = hasKey ? 'API Key Configured' : 'API Key Missing (Click to set)';

      inputEl.disabled = !hasKey;
      sendBtn.disabled = !hasKey || streaming;
      inputEl.placeholder = hasKey ? 'Ask anything... (Enter to send, Shift+Enter for newline)' : 'Configure API Key in Providers panel to start';

      if (data.activeContext) {
        updateContextUI(data.activeContext);
      }

      renderMessages();
      renderSessionsList();
    }

    function updateContextUI(ctx) {
      activeContext = ctx;
      if (ctx && ctx.hasSelection && ctx.selectionSnippet) {
        selectionChip.style.display = 'inline-flex';
        chipFilename.textContent = ctx.fileName || 'Selection';
        noContextLbl.style.display = 'none';
      } else {
        selectionChip.style.display = 'none';
        noContextLbl.style.display = 'inline';
      }
    }

    function renderSessionsList() {
      if (!sessionsContainer) return;
      if (sessionsList.length === 0) {
        sessionsContainer.innerHTML = '<div style="opacity:0.5; font-size:11px; padding:12px; text-align:center;">No history yet</div>';
        return;
      }

      sessionsContainer.innerHTML = sessionsList.map(s => {
        const isActive = currentSession && currentSession.id === s.id;
        return '<div class="session-item ' + (isActive ? 'active' : '') + '" onclick="loadSession(\'' + s.id + '\')">' +
          '<div>' +
            '<div class="session-title">' + escapeHtml(s.title) + '</div>' +
            '<div class="session-time">' + new Date(s.updatedAt).toLocaleDateString() + '</div>' +
          '</div>' +
          '<div class="session-actions">' +
            '<button class="header-btn" onclick="event.stopPropagation(); deleteSession(\'' + s.id + '\')" title="Delete">🗑️</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    window.loadSession = function(id) {
      vscode.postMessage({ type: 'loadSession', sessionId: id });
      historyDrawer.classList.remove('open');
    };

    window.deleteSession = function(id) {
      vscode.postMessage({ type: 'deleteSession', sessionId: id });
    };

    // Event Listeners
    providerEl.addEventListener('change', () => {
      vscode.postMessage({ type: 'changeProvider', providerId: providerEl.value });
    });

    modelEl.addEventListener('change', () => {
      vscode.postMessage({ type: 'changeModel', modelId: modelEl.value });
    });

    statusDotEl.addEventListener('click', () => {
      vscode.postMessage({ type: 'openKeyInput', providerId: providerEl.value });
    });

    sendBtn.addEventListener('click', () => {
      if (streaming) {
        vscode.postMessage({ type: 'cancelStream' });
        return;
      }
      const text = inputEl.value.trim();
      if (!text && !attachedImage) return;

      const attachments = [];
      if (activeContext && activeContext.hasSelection && activeContext.selectionSnippet) {
        attachments.push({
          type: 'code_selection',
          name: activeContext.fileName || 'selection',
          content: activeContext.selectionSnippet
        });
      }
      if (attachedImage) {
        attachments.push({
          type: 'image',
          name: attachedImage.name,
          content: attachedImage.dataUrl,
          mimeType: attachedImage.type
        });
      }

      const params = {
        systemPrompt: systemPromptInput.value,
        temperature: parseFloat(tempRange.value),
        reasoningEffort: reasoningSelect.value,
        omnirouteNoCache: omnirouteNoCache.checked,
        omnirouteNoMemory: omnirouteNoMemory.checked
      };

      inputEl.value = '';
      clearImageAttachment();

      vscode.postMessage({
        type: 'sendMessage',
        text,
        modelId: modelEl.value,
        attachments,
        parameters: params
      });
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });

    // Quick action chips
    document.querySelectorAll('.action-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-action');
        let promptText = '';
        if (act === 'explain') promptText = 'Explain this code in detail and highlight key logic:';
        if (act === 'fix') promptText = 'Identify any potential bugs, edge cases, or syntax errors in this code and provide a fix:';
        if (act === 'refactor') promptText = 'Refactor this code to improve performance, readability, and modern TypeScript standards:';
        if (act === 'test') promptText = 'Generate thorough unit test cases for this code:';
        inputEl.value = promptText;
        inputEl.focus();
      });
    });

    // Drawers
    historyBtn.addEventListener('click', () => historyDrawer.classList.toggle('open'));
    closeHistoryBtn.addEventListener('click', () => historyDrawer.classList.remove('open'));
    newChatBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'newSession' });
      historyDrawer.classList.remove('open');
    });

    settingsBtn.addEventListener('click', () => settingsDrawer.classList.toggle('open'));
    closeSettingsBtn.addEventListener('click', () => settingsDrawer.classList.remove('open'));

    if (popoutBtn) {
      popoutBtn.addEventListener('click', () => vscode.postMessage({ type: 'popOutPanel' }));
    }

    closeErrorBtn.addEventListener('click', () => errorBannerEl.style.display = 'none');

    tempRange.addEventListener('input', () => tempVal.textContent = tempRange.value);
    personaPreset.addEventListener('change', () => {
      const val = personaPreset.value;
      if (val === 'typescript') systemPromptInput.value = 'You are an expert Senior TypeScript Engineer. Write clean, type-safe, concise code with modern ES standards.';
      else if (val === 'refactor') systemPromptInput.value = 'You are a Code Refactoring Specialist. Focus on clean code, performance optimization, and modular structure.';
      else if (val === 'security') systemPromptInput.value = 'You are a Security Auditor. Focus on vulnerability detection, edge case safety, and input validation.';
      else if (val === 'default') systemPromptInput.value = 'You are a helpful AI assistant. Keep responses concise, precise, and informative.';
    });

    // Image Attachment
    attachImgBtn.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        attachedImage = {
          name: file.name,
          type: file.type,
          dataUrl: evt.target.result
        };
        imagePreviewBar.style.display = 'flex';
        imagePreviewBar.innerHTML = '<div class="image-preview-thumb"><img src="' + evt.target.result + '"><span class="remove-img" onclick="clearImageAttachment()">✕</span></div>';
      };
      reader.readAsDataURL(file);
    });

    window.clearImageAttachment = function() {
      attachedImage = null;
      imagePreviewBar.style.display = 'none';
      imagePreviewBar.innerHTML = '';
      imageFileInput.value = '';
    };

    // Receive Messages from Host
    let streamingRafId = null;

    function updateStreamingBubble(msgId) {
      if (streamingRafId) return;
      streamingRafId = requestAnimationFrame(() => {
        streamingRafId = null;
        if (!currentSession || !currentSession.messages) return;
        const last = currentSession.messages[currentSession.messages.length - 1];
        if (!last || last.id !== msgId) return;

        const rowEl = document.getElementById('msg-' + msgId);
        if (!rowEl) {
          renderMessages();
          return;
        }

        const bubbleEl = rowEl.querySelector('.message-bubble');
        if (bubbleEl) {
          let reasoningHtml = '';
          if (last.reasoningContent) {
            reasoningHtml = '<details class="thinking-box" open><summary>🧠 Thinking Process...</summary><div class="thinking-content">' + escapeHtml(last.reasoningContent) + '</div></details>';
          }
          bubbleEl.innerHTML = reasoningHtml + (last.content ? formatMarkdown(last.content) : '');
          chatContainerEl.scrollTop = chatContainerEl.scrollHeight;
        }
      });
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'state':
          syncUI(msg);
          break;

        case 'activeContextUpdate':
          updateContextUI(msg);
          break;

        case 'streamingStart':
          streaming = true;
          sendBtn.textContent = 'Stop';
          sendBtn.className = 'send-btn streaming';
          sendBtn.disabled = false;
          inputEl.disabled = true;
          currentSession.messages.push(msg.userMessage);
          renderMessages();
          break;

        case 'chunk': {
          let last = currentSession.messages[currentSession.messages.length - 1];
          if (last && last.id === msg.messageId && last.isAssistantStreaming) {
            last.content += msg.text;
            if (msg.reasoningText) {
              last.reasoningContent = (last.reasoningContent || '') + msg.reasoningText;
            }
          } else {
            last = {
              id: msg.messageId,
              role: 'assistant',
              content: msg.text,
              sender: 'Assistant',
              isAssistantStreaming: true,
              timestamp: Date.now(),
              reasoningContent: msg.reasoningText
            };
            currentSession.messages.push(last);
          }
          updateStreamingBubble(msg.messageId);
          break;
        }

        case 'streamingEnd': {
          streaming = false;
          if (streamingRafId) {
            cancelAnimationFrame(streamingRafId);
            streamingRafId = null;
          }
          const last2 = currentSession.messages[currentSession.messages.length - 1];
          if (last2 && last2.isAssistantStreaming) {
            last2.isAssistantStreaming = false;
            last2.sender = msg.sender || 'Assistant';
            if (msg.telemetry) last2.telemetry = msg.telemetry;
          }
          sendBtn.textContent = 'Send';
          sendBtn.className = 'send-btn';
          sendBtn.disabled = false;
          inputEl.disabled = false;
          renderMessages();
          break;
        }

        case 'error':
          streaming = false;
          sendBtn.textContent = 'Send';
          sendBtn.className = 'send-btn';
          inputEl.disabled = false;
          errorMsgEl.textContent = msg.message;
          errorBannerEl.style.display = 'flex';
          break;

        case 'sessionsUpdated':
          sessionsList = msg.sessionsList;
          renderSessionsList();
          break;
      }
    });

    // Request initial context
    vscode.postMessage({ type: 'requestActiveContext' });
  </script>
</body>
</html>`;
}
