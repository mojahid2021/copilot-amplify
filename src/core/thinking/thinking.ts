/** Markdown used to show reasoning as a collapsible block in the answer. */
export const THINKING_BLOCK_OPEN = '<details><summary>Thinking</summary>\n\n';
export const THINKING_BLOCK_CLOSE = '\n\n</details>\n\n';

export interface ThinkingState {
  buffer: string;
  insideThinking: boolean;
}

// Pre-computed lowercased tag markers so we never recompute them per call.
const OPEN_TAGS_LOWER = ['<think>', '<thought>'];
const CLOSE_TAGS_LOWER = ['</think>', '</thought>'];

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
  return insideThinking ? `${segment}${THINKING_BLOCK_CLOSE}` : `${segment}${THINKING_BLOCK_OPEN}`;
}

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

    output += buffer.slice(0, -partialSuffixLength);
    buffer = buffer.slice(-partialSuffixLength);
    break;
  }

  return { output, state: { buffer, insideThinking } };
}
