import type * as vscode from 'vscode';

interface LanguageModelConfigurationProperty {
  type: 'string';
  title: string;
  enum: string[];
  enumItemLabels: string[];
  enumDescriptions: string[];
  default: string;
  group: 'navigation';
}

interface LanguageModelConfigurationSchema {
  properties: Record<string, LanguageModelConfigurationProperty>;
}

interface ConfigurableLanguageModelChatInformation extends vscode.LanguageModelChatInformation {
  configurationSchema?: LanguageModelConfigurationSchema;
}

const GLM_THINKING_CONFIGURATION: LanguageModelConfigurationSchema = {
  properties: {
    reasoningEffort: {
      type: 'string',
      title: 'Thinking Effort',
      enum: ['none', 'high'],
      enumItemLabels: ['None', 'High'],
      enumDescriptions: [
        'Disable GLM thinking for faster responses',
        'Enable GLM thinking',
      ],
      default: 'high',
      group: 'navigation',
    },
  },
};

const GLM_MAX_THINKING_CONFIGURATION: LanguageModelConfigurationSchema = {
  properties: {
    reasoningEffort: {
      type: 'string',
      title: 'Thinking Effort',
      enum: ['none', 'high', 'max'],
      enumItemLabels: ['None', 'High', 'Max'],
      enumDescriptions: [
        'Disable GLM thinking for faster responses',
        'Enable GLM thinking',
        'Enable deeper GLM thinking for complex coding tasks',
      ],
      default: 'high',
      group: 'navigation',
    },
  },
};

const NVIDIA_THINKING_CONFIGURATION: LanguageModelConfigurationSchema = {
  properties: {
    reasoningEffort: {
      type: 'string',
      title: 'Thinking Effort',
      enum: ['none', 'high', 'max'],
      enumItemLabels: ['None', 'High', 'Max'],
      enumDescriptions: [
        'Disable NVIDIA NIM thinking for faster responses',
        'Enable NVIDIA NIM thinking',
        'Enable deeper NVIDIA NIM thinking for complex reasoning tasks',
      ],
      default: 'high',
      group: 'navigation',
    },
  },
};

/**
 * Thinking-effort schema for Claude models surfaced through AgentRouter.
 *
 * The Anthropic `messages` API exposes thinking as a binary `thinking` block
 * (enabled/disabled) plus an explicit `budget_tokens` allocation — there is
 * no enum-style "low / high / max" knob like the OpenAI-compatible path
 * offers. The picker therefore exposes a binary toggle; the budget is a
 * fixed default inside the provider implementation.
 */
export const AGENTROUTER_CLAUDE_THINKING_CONFIGURATION: LanguageModelConfigurationSchema = {
  properties: {
    reasoningEffort: {
      type: 'string',
      title: 'Thinking',
      enum: ['none', 'high'],
      enumItemLabels: ['Disabled', 'Enabled'],
      enumDescriptions: [
        'Disable Claude extended thinking for faster, lower-latency responses',
        'Enable Claude extended thinking — the model allocates reasoning tokens before answering',
      ],
      default: 'high',
      group: 'navigation',
    },
  },
};

export const MIMO_MODELS: vscode.LanguageModelChatInformation[] = [
  {
    id: 'mimo-v2.5-pro',
    name: 'MiMo-V2.5-Pro',
    family: 'mimo',
    version: 'v2.5-pro',
    tooltip: 'Xiaomi',
    detail: 'Xiaomi',
    maxInputTokens: 1048576,
    maxOutputTokens: 131072,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: 'mimo-v2.5',
    name: 'MiMo-V2.5',
    family: 'mimo',
    version: 'v2.5',
    tooltip: 'Xiaomi',
    detail: 'Xiaomi',
    maxInputTokens: 262144,
    maxOutputTokens: 131072,
    capabilities: { imageInput: true, toolCalling: true },
  },
];

