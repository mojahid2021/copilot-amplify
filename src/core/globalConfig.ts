import * as vscode from 'vscode';
import { createCachedConfig, positiveNumber } from './util/cachedConfig';

export interface GlobalConfig {
  enableReasoning: boolean;
  customSystemPrompt: string;
  /** Load model lists for Xiaomi, Z.ai, Groq and NVIDIA right after VS Code starts. */
  loadModelsOnStartup: boolean;
  /** Timeout for loading a model list or testing a connection (those four providers). */
  modelListTimeoutMs: number;
}

const _cache = createCachedConfig('copilot-amplify', (cfg: vscode.WorkspaceConfiguration): GlobalConfig => ({
  enableReasoning: cfg.get<boolean>('enableReasoning', true),
  customSystemPrompt: (cfg.get<string>('customSystemPrompt') ?? '').trim(),
  loadModelsOnStartup: cfg.get<boolean>('loadModelsOnStartup', false),
  modelListTimeoutMs: positiveNumber(cfg.get<number>('modelListTimeoutMs'), 8_000),
}));

export const getGlobalConfig = (): GlobalConfig => _cache.get();

export function disposeGlobalConfig(): void {
  _cache.dispose();
}
