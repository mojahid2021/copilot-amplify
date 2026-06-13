const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';
const THINK_OPEN_MARKDOWN = '<details><summary>Thinking</summary>\n\n';
const THINK_CLOSE_MARKDOWN = '\n\n</details>\n\n';

export interface ThinkingState {
  buffer: string;
  insideThinking: boolean;
}

function getPartialSuffixLength(buffer: string, marker: string): number {
  for (let i = Math.min(buffer.length, marker.length - 1); i > 0; i--) {
    if (buffer.endsWith(marker.slice(0, i))) {
      return i;
    }
  }
  return 0;
}

function appendThinkingSegment(segment: string, insideThinking: boolean): string {
  return insideThinking ? `${segment}${THINK_CLOSE_MARKDOWN}` : `${segment}${THINK_OPEN_MARKDOWN}`;
}

export function processThinkingContent(content: string, state: ThinkingState): { output: string; state: ThinkingState } {
  if (
    !state.insideThinking
    && state.buffer.length === 0
    && !content.includes(THINK_OPEN)
    && !content.includes(THINK_CLOSE)
  ) {
    return { output: content, state };
  }

  let output = '';
  let buffer = state.buffer + content;
  let insideThinking = state.insideThinking;

  while (buffer.length > 0) {
    const marker = insideThinking ? THINK_CLOSE : THINK_OPEN;
    const markerIndex = buffer.indexOf(marker);
    if (markerIndex >= 0) {
      output += appendThinkingSegment(buffer.slice(0, markerIndex), insideThinking);
      buffer = buffer.slice(markerIndex + marker.length);
      insideThinking = !insideThinking;
      continue;
    }

    const partialSuffixLength = getPartialSuffixLength(buffer, marker);
    if (partialSuffixLength === 0) {
      output += buffer;
      buffer = '';
      continue;
    }

    output += buffer.slice(0, -partialSuffixLength);
    buffer = buffer.slice(-partialSuffixLength);
  }

  return { output, state: { buffer, insideThinking } };
}
