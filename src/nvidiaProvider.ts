import { BaseChatProvider } from './baseProvider';
import { NIM_MODELS } from './models';
import { BASE_URL } from './nvidiaApi';
import type * as vscode from 'vscode';

const NIM_MODEL_ID_MAP: Record<string, string> = {
  'gemma-4-31b-it': 'google/gemma-4-31b-it',
  'nemotron-3-ultra-550b-a55b': 'nvidia/nemotron-3-ultra-550b-a55b',
  'nemotron-3-super-120b-a12b': 'nvidia/nemotron-3-super-120b-a12b',
  'deepseek-v4-flash': 'deepseek-ai/deepseek-v4-flash',
  'deepseek-v4-pro': 'deepseek-ai/deepseek-v4-pro',
  'minimax-m3': 'minimaxai/minimax-m3',
  'step-3.5-flash': 'stepfun-ai/step-3.5-flash',
  'step-3.7-flash': 'stepfun-ai/step-3.7-flash',
  'glm-5.2': 'z-ai/glm-5.2',
  'devstral-2-123b-instruct-2512': 'mistralai/devstral-2-123b-instruct-2512',
  'kimi-k2.6': 'moonshotai/kimi-k2.6',
  'qwen3-coder-480b-a35b-instruct': 'qwen/qwen3-coder-480b-a35b-instruct',
  'granite-3.3-8b-instruct': 'ibm/granite-3.3-8b-instruct',
  'qwq-32b': 'qwen/qwq-32b',
  'falcon3-7b-instruct': 'tiiuae/falcon3-7b-instruct',
  'laguna-xs-2.1': 'poolside/laguna-xs-2.1',
  'llama-3.3-70b-instruct': 'meta/llama-3.3-70b-instruct',
};

const NIM_THINKING_MODELS = new Set(['glm-5.2', 'qwq-32b']);

export class NvidiaChatProvider extends BaseChatProvider {
  protected override readonly baseURL = BASE_URL;
  protected override readonly providerDisplayName = 'NVIDIA NIM';
  protected override readonly models: vscode.LanguageModelChatInformation[] = NIM_MODELS;

  protected override mapModelId(modelId: string): string {
    return NIM_MODEL_ID_MAP[modelId] ?? modelId;
  }

  protected override supportsThinking(modelId: string): boolean {
    return NIM_THINKING_MODELS.has(modelId);
  }

  protected override readonly errorMessages: Record<number, string> = {
    400: 'Invalid request format. Check parameters and message format.',
    401: 'Authentication failed. Please set a new key using "Copilot Amplify: NVIDIA NIM - Set API Key".',
    403: 'Access denied. The API key may be restricted for this model.',
    404: 'Model not found. Try a different NVIDIA NIM model.',
    421: 'Request blocked by content filter. Avoid unsafe or sensitive content.',
    429: 'Rate limit reached. Please wait and try again.',
    500: 'NVIDIA NIM server error. Please try again later.',
    503: 'NVIDIA NIM server overloaded. Please try again later.',
  };
}
