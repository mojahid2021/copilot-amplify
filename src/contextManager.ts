import * as vscode from 'vscode';
import { ChatAttachment } from './types/chat';

export interface ActiveContextInfo {
  fileName?: string;
  filePath?: string;
  selectionSnippet?: string;
  hasSelection: boolean;
  startLine?: number;
  endLine?: number;
}

export class ContextManager {
  private listeners: Set<(ctx: ActiveContextInfo) => void> = new Set();
  private disposables: vscode.Disposable[] = [];
  private selectionDebounceTimer?: NodeJS.Timeout;

  constructor() {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.notifyListeners()),
      vscode.window.onDidChangeTextEditorSelection(() => this.notifyListenersDebounced()),
    );
  }

  public registerListener(callback: (ctx: ActiveContextInfo) => void): vscode.Disposable {
    this.listeners.add(callback);
    callback(this.getActiveContext());
    return new vscode.Disposable(() => {
      this.listeners.delete(callback);
    });
  }

  private notifyListenersDebounced(): void {
    if (this.selectionDebounceTimer) {
      clearTimeout(this.selectionDebounceTimer);
    }
    this.selectionDebounceTimer = setTimeout(() => {
      this.notifyListeners();
    }, 150);
  }

  private notifyListeners(): void {
    const ctx = this.getActiveContext();
    for (const listener of this.listeners) {
      listener(ctx);
    }
  }

  public getActiveContext(): ActiveContextInfo {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return { hasSelection: false };
    }

    const doc = editor.document;
    const selection = editor.selection;
    const fileName = doc.fileName.split(/[/\\]/).pop() || doc.fileName;
    const filePath = doc.fileName;

    if (!selection.isEmpty) {
      let selectedText = doc.getText(selection);
      // Cap selection size to 50KB to avoid heavy IPC serialization and UI freezing
      if (selectedText.length > 50000) {
        selectedText = selectedText.slice(0, 50000) + '\n... [Content Truncated]';
      }
      return {
        fileName,
        filePath,
        selectionSnippet: selectedText,
        hasSelection: true,
        startLine: selection.start.line + 1,
        endLine: selection.end.line + 1,
      };
    }

    return {
      fileName,
      filePath,
      hasSelection: false,
    };
  }

  public createAttachmentFromActiveSelection(): ChatAttachment | undefined {
    const ctx = this.getActiveContext();
    if (!ctx.hasSelection || !ctx.selectionSnippet || !ctx.fileName) {
      return undefined;
    }
    return {
      type: 'code_selection',
      name: `${ctx.fileName}:${ctx.startLine}-${ctx.endLine}`,
      path: ctx.filePath,
      content: ctx.selectionSnippet,
      startLine: ctx.startLine,
      endLine: ctx.endLine,
    };
  }

  public async insertAtCursor(text: string): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor found to insert code into.');
      return false;
    }
    return editor.edit((editBuilder) => {
      editBuilder.insert(editor.selection.active, text);
    });
  }

  public async applyToActiveFile(text: string): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor found to apply code changes.');
      return false;
    }
    const selection = editor.selection;
    if (!selection.isEmpty) {
      return editor.edit((editBuilder) => {
        editBuilder.replace(selection, text);
      });
    }
    // Replace full document if no selection
    const fullRange = new vscode.Range(
      editor.document.positionAt(0),
      editor.document.positionAt(editor.document.getText().length),
    );
    return editor.edit((editBuilder) => {
      editBuilder.replace(fullRange, text);
    });
  }

  public dispose(): void {
    if (this.selectionDebounceTimer) {
      clearTimeout(this.selectionDebounceTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
