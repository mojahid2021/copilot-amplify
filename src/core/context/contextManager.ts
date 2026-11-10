import * as vscode from 'vscode';
import type { GenericContentPart, GenericMessage } from '../api/client';
import { convertMessages } from './converter';
import { getGlobalConfig } from '../globalConfig';

const TRUNCATED_TOOL_OUTPUT = '[output truncated to fit the context window]';

export interface ContextWindowConfig {
  maxInputTokens: number;
  reserveOutputTokens: number;
}

/** Rough token count: about 3.8 characters per token, images count as 1000 characters. */
export function estimateMessageTokens(message: GenericMessage): number {
  let chars = message.role.length;
  if (typeof message.content === 'string') {
    chars += message.content.length;
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text') {
        chars += part.text.length;
      } else if (part.type === 'image_url') {
        chars += 1000;
      }
    }
  }
  if (message.tool_calls) {
    chars += JSON.stringify(message.tool_calls).length;
  }
  return Math.ceil(chars / 3.8);
}

/**
 * Convert VS Code messages for the API, add the custom system prompt, and
 * trim the oldest turns until the conversation fits the model's input budget.
 * Tool calls and their results are always kept or dropped together, because
 * APIs reject a tool result whose call is missing (and vice versa).
 */
export function prepareContextMessages(
  vsMessages: readonly vscode.LanguageModelChatRequestMessage[],
  allowImages: boolean,
  config: ContextWindowConfig,
): GenericMessage[] {
  const converted = convertMessages(vsMessages, allowImages);

  // The user's custom system prompt goes in front of Copilot's own.
  const customPrompt = getGlobalConfig().customSystemPrompt;
  if (customPrompt) {
    const existing = converted.find((m) => m.role === 'system');
    if (existing) {
      existing.content = `${customPrompt}\n\n${textOf(existing.content)}`;
    } else {
      converted.unshift({ role: 'system', content: customPrompt });
    }
  }

  // Over budget: drop the oldest turns first.
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
      let groupSize = 1;
      for (;;) {
        const toolMsg = nonSystemMsgs[groupSize];
        if (toolMsg?.role === 'tool' && toolMsg.tool_call_id && callIds.has(toolMsg.tool_call_id)) {
          groupSize++;
          continue;
        }
        break;
      }
      // The group is the newest turn (agent mode: tool result last). Dropping it
      // would leave no conversation at all; let the content trimmer below shrink it.
      if (groupSize >= nonSystemMsgs.length) {
        break;
      }
      for (const removed of nonSystemMsgs.splice(0, groupSize)) {
        totalTokens -= estimateMessageTokens(removed);
      }
    } else {
      const removed = nonSystemMsgs.shift();
      if (removed) {
        totalTokens -= estimateMessageTokens(removed);
      }
    }
  }

  // Last-resort: if a single message still exceeds the budget (e.g., one very
  // long user turn), trim content from the beginning so we stay within limits.
  // We preserve the tail of the message since it is most likely to be relevant.
  while (totalTokens > budget) {
    // Skip assistant tool-call messages: removing one orphans its tool results.
    const targetIdx = nonSystemMsgs.findIndex((m) => !(m.role === 'assistant' && m.tool_calls?.length));
    const target = nonSystemMsgs[targetIdx];
    if (!target) break;

    const prevTokens = estimateMessageTokens(target);
    const excess = totalTokens - budget;
    let shifted = false;
    if (typeof target.content === 'string') {
      const charBudget = Math.max(0, target.content.length - Math.ceil(excess * 3.8));
      if (charBudget > 0) {
        target.content = target.content.slice(target.content.length - charBudget);
      } else if (target.role === 'tool') {
        // A tool result must stay so its tool call remains valid; empty it instead.
        target.content = TRUNCATED_TOOL_OUTPUT;
      } else {
        nonSystemMsgs.splice(targetIdx, 1);
        shifted = true;
      }
    } else if (Array.isArray(target.content)) {
      // Drop text parts from oldest to newest until we fit.
      let dropped = false;
      for (let i = 0; i < target.content.length && totalTokens > budget; i++) {
        const part = target.content[i];
        if (!part) continue;
        if (part.type === 'text') {
          target.content.splice(i, 1);
          i--;
          dropped = true;
        }
      }
      if (!dropped) { nonSystemMsgs.splice(targetIdx, 1); shifted = true; }
    }

    // Update incrementally — only re-estimate the one mutated message, not the whole array.
    const newTokens = shifted ? 0 : estimateMessageTokens(target);
    if (!shifted && newTokens >= prevTokens) {
      break; // nothing left to trim (e.g. the system prompt alone exceeds the budget)
    }
    totalTokens = totalTokens - prevTokens + newTokens;
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

function textOf(content: string | GenericContentPart[]): string {
  return typeof content === 'string'
    ? content
    : content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}
