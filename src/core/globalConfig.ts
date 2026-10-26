import * as vscode from 'vscode';
import { createCachedConfig } from './util/cachedConfig';

export interface GlobalConfig {
  enableReasoning: boolean;
  customSystemPrompt: string;
}

const _cache = createCachedConfig('copilot-amplify', (cfg: vscode.WorkspaceConfiguration): GlobalConfig => ({
  enableReasoning: cfg.get<boolean>('enableReasoning', true),
  customSystemPrompt: (cfg.get<string>('customSystemPrompt') ?? '').trim(),
}));

export const getGlobalConfig = (): GlobalConfig => _cache.get();

export function disposeGlobalConfig(): void {
  _cache.dispose();
}
