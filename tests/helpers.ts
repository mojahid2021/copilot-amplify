import { CancellationTokenSource } from 'vscode';
import { BaseAuthManager } from '../src/core/auth/authManager';

/** In-memory SecretStorage. */
export function fakeSecrets(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: async (key: string) => store.get(key),
    store: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    onDidChange: () => ({ dispose: () => {} }),
  };
}

export function authWithKey(key?: string): BaseAuthManager {
  const secrets = fakeSecrets(key ? { 'test.apiKey': key } : {});
  return new BaseAuthManager(secrets as never, 'test.apiKey', 'Test');
}

export function token() {
  return new CancellationTokenSource().token;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function sseBody(events: object[]): ReadableStream<Uint8Array> {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(text).body!;
}
