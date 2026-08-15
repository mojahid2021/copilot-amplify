import * as vscode from 'vscode';
import type { GenericContentPart, GenericMessage } from './baseApi';
import { convertMessages } from './converter';

export interface ContextWindowConfig {
  maxInputTokens: number;
  reserveOutputTokens: number;
  customSystemPrompt?: string;
}

/**
 * Fast character-based token estimator (approx 3.8 chars per token).
 */
export function estimateMessageTokens(message: GenericMessage): number {
  let chars = message.role.length;
  if (typeof message.content === 'string') {
    chars += message.content.length;
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text') {
        chars += part.text.length;
      } else if (part.type === 'image_url') {
        chars += 1000; // Fixed token weight for image parts
      }
    }
  }
  if (message.tool_calls) {
    chars += JSON.stringify(message.tool_calls).length;
  }
  return Math.ceil(chars / 3.8);
}

/**
 * Prepares messages for API request: injects custom system prompts and truncates
 * older user/assistant messages if token count exceeds model budget.
 */
export function prepareContextMessages(
  vsMessages: readonly vscode.LanguageModelChatRequestMessage[],
  allowImages: boolean,
  config: ContextWindowConfig,
): GenericMessage[] {
  const converted = convertMessages(vsMessages, allowImages);

  // 1. Inject Custom System Prompt if configured
  const systemPrompt =
    config.customSystemPrompt?.trim() ||
    vscode.workspace.getConfiguration('copilot-amplify').get<string>('customSystemPrompt')?.trim() ||
    '';

  if (systemPrompt) {
    const existingSystemIdx = converted.findIndex((m) => m.role === 'system');
    if (existingSystemIdx >= 0) {
      const existing = converted[existingSystemIdx];
      const existingText =
        typeof existing.content === 'string'
          ? existing.content
          : (existing.content as GenericContentPart[])
              .filter((p) => p.type === 'text')
              .map((p) => p.text)
              .join('');
      converted[existingSystemIdx] = {
        role: 'system',
        content: `${systemPrompt}\n\n${existingText}`,
      };
    } else {
      converted.unshift({ role: 'system', content: systemPrompt });
    }
  }

  // 2. Truncate context if budget exceeded
  const budget = Math.max(1024, config.maxInputTokens - config.reserveOutputTokens);
  let totalTokens = converted.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);

  if (totalTokens <= budget) {
    return converted;
  }

  const systemMsgs = converted.filter((m) => m.role === 'system');
  const nonSystemMsgs = converted.filter((m) => m.role !== 'system');

  // Keep at least the latest user turn
  while (nonSystemMsgs.length > 1 && totalTokens > budget) {
    const target = nonSystemMsgs[0];

    if (target.role === 'assistant' && target.tool_calls?.length) {
      // Remove assistant tool call message + matching tool result messages to preserve valid schema
      const callIds = new Set(target.tool_calls.map((c) => c.id));
      nonSystemMsgs.shift();
      totalTokens -= estimateMessageTokens(target);

      while (
        nonSystemMsgs.length > 0 &&
        nonSystemMsgs[0].role === 'tool' &&
        nonSystemMsgs[0].tool_call_id &&
        callIds.has(nonSystemMsgs[0].tool_call_id)
      ) {
        const toolMsg = nonSystemMsgs.shift()!;
        totalTokens -= estimateMessageTokens(toolMsg);
      }
    } else {
      const removed = nonSystemMsgs.shift();
      if (removed) {
        totalTokens -= estimateMessageTokens(removed);
      }
    }
  }

  // Ensure sequence does not start with an orphaned tool message
  while (nonSystemMsgs.length > 1 && nonSystemMsgs[0].role === 'tool') {
    nonSystemMsgs.shift();
  }

  return [...systemMsgs, ...nonSystemMsgs];
}
