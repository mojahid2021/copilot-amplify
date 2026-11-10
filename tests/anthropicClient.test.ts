import { describe, expect, it } from 'vitest';
import { AnthropicApiClient } from '../src/core/api/anthropicClient';
import { sseBody } from './helpers';

async function collect(events: object[]) {
  const client = new AnthropicApiClient('k', 'https://x.test', 'Test');
  const out = [];
  for await (const chunk of client.streamChunks(sseBody(events), 'claude-x')) {
    out.push(chunk.choices[0]);
  }
  return out;
}

describe('AnthropicApiClient.streamChunks', () => {
  it('converts text, thinking and tool-use events into OpenAI-shaped deltas', async () => {
    const choices = await collect([
      { type: 'message_start' },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hi' } },
      { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 't1', name: 'read' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '1}' } },
      { type: 'ping' },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      { type: 'message_stop' },
    ]);

    expect(choices).toEqual([
      { index: 0, delta: { reasoning_content: 'hmm' }, finish_reason: null },
      { index: 0, delta: { content: 'Hi' }, finish_reason: null },
      {
        index: 0,
        delta: { tool_calls: [{ index: 0, id: 't1', type: 'function', function: { name: 'read', arguments: '' } }] },
        finish_reason: null,
      },
      { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] }, finish_reason: null },
      { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, finish_reason: null },
      { index: 0, delta: {}, finish_reason: 'tool_calls' },
      { index: 0, delta: {}, finish_reason: 'stop' },
    ]);
  });

  it('maps end_turn to stop and throws on stream error events', async () => {
    expect(await collect([{ type: 'message_delta', delta: { stop_reason: 'end_turn' } }])).toEqual([
      { index: 0, delta: {}, finish_reason: 'stop' },
    ]);
    await expect(collect([{ type: 'error', error: { message: 'overloaded' } }])).rejects.toThrow('Test API error: overloaded');
  });
});
