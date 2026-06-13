import secureJsonParse from 'secure-json-parse';
import { P, match } from 'ts-pattern';
import * as vscode from 'vscode';
import type { GenericContentPart, GenericMessage, GenericTool, GenericToolCall } from './baseApi';

interface PendingMessageState {
  contentParts: GenericContentPart[];
  toolCalls: GenericToolCall[];
}

export function convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  allowImageParts: boolean,
): GenericMessage[] {
  return messages.flatMap((message) => toGenericMessages(message, allowImageParts));
}

export function convertTools(
  tools?: readonly vscode.LanguageModelChatTool[],
): GenericTool[] | undefined {
  return tools?.length
    ? tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: (tool.inputSchema ?? {}) as Record<string, unknown>,
      },
    }))
    : undefined;
}

export function parseToolArguments(argumentsText: string): Record<string, unknown> {
  const parsed = secureJsonParse.safeParse(argumentsText || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function toGenericMessages(
  message: vscode.LanguageModelChatRequestMessage,
  allowImageParts: boolean,
): GenericMessage[] {
  const messages: GenericMessage[] = [];
  const pending: PendingMessageState = { contentParts: [], toolCalls: [] };

  const flushPending = (): void => {
    if (pending.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: flattenTextContent(pending.contentParts),
        tool_calls: pending.toolCalls,
      });
      pending.contentParts = [];
      pending.toolCalls = [];
      return;
    }

    if (pending.contentParts.length > 0) {
      messages.push({
        role: convertRole(message.role),
        content: normalizeMessageContent(message.role, pending.contentParts),
        name: message.name,
      });
      pending.contentParts = [];
    }
  };

  for (const part of message.content) {
    match(part)
      .with(P.instanceOf(vscode.LanguageModelTextPart), (value) => {
        pending.contentParts = appendTextContent(pending.contentParts, value.value);
      })
      .with(P.instanceOf(vscode.LanguageModelDataPart), (value) => {
        pending.contentParts = appendDataContent(pending.contentParts, value, allowImageParts);
      })
      .with(P.instanceOf(vscode.LanguageModelToolCallPart), (value) => {
        pending.toolCalls = [
          ...pending.toolCalls,
          {
            id: value.callId,
            type: 'function' as const,
            function: {
              name: value.name,
              arguments: JSON.stringify(value.input),
            },
          },
        ];
      })
      .with(P.instanceOf(vscode.LanguageModelToolResultPart), (value) => {
        flushPending();
        messages.push({
          role: 'tool',
          content: flattenToolResultContent(value.content),
          tool_call_id: value.callId,
        });
      })
      .otherwise(() => { });
  }

  flushPending();
  return messages;
}

function appendTextContent(parts: GenericContentPart[], text: string): GenericContentPart[] {
  if (!text) {
    return parts;
  }

  const lastPart = parts.at(-1);
  if (lastPart?.type === 'text') {
    lastPart.text += text;
    return parts;
  }

  return [...parts, { type: 'text', text }];
}

function appendDataContent(
  parts: GenericContentPart[],
  part: vscode.LanguageModelDataPart,
  allowImageParts: boolean,
): GenericContentPart[] {
  if (allowImageParts && part.mimeType.startsWith('image/')) {
    return [
      ...parts,
      {
        type: 'image_url',
        image_url: {
          url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`,
        },
      },
    ];
  }

  return appendTextContent(parts, dataPartToText(part));
}

function normalizeMessageContent(
  role: vscode.LanguageModelChatMessageRole,
  parts: GenericContentPart[],
): string | GenericContentPart[] {
  if (role === vscode.LanguageModelChatMessageRole.User && parts.some((part) => part.type !== 'text')) {
    return parts;
  }

  return flattenTextContent(parts);
}

function flattenTextContent(parts: GenericContentPart[]): string {
  return parts
    .filter((part): part is Extract<GenericContentPart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function flattenToolResultContent(
  content: readonly (vscode.LanguageModelTextPart | vscode.LanguageModelPromptTsxPart | vscode.LanguageModelDataPart | unknown)[],
): string {
  return content
    .map((part) =>
      match(part)
        .with(P.instanceOf(vscode.LanguageModelTextPart), (value) => value.value)
        .with(P.instanceOf(vscode.LanguageModelDataPart), (value) => dataPartToText(value))
        .otherwise((value) => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        }))
    .join('');
}

function dataPartToText(part: vscode.LanguageModelDataPart): string {
  if (part.mimeType.startsWith('text/') || part.mimeType === 'application/json' || part.mimeType.endsWith('+json')) {
    return new TextDecoder().decode(part.data);
  }

  return `[${part.mimeType} data omitted]`;
}

function convertRole(role: vscode.LanguageModelChatMessageRole): 'system' | 'user' | 'assistant' {
  return match(role)
    .with(vscode.LanguageModelChatMessageRole.Assistant, () => 'assistant' as const)
    .with(vscode.LanguageModelChatMessageRole.User, () => 'user' as const)
    .otherwise(() => 'system' as const);
}
