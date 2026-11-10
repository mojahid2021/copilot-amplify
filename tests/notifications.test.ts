import { describe, expect, it } from 'vitest';
import { connectionSummary } from '../src/ui/notifications';

describe('connectionSummary', () => {
  it('reads as one sentence for success and failure', () => {
    expect(connectionSummary('Groq', { ok: true, message: 'Connected', latencyMs: 320, modelCount: 7 }))
      .toBe('Groq is connected (320 ms, 7 models).');
    expect(connectionSummary('Groq', { ok: false, message: 'Your API key was not accepted', httpStatus: 401 }))
      .toBe("Couldn't connect to Groq. Your API key was not accepted.");
  });
});