export const GLM_MODELS: ConfigurableLanguageModelChatInformation[] = [
  {
    id: 'glm-5.2',
    name: 'GLM-5.2',
    family: 'glm',
    version: '5.2',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 1000000,
    maxOutputTokens: 131072,
    capabilities: { imageInput: false, toolCalling: true },
    configurationSchema: GLM_MAX_THINKING_CONFIGURATION,
  },
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    family: 'glm',
    version: '5.1',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: { imageInput: false, toolCalling: true },
    configurationSchema: GLM_THINKING_CONFIGURATION,
  },
  {
    id: 'glm-5-turbo',
    name: 'GLM-5 Turbo',
    family: 'glm',
    version: '5-turbo',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: { imageInput: false, toolCalling: true },
    configurationSchema: GLM_THINKING_CONFIGURATION,
  },
  {
    id: 'glm-5v-turbo',
    name: 'GLM-5V-Turbo',
    family: 'glm',
    version: '5v-turbo',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: { imageInput: true, toolCalling: true },
    configurationSchema: GLM_THINKING_CONFIGURATION,
  },
  {
    id: 'glm-5',
    name: 'GLM-5',
    family: 'glm',
    version: '5',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: { imageInput: false, toolCalling: true },
    configurationSchema: GLM_THINKING_CONFIGURATION,
  },
  {
    id: 'glm-4.7',
    name: 'GLM-4.7',
    family: 'glm',
    version: '4.7',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens:204800,
    maxOutputTokens: 131072,
    capabilities: { imageInput: false, toolCalling: true },
    configurationSchema: GLM_THINKING_CONFIGURATION,
  },
  {
    id: 'glm-4.7-flash',
    name: 'GLM-4.7 Flash',
    family: 'glm',
    version: '4.7-flash',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: { imageInput: false, toolCalling: true },
    configurationSchema: GLM_THINKING_CONFIGURATION,
  },
  {
    id: 'glm-4.6',
    name: 'GLM-4.6',
    family: 'glm',
    version: '4.6',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 204800,
    maxOutputTokens: 131072,
    capabilities: { imageInput: false, toolCalling: true },
    configurationSchema: GLM_THINKING_CONFIGURATION,
  },
  {
    id: 'glm-4.5',
    name: 'GLM-4.5',
    family: 'glm',
    version: '4.5',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 131072,
    maxOutputTokens: 98304,
    capabilities: { imageInput: false, toolCalling: true },
    configurationSchema: GLM_THINKING_CONFIGURATION,
  },
  {
    id: 'glm-4.5-air',
    name: 'GLM-4.5 Air',
    family: 'glm',
    version: '4.5-air',
    tooltip: 'Z.AI',
    detail: 'Z.AI',
    maxInputTokens: 131072,
    maxOutputTokens: 98304,
    capabilities: { imageInput: false, toolCalling: true },
    configurationSchema: GLM_THINKING_CONFIGURATION,
  },
];

