/**
 * Shared Server-Sent Events parser.
 *
 * Handles every real-world quirk providers exhibit:
 * - frames fragmented across chunk boundaries
 * - multiple events per network chunk
 * - CRLF and LF line endings
 * - comment / keep-alive lines (`:` prefixed)
 * - `data:` payload extraction with `[DONE]` termination
 * - malformed JSON frames skipped without killing the stream
 * - trailing frame without a final newline flushed at EOF
 *
 * Yields parsed JSON objects; terminates on `[DONE]` or stream end.
 */
export interface SseEvent {
  data: string;
}

/** Incremental line-buffering SSE reader over raw byte chunks. */
export class SseParser {
  private buffer = '';
  private readonly decoder = new TextDecoder();

  /**
   * Feed one raw chunk; returns the complete events it completed.
   * Call `flush()` after the stream ends to retrieve a trailing frame.
   */
  push(chunk: Uint8Array): SseEvent[] {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    return this.drainLines();
  }

  /** Decode any bytes still buffered and flush a trailing unterminated frame. */
  flush(): SseEvent[] {
    this.buffer += this.decoder.decode();
    const events = this.drainLines();
    const remaining = this.buffer.trimEnd();
    this.buffer = '';
    if (remaining.startsWith('data:')) {
      const data = remaining.slice(5).trim();
      if (data) {
        events.push({ data });
      }
    }
    return events;
  }

  private drainLines(): SseEvent[] {
    const events: SseEvent[] = [];
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const event = this.parseLine(line);
      if (event) {
        events.push(event);
      }
    }
    return events;
  }

  private parseLine(line: string): SseEvent | undefined {
    if (!line.startsWith('data:')) {
      return undefined; // comments (`:` …), event/id/retry fields, blank lines
    }
    const data = line.slice(5).trim();
    if (!data) {
      return undefined;
    }
    return { data };
  }
}

export type SsePayload = Record<string, unknown>;

/** Parse one SSE data payload into JSON, returning undefined for `[DONE]` or malformed frames. */
export function parseSseData(event: SseEvent): { done: boolean; payload?: SsePayload } {
  if (event.data === '[DONE]') {
    return { done: true };
  }
  try {
    const parsed = JSON.parse(event.data) as unknown;
    if (parsed && typeof parsed === 'object') {
      return { done: false, payload: parsed as SsePayload };
    }
    return { done: false };
  } catch {
    return { done: false }; // keep-alive / malformed frame — skip
  }
}

/**
 * Convenience generator: consume a `ReadableStream` of bytes as parsed SSE
 * JSON payloads. Terminates on `[DONE]`.
 */
export async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SsePayload> {
  const reader = body.getReader();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      for (const event of parser.push(value)) {
        const parsed = parseSseData(event);
        if (parsed.done) {
          return;
        }
        if (parsed.payload) {
          yield parsed.payload;
        }
      }
    }
    for (const event of parser.flush()) {
      const parsed = parseSseData(event);
      if (parsed.done) {
        return;
      }
      if (parsed.payload) {
        yield parsed.payload;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
