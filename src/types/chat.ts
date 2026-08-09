export type Role = 'user' | 'assistant' | 'system';

export interface ChatAttachment {
  type: 'code_selection' | 'file' | 'image';
  name: string;
  path?: string;
  content: string;
  mimeType?: string;
  startLine?: number;
  endLine?: number;
}

export interface TelemetryData {
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  costSaved?: number;
  cacheHit?: boolean;
  provider?: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  sender: string;
  timestamp: number;
  isAssistantStreaming?: boolean;
  isError?: boolean;
  reasoningContent?: string;
  attachments?: ChatAttachment[];
  telemetry?: TelemetryData;
}

export interface ModelParameters {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'max';
  omnirouteNoCache?: boolean;
  omnirouteNoMemory?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  providerId: string;
  modelId: string;
  messages: ChatMessage[];
  parameters: ModelParameters;
  createdAt: number;
  updatedAt: number;
}

export interface QuickActionPrompt {
  id: 'explain' | 'fix' | 'refactor' | 'test' | 'docstring';
  label: string;
  icon: string;
  description: string;
}

export type WebviewToHostMessage =
  | { type: 'changeProvider'; providerId: string }
  | { type: 'changeModel'; modelId: string }
  | { type: 'sendMessage'; text: string; modelId: string; attachments?: ChatAttachment[]; parameters?: ModelParameters }
  | { type: 'cancelStream' }
  | { type: 'newSession' }
  | { type: 'loadSession'; sessionId: string }
  | { type: 'deleteSession'; sessionId: string }
  | { type: 'renameSession'; sessionId: string; title: string }
  | { type: 'updateParameters'; parameters: ModelParameters }
  | { type: 'copyToClipboard'; text: string }
  | { type: 'insertAtCursor'; text: string }
  | { type: 'applyToActiveFile'; text: string }
  | { type: 'openSettings' }
  | { type: 'openKeyInput'; providerId: string }
  | { type: 'popOutPanel' }
  | { type: 'requestActiveContext' }
  | { type: 'exportChat'; format: 'markdown' | 'json' };

export type HostToWebviewMessage =
  | {
      type: 'state';
      providerId: string;
      models: Array<{ id: string; name: string }>;
      defaultModelId: string;
      apiKeyConfigured: boolean;
      displayName: string;
      currentSession: ChatSession;
      sessionsList: Array<{ id: string; title: string; updatedAt: number }>;
      activeContext?: { fileName?: string; selectionSnippet?: string; hasSelection: boolean };
    }
  | { type: 'streamingStart'; userMessage: ChatMessage }
  | { type: 'chunk'; messageId: string; text: string; reasoningText?: string }
  | { type: 'streamingEnd'; messageId: string; sender: string; telemetry?: TelemetryData }
  | { type: 'error'; message: string }
  | { type: 'activeContextUpdate'; fileName?: string; selectionSnippet?: string; hasSelection: boolean }
  | { type: 'sessionsUpdated'; sessionsList: Array<{ id: string; title: string; updatedAt: number }>; activeSessionId: string };