export const NIM_MODELS: ConfigurableLanguageModelChatInformation[] = [
  {
    id: 'gemma-4-31b-it',
    name: 'Gemma 4 31B IT',
    family: 'nvidia-nim',
    version: 'gemma-4-31b-it',
    tooltip: 'NVIDIA NIM',
    detail: 'NVIDIA',
    maxInputTokens: 262144,
    maxOutputTokens: 8192,
    capabilities: { imageInput: true, toolCalling: true },
  },
  {
    id: 'deepseek-v4-pro-0813',
    name: 'DeepSeek V4 Pro (08-13)',
    family: 'nvidia-nim',
    version: 'deepseek-v4-pro-0813',
    tooltip: 'NVIDIA NIM',
    detail: 'NVIDIA',
    maxInputTokens: 1048576,
    maxOutputTokens: 16384,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: 'nemotron-3-ultra-550b-a55b',
    name: 'Nemotron 3 Ultra 550B',
    family: 'nvidia-nim',
    version: 'nemotron-3-ultra-550b-a55b',
    tooltip: 'NVIDIA NIM',
    detail: 'NVIDIA',
    maxInputTokens: 1048576,
    maxOutputTokens: 16384,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: 'deepseek-v4-flash-0731',
    name: 'DeepSeek V4 Flash (07-31)',
    family: 'nvidia-nim',
    version: 'deepseek-v4-flash-0731',
    tooltip: 'NVIDIA NIM',
    detail: 'NVIDIA',
    maxInputTokens: 1048576,
    maxOutputTokens: 16384,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    family: 'nvidia-nim',
    version: 'kimi-k3',
    tooltip: 'NVIDIA NIM',
    detail: 'NVIDIA',
    maxInputTokens: 262144,
    maxOutputTokens: 16384,
    capabilities: { imageInput: true, toolCalling: true },
    configurationSchema: NVIDIA_THINKING_CONFIGURATION,
  },
  {
    id: 'minimax-m3',
    name: 'MiniMax M3',
    family: 'nvidia-nim',
    version: 'minimax-m3',
    tooltip: 'NVIDIA NIM',
    detail: 'NVIDIA',
    maxInputTokens: 1048576,
    maxOutputTokens: 8192,
    capabilities: { imageInput: true, toolCalling: true },
  },
  {
    id: 'laguna-xs-2.1',
    name: 'Laguna XS 2.1',
    family: 'nvidia-nim',
    version: 'laguna-xs-2.1',
    tooltip: 'NVIDIA NIM',
    detail: 'NVIDIA',
    maxInputTokens: 262144,
    maxOutputTokens: 8192,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: 'gpt-oss-120b',
    name: 'GPT-OSS 120B',
    family: 'nvidia-nim',
    version: 'gpt-oss-120b',
    tooltip: 'NVIDIA NIM',
    detail: 'NVIDIA',
    maxInputTokens: 131072,
    maxOutputTokens: 65536,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: 'mistral-nemotron',
    name: 'Mistral Nemotron',
    family: 'nvidia-nim',
    version: 'mistral-nemotron',
    tooltip: 'NVIDIA NIM',
    detail: 'NVIDIA',
    maxInputTokens: 32768,
    maxOutputTokens: 4096,
    capabilities: { imageInput: false, toolCalling: true },
  },
];

export const GROQ_MODELS: vscode.LanguageModelChatInformation[] = [
  {
    id: 'llama-3.1-8b-instant',
    name: 'Llama 3.1 8B Instant',
    family: 'groq',
    version: 'llama-3.1-8b-instant',
    tooltip: 'Groq',
    detail: 'Groq',
    maxInputTokens: 131072,
    maxOutputTokens: 131072,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B Versatile',
    family: 'groq',
    version: 'llama-3.3-70b-versatile',
    tooltip: 'Groq',
    detail: 'Groq',
    maxInputTokens: 131072,
    maxOutputTokens: 32768,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: 'openai/gpt-oss-120b',
    name: 'GPT-OSS 120B',
    family: 'groq',
    version: 'gpt-oss-120b',
    tooltip: 'Groq',
    detail: 'Groq',
    maxInputTokens: 131072,
    maxOutputTokens: 65536,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: 'openai/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    family: 'groq',
    version: 'gpt-oss-20b',
    tooltip: 'Groq',
    detail: 'Groq',
    maxInputTokens: 131072,
    maxOutputTokens: 65536,
    capabilities: { imageInput: false, toolCalling: true },
  },
  {
    id: 'groq/compound',
    name: 'Groq Compound',
    family: 'groq',
    version: 'compound',
    tooltip: 'Groq',
    detail: 'Groq',
    maxInputTokens: 131072,
    maxOutputTokens: 8192,
    capabilities: { imageInput: false, toolCalling: false },
  },
  {
    id: 'groq/compound-mini',
    name: 'Groq Compound Mini',
    family: 'groq',
    version: 'compound-mini',
    tooltip: 'Groq',
    detail: 'Groq',
    maxInputTokens: 131072,
    maxOutputTokens: 8192,
    capabilities: { imageInput: false, toolCalling: false },
  },
  {
    id: 'qwen/qwen3-32b',
    name: 'Qwen3 32B',
    family: 'groq',
    version: 'qwen3-32b',
    tooltip: 'Groq',
    detail: 'Groq',
    maxInputTokens: 131072,
    maxOutputTokens: 40960,
    capabilities: { imageInput: false, toolCalling: true },
  },
];


