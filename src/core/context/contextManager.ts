import * as vscode from 'vscode';
import type { GenericContentPart, GenericMessage } from '../api/client';
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
      if (!existing) {
        converted.unshift({ role: 'system', content: systemPrompt });
      } else {
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
      }
    } else {
      converted.unshift({ role: 'system', content: systemPrompt });
    }
  }

  // 2. Truncate context if budget exceeded
  const budget = Math.max(1024, config.maxInputTokens - config.reserveOutputTokens);
  let totalTokens = converted.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);

  const systemMsgs = converted.filter((m) => m.role === 'system');
  const nonSystemMsgs = converted.filter((m) => m.role !== 'system');

  // Keep at least the latest user turn
  while (nonSystemMsgs.length > 1 && totalTokens > budget) {
    const target = nonSystemMsgs[0];

    if (target && target.role === 'assistant' && target.tool_calls?.length) {
      // Remove assistant tool call message + matching tool result messages to preserve valid schema
      const callIds = new Set(target.tool_calls.map((c) => c.id));
      nonSystemMsgs.shift();
      totalTokens -= estimateMessageTokens(target);

      for (;;) {
        const toolMsg = nonSystemMsgs[0];
        if (
          nonSystemMsgs.length > 0 &&
          toolMsg?.role === 'tool' &&
          toolMsg.tool_call_id &&
          callIds.has(toolMsg.tool_call_id)
        ) {
          nonSystemMsgs.shift();
          totalTokens -= estimateMessageTokens(toolMsg);
          continue;
        }
        break;
      }
    } else {
      const removed = nonSystemMsgs.shift();
      if (removed) {
        totalTokens -= estimateMessageTokens(removed);
      }
    }
  }

  // Ensure sequence does not start with an orphaned tool message
  while (nonSystemMsgs.length > 1 && nonSystemMsgs[0]?.role === 'tool') {
    nonSystemMsgs.shift();
  }

  // Ensure no assistant message references tool_calls whose tool results are missing.
  // Collect all remaining tool_call_ids from tool messages.
  const presentToolCallIds = new Set(
    nonSystemMsgs
      .filter((m) => m.role === 'tool' && m.tool_call_id)
      .map((m) => m.tool_call_id!),
  );

  // Remove leading assistant messages with tool_calls that lost their results
  while (
    nonSystemMsgs.length > 1 &&
    nonSystemMsgs[0]?.role === 'assistant' &&
    nonSystemMsgs[0].tool_calls?.length &&
    nonSystemMsgs[0].tool_calls.every((c) => !presentToolCallIds.has(c.id))
  ) {
    nonSystemMsgs.shift();
  }

  return [...systemMsgs, ...nonSystemMsgs];
}
