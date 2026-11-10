import { describe, expect, it } from 'vitest';
import { processThinkingContent, type ThinkingState } from '../src/core/thinking/thinking';

function run(chunks: string[]): string {
  let state: ThinkingState = { buffer: '', insideThinking: false };
  let out = '';
  for (const c of chunks) {
    const r = processThinkingContent(c, state);
    out += r.output;
    state = r.state;
  }
  return out + state.buffer;
}

describe('processThinkingContent', () => {
  it('folds <think> blocks, even when the tag is split across chunks', () => {
    const out = run(['<thi', 'nk>plan</th', 'ink>answer']);
    expect(out).not.toContain('<think>');
    expect(out).toContain('<summary>Thinking</summary>');
    expect(out).toContain('plan');
    expect(out.endsWith('answer')).toBe(true);
  });

  it('leaves ordinary HTML <details> in answers untouched', () => {
    const html = '<details><summary>x</summary>y</details>';
    expect(run([html])).toBe(html);
  });
});
