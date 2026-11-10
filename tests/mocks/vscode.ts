// Minimal VS Code API mock: only what the modules under test touch.
export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
  };
  fire(e: T): void { for (const l of this.listeners) l(e); }
  dispose(): void { this.listeners = []; }
}

export const workspace = {
  getConfiguration: () => ({ get: <T>(_key: string, fallback?: T) => fallback }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
};

export const window = {
  createOutputChannel: () => ({ appendLine: () => {}, append: () => {}, show: () => {}, dispose: () => {} }),
};

export enum LanguageModelChatMessageRole { User = 1, Assistant = 2 }

export class LanguageModelTextPart { constructor(public value: string) {} }
export class LanguageModelDataPart { constructor(public data: Uint8Array, public mimeType: string) {} }
export class LanguageModelPromptTsxPart { constructor(public value: unknown) {} }
export class LanguageModelToolCallPart {
  constructor(public callId: string, public name: string, public input: object) {}
}
export class LanguageModelToolResultPart {
  constructor(public callId: string, public content: unknown[]) {}
}

export class CancellationTokenSource {
  private readonly emitter = new EventEmitter<void>();
  token = {
    isCancellationRequested: false,
    onCancellationRequested: this.emitter.event,
  };
  cancel(): void {
    this.token.isCancellationRequested = true;
    this.emitter.fire();
  }
  dispose(): void { this.emitter.dispose(); }
}

export enum LanguageModelChatToolMode { Auto = 1, Required = 2 }

export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
export class TreeItem {
  [key: string]: unknown;
  constructor(public label: string, public collapsibleState?: TreeItemCollapsibleState) {}
}
export class ThemeIcon { constructor(public id: string, public color?: unknown) {} }
export class ThemeColor { constructor(public id: string) {} }
export class MarkdownString { constructor(public value = '') {} }
