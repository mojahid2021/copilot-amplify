import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { prepareContextMessages } from '../src/core/context/contextManager';
import { parseToolArguments } from '../src/core/context/converter';

const msg = (role: number, content: unknown[]) => ({ role, content, name: undefined }) as unknown as vscode.LanguageModelChatRequestMessage;

describe('prepareContextMessages', () => {
  it('keeps a valid tool-call pair when the newest turn is a huge tool result', () => {
    const big = 'x'.repeat(20_000);
    const messages = [
      msg(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('read the file')]),
      msg(vscode.LanguageModelChatMessageRole.Assistant, [new vscode.LanguageModelToolCallPart('c1', 'read', {})]),
      msg(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelToolResultPart('c1', [new vscode.LanguageModelTextPart(big)])]),
    ];
    const out = prepareContextMessages(messages, false, { maxInputTokens: 2048, reserveOutputTokens: 512 });

    const assistant = out.find((m) => m.role === 'assistant');
    const tool = out.find((m) => m.role === 'tool');
    expect(assistant?.tool_calls?.[0]?.id).toBe('c1');
    expect(tool?.tool_call_id).toBe('c1');
    expect((tool?.content as string).length).toBeLessThan(big.length);
  });
});

describe('parseToolArguments', () => {
  it('rejects prototype-pollution payloads instead of falling back to JSON.parse', () => {
    expect(parseToolArguments('{"__proto__":{"polluted":true}}')).toEqual({});
  });
  it('parses fenced JSON', () => {
    expect(parseToolArguments('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});
