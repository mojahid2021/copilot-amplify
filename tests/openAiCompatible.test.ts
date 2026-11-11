import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageModelChatMessageRole, LanguageModelTextPart } from 'vscode';
import type * as vscode from 'vscode';
import { GLM_MODELS, GROQ_MODELS } from '../src/core/models/catalog';
import { createGroqDescriptor } from '../src/providers/groq';
import { createXiaomiDescriptor } from '../src/providers/xiaomi';
import { createZaiDescriptor } from '../src/providers/zai';
import { authWithKey, fakeMemento, jsonResponse, sseBody, token } from './helpers';

afterEach(() => vi.unstubAllGlobals());

type Descriptor = ReturnType<typeof createGroqDescriptor>;
type Sent = { url: string; body: Record<string, unknown> };

/** Fake server: `GET …/models` answers with `models`, chat requests stream "ok". Records every request. */
function stubServer(models: Response | (() => Response)): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    if (url.endsWith('/models')) {
      return typeof models === 'function' ? models() : models.clone();
    }
    return new Response(sseBody([{ id: '1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }]), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }));
  return sent;
}

async function chat(provider: ReturnType<Descriptor['createProvider']>, model: vscode.LanguageModelChatInformation): Promise<void> {
  const messages = [{ role: LanguageModelChatMessageRole.User, content: [new LanguageModelTextPart('hi')], name: undefined }] as never;
  await provider.provideLanguageModelChatResponse(model, messages, {} as never, { report: () => {} }, token());
}

describe('model lists from GET /models', () => {
  it('Groq: shows nothing until loaded, then merges the list with known details', async () => {
    const sent = stubServer(jsonResponse(200, {
      object: 'list',
      data: [
        { id: 'llama-3.3-70b-versatile', active: true, context_window: 131_072 },
        { id: 'openai/gpt-oss-120b', active: true, context_window: 131_072 },
        { id: 'qwen/qwen3.8-27b', active: true, context_window: 131_072, max_completion_tokens: 40_960 },
        { id: 'whisper-large-v3', active: true },
        { id: 'meta-llama/llama-prompt-guard-2-22m', active: true },
        { id: 'old-model', active: false },
      ],
    }));
    const provider = createGroqDescriptor().createProvider(authWithKey('k'), fakeMemento());

    expect(await provider.provideLanguageModelChatInformation({ silent: true }, token())).toEqual([]);
    expect(sent).toEqual([]);

    const models = await provider.loadModels();
    expect(sent[0]?.url).toBe('https://api.groq.com/openai/v1/models');
    // Known models first (their catalog details), `/` encoded for the picker, non-chat and inactive ones dropped.
    expect(models.map((m) => m.id)).toEqual(['llama-3.3-70b-versatile', 'openai__gpt-oss-120b', 'qwen__qwen3.8-27b']);
    expect(models[0]).toEqual(GROQ_MODELS.find((m) => m.id === 'llama-3.3-70b-versatile'));
    expect(models[2]).toMatchObject({ name: 'Qwen3.8 27b', maxInputTokens: 131_072, maxOutputTokens: 40_960, capabilities: { toolCalling: true } });
    expect(provider.health()).toMatchObject({ status: 'connected', detail: '3 models' });

    await chat(provider, models[1]!);
    expect(sent.at(-1)).toMatchObject({ url: 'https://api.groq.com/openai/v1/chat/completions', body: { model: 'openai/gpt-oss-120b', temperature: 1 } });
  });

  it('Z.ai: without a list endpoint, the known models are used', async () => {
    const sent = stubServer(jsonResponse(404, { error: { message: 'Not Found' } }));
    const provider = createZaiDescriptor().createProvider(authWithKey('k'), fakeMemento());

    const models = await provider.loadModels();
    expect(models.map((m) => m.id)).toEqual(GLM_MODELS.map((m) => m.id));
    expect(provider.health().status).toBe('connected');

    await chat(provider, models[0]!);
    expect(sent.at(-1)).toMatchObject({
      url: 'https://api.z.ai/api/coding/paas/v4/chat/completions',
      body: { temperature: 0.7, thinking: { type: 'enabled' } },
    });
  });

  it('Xiaomi: token-plan keys use the token-plan gateway for listing and chat', async () => {
    const sent = stubServer(jsonResponse(200, { data: [{ id: 'mimo-v2.5-pro' }, { id: 'mimo-v2.5-tts' }] }));
    const provider = createXiaomiDescriptor().createProvider(authWithKey('tp-1'), fakeMemento());

    const models = await provider.loadModels();
    expect(models.map((m) => m.id)).toEqual(['mimo-v2.5-pro']);
    await chat(provider, models[0]!);
    expect(sent.map((s) => s.url)).toEqual([
      'https://token-plan-sgp.xiaomimimo.com/v1/models',
      'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
    ]);
  });

  it('keeps the previous list and reports the problem when loading fails', async () => {
    stubServer(() => jsonResponse(500, { error: { message: 'boom' } }));
    const provider = createGroqDescriptor().createProvider(authWithKey('k'), fakeMemento());
    expect(await provider.loadModels()).toEqual([]);
    expect(provider.health()).toMatchObject({ status: 'error' });
  });
});

describe('model lists survive a restart', () => {
  it('restores the saved list without a request, and Refresh forgets it', async () => {
    const state = fakeMemento();
    stubServer(jsonResponse(200, { data: [{ id: 'llama-3.3-70b-versatile' }] }));
    await createGroqDescriptor().createProvider(authWithKey('k'), state).loadModels();

    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const afterRestart = createGroqDescriptor().createProvider(authWithKey('k'), state);
    expect((await afterRestart.provideLanguageModelChatInformation({ silent: true }, token())).map((m) => m.id)).toEqual(['llama-3.3-70b-versatile']);
    expect(afterRestart.health()).toMatchObject({ status: 'not-configured', detail: '1 model' });
    expect(fetch).not.toHaveBeenCalled();

    afterRestart.refreshCaches();
    expect(await afterRestart.listModelsForTree()).toEqual([]);
    expect(state.get('models.groq')).toBeUndefined();
  });
});

describe('connection test', () => {
  it('sends a one-token chat request, which checks the key', async () => {
    const sent = stubServer(jsonResponse(200, { data: [] }));
    const provider = createGroqDescriptor().createProvider(authWithKey('k'), fakeMemento());
    expect(await provider.testConnection()).toMatchObject({ ok: true, message: 'Connected' });
    expect(sent[0]).toMatchObject({ url: 'https://api.groq.com/openai/v1/chat/completions', body: { max_tokens: 1 } });
  });

  it('reports a rejected key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: { message: 'invalid key' } })));
    const provider = createGroqDescriptor().createProvider(authWithKey('k'), fakeMemento());
    expect(await provider.testConnection()).toMatchObject({ ok: false, message: 'Your API key was not accepted', httpStatus: 401 });
  });
});
