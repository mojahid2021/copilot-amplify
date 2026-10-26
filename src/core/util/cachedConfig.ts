import * as vscode from 'vscode';

export interface CachedConfigHandle<T> {
  get(): T;
  readonly onChange: vscode.Event<void>;
  dispose(): void;
}

/**
 * Creates a config cache that reads once and invalidates 250 ms after any
 * relevant `onDidChangeConfiguration` event. Registers the listener lazily
 * on the first `get()` call so activation stays side-effect-free.
 */
export function createCachedConfig<T>(
  section: string,
  build: (cfg: vscode.WorkspaceConfiguration) => T,
): CachedConfigHandle<T> {
  let cached: T | undefined;
  let listener: vscode.Disposable | undefined;
  let timer: NodeJS.Timeout | undefined;
  const emitter = new vscode.EventEmitter<void>();

  function scheduleInvalidate(): void {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      cached = undefined;
      emitter.fire();
    }, 250);
    timer.unref?.();
  }

  return {
    get(): T {
      if (cached !== undefined) return cached;
      if (!listener) {
        listener = vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration(section)) scheduleInvalidate();
        });
      }
      cached = build(vscode.workspace.getConfiguration(section));
      return cached;
    },
    onChange: emitter.event,
    dispose(): void {
      listener?.dispose();
      listener = undefined;
      if (timer) { clearTimeout(timer); timer = undefined; }
      emitter.dispose();
      cached = undefined;
    },
  };
}
