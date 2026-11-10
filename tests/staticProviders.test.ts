import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageModelChatMessageRole, LanguageModelTextPart } from 'vscode';
import type * as vscode from 'vscode';
import { createGroqDescriptor } from '../src/providers/groq';
import { createNvidiaDescriptor } from '../src/providers/nvidia';
import { createXiaomiDescriptor } from '../src/providers/xiaomi';
import { createZaiDescriptor } from '../src/providers/zai';
import { authWithKey, jsonResponse, sseBody, token } from './helpers';

afterEach(() => vi.unstubAllGlobals());

/** Run one chat request and capture the outgoing HTTP request. */
async function captureChatRequest(
  descriptor: ReturnType<typeof createGroqDescriptor>,
  apiKey: string,
  modelIndex = 0,
): Promise<{ url: string; body: Record<string, unknown>; text: string }> {
  let url = '';
  let body: Record<string, unknown> = {};
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input instanceof Request ? input.url : input);
    body = JSON.parse(String(init?.body ?? (input instanceof Request ? await input.text() : '{}')));
    return new Response(sseBody([{ id: '1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }));
  const provider = descriptor.createProvider(authWithKey(apiKey));
  const models = await provider.provideLanguageModelChatInformation({ silent: true }, token());
  const model = models[modelIndex]!;
  let text = '';
  const progress = { report: (part: unknown) => { if (part instanceof LanguageModelTextPart) text += part.value; } };
  const messages = [{ role: LanguageModelChatMessageRole.User, content: [new LanguageModelTextPart('hi')], name: undefined }] as unknown as vscode.LanguageModelChatRequestMessage[];
  await provider.provideLanguageModelChatResponse(model, messages, {} as never, progress, token());
  return { url, body, text };
}

describe('static providers send requests to the right endpoint with the right defaults', () => {
  it('Groq: default temperature 1.0', async () => {
    const req = await captureChatRequest(createGroqDescriptor(), 'k');
    expect(req.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(req.body.temperature).toBe(1);
    expect(req.text).toBe('ok');
  });

  it('Z.ai: temperature 0.7', async () => {
    const req = await captureChatRequest(createZaiDescriptor(), 'k');
    expect(req.url).toBe('https://api.z.ai/api/coding/paas/v4/chat/completions');
    expect(req.body.temperature).toBe(0.7);
  });

  it('Xiaomi: token-plan keys use the token-plan gateway', async () => {
    expect((await captureChatRequest(createXiaomiDescriptor(), 'sk-1')).url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
    const tp = await captureChatRequest(createXiaomiDescriptor(), 'tp-1');
    expect(tp.url).toBe('https://token-plan-sgp.xiaomimimo.com/v1/chat/completions');
    expect(tp.body.temperature).toBe(0.7);
  });

  it('NVIDIA: maps short ids to namespaced NIM ids', async () => {
    const provider = createNvidiaDescriptor().createProvider(authWithKey('k'));
    const models = await provider.provideLanguageModelChatInformation({ silent: true }, token());
    const kimi = models.findIndex((m) => m.id === 'kimi-k3');
    const req = await captureChatRequest(createNvidiaDescriptor(), 'k', kimi);
    expect(req.body.model).toBe('moonshotai/kimi-k3');
    expect(req.body.temperature).toBe(0.7);
  });
});

describe('static provider connection test and health', () => {
  it('reports success with the model count, then health is connected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { data: [1, 2, 3] })));
    const provider = createGroqDescriptor().createProvider(authWithKey('k'));
    expect(provider.health().status).toBe('not-configured');
    expect(await provider.testConnection()).toMatchObject({ ok: true, message: 'Connected', modelCount: 3 });
    expect(provider.health()).toMatchObject({ status: 'connected', detail: 'Last connection test passed' });
  });

  it('reports authentication failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, {})));
    const provider = createGroqDescriptor().createProvider(authWithKey('k'));
    expect(await provider.testConnection()).toMatchObject({ ok: false, message: 'Your API key was not accepted', httpStatus: 401 });
    expect(provider.health().status).toBe('error');
  });
});
