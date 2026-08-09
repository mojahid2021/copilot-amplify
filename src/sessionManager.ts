import * as vscode from 'vscode';
import { ChatSession, ChatMessage, ModelParameters } from './types/chat';

const SESSIONS_STORAGE_KEY = 'copilot-amplify.chatSessions.v1';
const ACTIVE_SESSION_ID_KEY = 'copilot-amplify.activeSessionId.v1';

export class SessionManager {
  private sessions: Map<string, ChatSession> = new Map();
  private activeSessionId: string = '';

  constructor(private readonly context: vscode.ExtensionContext) {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const rawSessions = this.context.workspaceState.get<ChatSession[]>(SESSIONS_STORAGE_KEY, []);
    this.sessions.clear();
    for (const session of rawSessions) {
      this.sessions.set(session.id, session);
    }

    const storedActiveId = this.context.workspaceState.get<string>(ACTIVE_SESSION_ID_KEY, '');
    if (storedActiveId && this.sessions.has(storedActiveId)) {
      this.activeSessionId = storedActiveId;
    } else if (this.sessions.size > 0) {
      this.activeSessionId = Array.from(this.sessions.keys())[0];
    } else {
      const newSession = this.createSession('xiaomi', 'mimo-v2.5-pro');
      this.activeSessionId = newSession.id;
    }
  }

  private saveToStorage(): void {
    const sessionList = Array.from(this.sessions.values());
    void this.context.workspaceState.update(SESSIONS_STORAGE_KEY, sessionList);
    void this.context.workspaceState.update(ACTIVE_SESSION_ID_KEY, this.activeSessionId);
  }

  public createSession(providerId: string, modelId: string, title?: string): ChatSession {
    const id = `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const session: ChatSession = {
      id,
      title: title || 'New Chat',
      providerId,
      modelId,
      messages: [],
      parameters: {
        temperature: 0.7,
        systemPrompt: 'You are a helpful AI assistant. Keep responses concise, precise, and informative.',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(id, session);
    this.activeSessionId = id;
    this.saveToStorage();
    return session;
  }

  public getActiveSession(): ChatSession {
    let session = this.sessions.get(this.activeSessionId);
    if (!session) {
      session = this.createSession('xiaomi', 'mimo-v2.5-pro');
      this.activeSessionId = session.id;
    }
    return session;
  }

  public setActiveSession(sessionId: string): ChatSession | undefined {
    if (this.sessions.has(sessionId)) {
      this.activeSessionId = sessionId;
      this.saveToStorage();
      return this.sessions.get(sessionId);
    }
    return undefined;
  }

  public getSessionsList(): Array<{ id: string; title: string; updatedAt: number }> {
    return Array.from(this.sessions.values())
      .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public updateSession(session: ChatSession): void {
    session.updatedAt = Date.now();
    this.sessions.set(session.id, session);
    this.saveToStorage();
  }

  public addMessageToActiveSession(message: ChatMessage): ChatSession {
    const session = this.getActiveSession();
    session.messages.push(message);
    
    // Auto-generate a title from the first user message if title is 'New Chat'
    if (session.messages.length === 1 && message.role === 'user' && session.title === 'New Chat') {
      const cleanText = message.content.replace(/\s+/g, ' ').trim();
      session.title = cleanText.length > 30 ? cleanText.slice(0, 30) + '...' : cleanText;
    }

    session.updatedAt = Date.now();
    this.saveToStorage();
    return session;
  }

  public updateMessageInActiveSession(messageId: string, content: string, reasoningContent?: string, isStreaming = false): void {
    const session = this.getActiveSession();
    const msg = session.messages.find((m) => m.id === messageId);
    if (msg) {
      msg.content = content;
      if (reasoningContent !== undefined) {
        msg.reasoningContent = reasoningContent;
      }
      msg.isAssistantStreaming = isStreaming;
      session.updatedAt = Date.now();
      this.saveToStorage();
    }
  }

  public deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      if (this.activeSessionId === sessionId) {
        const remaining = Array.from(this.sessions.keys());
        if (remaining.length > 0) {
          this.activeSessionId = remaining[0];
        } else {
          const newSession = this.createSession('xiaomi', 'mimo-v2.5-pro');
          this.activeSessionId = newSession.id;
        }
      }
      this.saveToStorage();
    }
    return deleted;
  }

  public renameSession(sessionId: string, newTitle: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.title = newTitle.trim() || 'Untitled Chat';
      session.updatedAt = Date.now();
      this.saveToStorage();
      return true;
    }
    return false;
  }

  public updateActiveSessionParameters(parameters: ModelParameters): void {
    const session = this.getActiveSession();
    session.parameters = { ...session.parameters, ...parameters };
    session.updatedAt = Date.now();
    this.saveToStorage();
  }

  public updateActiveSessionProviderAndModel(providerId: string, modelId: string): void {
    const session = this.getActiveSession();
    session.providerId = providerId;
    session.modelId = modelId;
    session.updatedAt = Date.now();
    this.saveToStorage();
  }
}
