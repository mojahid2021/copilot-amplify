/**
 * Anthropic-specific request conversion.
 *
 * The shared chat pipeline prepares messages in the OpenAI shape
 * (`GenericMessage[]`) and concatenates the custom system prompt into
 * `GenericMessage` entries with `role: 'system'`. The Anthropic `messages`
 * API wants the system prompt at the top level of the request body and
 * the conversation alternating between `user` and `assistant` roles with
 * `tool_result` blocks for tool responses.
 *
 * This module translates the prepared OpenAI-shaped messages into the
 * Anthropic wire format. Mirrors the structure of
 * `src/core/context/converter.ts` but produces a different output.
 */

import type {
  AnthropicContentBlock,
  AnthropicMessageParam,
  AnthropicTool,
  AnthropicToolResultBlock,
} from '../api/anthropicClient';
import type { GenericContentPart, GenericMessage, GenericTool, GenericToolCall } from '../api/client';

/**
 * Convert a single OpenAI-shaped content part to an Anthropic content block.
 * Image parts become `image` blocks (Anthropic requires base64 source).
 */
function toAnthropicPart(part: GenericContentPart): AnthropicContentBlock {
  if (part.type === 'text') {
    return { type: 'text', text: part.text };
  }
  // OpenAI image_url with a data URI → base64 + media_type.
  const url = part.image_url.url;
  const dataUriMatch = /^data:([^;]+);base64,(.*)$/s.exec(url);
  if (dataUriMatch) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: dataUriMatch[1] ?? 'image/png', data: dataUriMatch[2] ?? '' },
    };
  }
  // Remote URLs are not supported by Anthropic natively; fall back to a
  // text placeholder so the request still goes through and the model can
  // acknowledge the missing image gracefully.
  return { type: 'text', text: `[image omitted: ${url.slice(0, 80)}]` };
}

function toAnthropicContent(content: string | GenericContentPart[]): string | AnthropicContentBlock[] {
  if (typeof content === 'string') {
    return content;
  }
  return content.map(toAnthropicPart);
}

function flattenToolResult(content: string | GenericContentPart[]): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export interface AnthropicConvertedRequest {
  /** Concatenated system prompt, or `undefined` when no system content was present. */
  system: string | undefined;
  /** Alternating user/assistant message list (tool results folded into user turns). */
  messages: AnthropicMessageParam[];
}

/**
 * Convert prepared OpenAI-shaped `GenericMessage[]` into an
 * `AnthropicMessageParam[]` plus an aggregated system prompt.
 *
 * System messages are concatenated (in order) into the top-level
 * `system` string. Assistant `tool_calls` and the matching `tool`
 * results are folded into the expected alternating pattern: the assistant
 * turn emits `tool_use` blocks, the next user turn emits matching
 * `tool_result` blocks.
 */
export function convertMessagesToAnthropic(
  prepared: GenericMessage[],
): AnthropicConvertedRequest {
  const systemParts: string[] = [];
  const out: AnthropicMessageParam[] = [];

  let pendingAssistantToolCalls: GenericToolCall[] | undefined;
  let pendingToolResults: AnthropicToolResultBlock[] = [];

  const flushAssistant = (): void => {
    if (!pendingAssistantToolCalls?.length) {
      pendingAssistantToolCalls = undefined;
      return;
    }
    const blocks: AnthropicContentBlock[] = pendingAssistantToolCalls.map((call) => ({
      type: 'tool_use' as const,
      id: call.id,
      name: call.function.name,
      input: parseLooseJson(call.function.arguments) ?? {},
    }));
    out.push({ role: 'assistant', content: blocks });
    pendingAssistantToolCalls = undefined;
  };

  const flushUserToolResults = (): void => {
    if (!pendingToolResults.length) {
      return;
    }
    out.push({ role: 'user', content: pendingToolResults });
    pendingToolResults = [];
  };

  for (const message of prepared) {
    if (message.role === 'system') {
      const text = typeof message.content === 'string'
        ? message.content
        : message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('');
      if (text.trim().length > 0) {
        systemParts.push(text);
      }
      continue;
    }
    if (message.role === 'assistant') {
      // Finish any pending user tool-result block first (Anthropic enforces
      // strict alternation: a tool_use-bearing assistant turn is always
      // followed by a user turn carrying tool_result blocks).
      flushUserToolResults();
      if (message.tool_calls?.length) {
        flushAssistant();
        pendingAssistantToolCalls = message.tool_calls;
      } else {
        flushAssistant();
        out.push({ role: 'assistant', content: toAnthropicContent(message.content) });
      }
      continue;
    }
    if (message.role === 'tool') {
      const result: AnthropicToolResultBlock = {
        type: 'tool_result',
        tool_use_id: message.tool_call_id ?? '',
        content: flattenToolResult(message.content),
      };
      // The assistant turn that produced this tool_use_id was already
      // emitted (or will be flushed on the next assistant message). If we
      // see the tool result before the assistant tool_use block, buffer
      // it so flushUserToolResults emits it together with the next turn.
      pendingToolResults.push(result);
      continue;
    }
    // user
    flushAssistant();
    flushUserToolResults();
    out.push({ role: 'user', content: toAnthropicContent(message.content) });
  }

  // Tail flush
  flushAssistant();
  flushUserToolResults();

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: out,
  };
}

export function convertToolsToAnthropic(tools?: GenericTool[]): AnthropicTool[] | undefined {
  if (!tools?.length) {
    return undefined;
  }
  return tools.map((tool) => ({
    name: tool.function.name,
    ...(tool.function.description ? { description: tool.function.description } : {}),
    input_schema: tool.function.parameters,
  }));
}

/**
 * Parse a tool-call argument string. Tolerant: returns `undefined` on
 * malformed input so the call site can decide between an empty object
 * and an error.
 */
function parseLooseJson(input: string): Record<string, unknown> | undefined {
  let cleaned = (input ?? '').trim();
  if (!cleaned) {
    return {};
  }
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fallthrough */
  }
  return undefined;
}
