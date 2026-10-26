const THINK_OPEN_MARKDOWN = '<details><summary>Thinking</summary>\n\n';
const THINK_CLOSE_MARKDOWN = '\n\n</details>\n\n';

export interface ThinkingState {
  buffer: string;
  insideThinking: boolean;
}

// Pre-computed lowercased tag markers so we never recompute them per call.
const OPEN_TAGS_LOWER = ['<details>', '<thought>'].map((t) => t.toLowerCase());
const CLOSE_TAGS_LOWER = ['</details>', '</thought>'].map((t) => t.toLowerCase());

/**
 * Find the earliest opening tag match in `lower` (already lowercased).
 * Returns { index, tagLength } or { index: -1, tagLength: 0 } when none found.
 */
function findFirstTagIndex(lower: string, tagsLower: string[]): { index: number; tagLength: number } {
  let bestIndex = -1;
  let bestTagLength = 0;
  for (let i = 0; i < tagsLower.length; i++) {
    const tag = tagsLower[i];
    if (!tag) continue;
    const idx = lower.indexOf(tag);
    if (idx >= 0 && (bestIndex === -1 || idx < bestIndex)) {
      bestIndex = idx;
      bestTagLength = tag.length;
    }
  }
  return { index: bestIndex, tagLength: bestTagLength };
}

/**
 * Find the longest suffix of `lower` that is a prefix of any tag.
 * `lower` must already be lowercased.
 */
function getPartialSuffixLength(lower: string, tagsLower: string[]): number {
  let maxMatch = 0;
  const bufLen = lower.length;
  for (let i = 0; i < tagsLower.length; i++) {
    const tag = tagsLower[i];
    if (!tag) continue;
    const maxCheck = Math.min(bufLen, tag.length - 1);
    // Walk suffixes longest-first; first match wins for this tag.
    for (let s = maxCheck; s > 0; s--) {
      if (tag.startsWith(lower.slice(bufLen - s))) {
        maxMatch = Math.max(maxMatch, s);
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
    // Lowercase once per buffer iteration instead of per tag check.
    const lower = buffer.toLowerCase();
    const tagsLower = insideThinking ? CLOSE_TAGS_LOWER : OPEN_TAGS_LOWER;
    const { index: markerIndex, tagLength } = findFirstTagIndex(lower, tagsLower);
    if (markerIndex >= 0) {
      output += appendThinkingSegment(buffer.slice(0, markerIndex), insideThinking);
      buffer = buffer.slice(markerIndex + tagLength);
      insideThinking = !insideThinking;
      continue;
    }

    const partialSuffixLength = getPartialSuffixLength(lower, tagsLower);
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
