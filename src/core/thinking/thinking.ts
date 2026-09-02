const THINK_OPEN_MARKDOWN = '<details><summary>Thinking</summary>\n\n';
const THINK_CLOSE_MARKDOWN = '\n\n</details>\n\n';

export interface ThinkingState {
  buffer: string;
  insideThinking: boolean;
}

function findFirstTagIndex(buffer: string, isClosing: boolean): { index: number; tagLength: number } {
  const lower = buffer.toLowerCase();
  const tags = isClosing ? ['</think>', '</thought>'] : ['<think>', '<thought>'];
  let bestIndex = -1;
  let bestTagLength = 0;

  for (const tag of tags) {
    const idx = lower.indexOf(tag);
    if (idx >= 0 && (bestIndex === -1 || idx < bestIndex)) {
      bestIndex = idx;
      bestTagLength = tag.length;
    }
  }

  return { index: bestIndex, tagLength: bestTagLength };
}

function getPartialSuffixLength(buffer: string, isClosing: boolean): number {
  const lower = buffer.toLowerCase();
  const tags = isClosing ? ['</think>', '</thought>'] : ['<think>', '<thought>'];
  let maxMatch = 0;

  for (const tag of tags) {
    const maxCheck = Math.min(lower.length, tag.length - 1);
    for (let i = maxCheck; i > 0; i--) {
      if (tag.startsWith(lower.slice(-i))) {
        maxMatch = Math.max(maxMatch, i);
        break;
      }
    }
  }

  return maxMatch;
}

function appendThinkingSegment(segment: string, insideThinking: boolean): string {
  return insideThinking ? `${segment}${THINK_CLOSE_MARKDOWN}` : `${segment}${THINK_OPEN_MARKDOWN}`;
}

// Maximum length of any supported thinking tag (</thought> = 10 chars).
// If the partial buffer grows beyond this, it can't be a valid tag prefix — flush it.
const MAX_TAG_LENGTH = 10;

/**
 * Hard cap on the partial-tag buffer. A misbehaving model that emits a
 * `<think>` (or `<thought>`) tag but never closes it would otherwise grow
 * `state.buffer` for the entire response. Once the buffer reaches this cap
 * we flush it as regular content so the loop terminates.
 */
const MAX_PARTIAL_BUFFER_CHARS = 4096;

export function processThinkingContent(content: string, state: ThinkingState): { output: string; state: ThinkingState } {
  if (
    !state.insideThinking
    && state.buffer.length === 0
    && !content.includes('<')
  ) {
    return { output: content, state };
  }

  let output = '';
  let buffer = state.buffer + content;
  let insideThinking = state.insideThinking;

  while (buffer.length > 0) {
    const { index: markerIndex, tagLength } = findFirstTagIndex(buffer, insideThinking);
    if (markerIndex >= 0) {
      output += appendThinkingSegment(buffer.slice(0, markerIndex), insideThinking);
      buffer = buffer.slice(markerIndex + tagLength);
      insideThinking = !insideThinking;
      continue;
    }

    const partialSuffixLength = getPartialSuffixLength(buffer, insideThinking);
    if (partialSuffixLength === 0) {
      output += buffer;
      buffer = '';
      continue;
    }

    // Safety: if the buffered partial match exceeds the maximum tag length,
    // it can't be a valid tag — flush the entire buffer as regular content.
    if (partialSuffixLength >= MAX_TAG_LENGTH) {
      output += buffer;
      buffer = '';
      continue;
    }

    // Hard cap: a model that opens <think>/<thought> and never closes it
    // would otherwise keep accumulating here. Flush as content and reset.
    if (buffer.length > MAX_PARTIAL_BUFFER_CHARS) {
      output += buffer;
      buffer = '';
      continue;
    }

    output += buffer.slice(0, -partialSuffixLength);
    buffer = buffer.slice(-partialSuffixLength);
    break;
  }

  return { output, state: { buffer, insideThinking } };
}
