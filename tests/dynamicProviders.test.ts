import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentrouterChatProvider } from '../src/providers/agentrouter/provider';
import { OmnirouteChatProvider } from '../src/providers/omniroute/provider';
import { LanguageModelTextPart } from 'vscode';
import { createNvidiaDescriptor } from '../src/providers/nvidia';
import { authWithKey, fakeMemento, jsonResponse, sseBody, token } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const pricing = {
  data: [
    { model_name: 'claude-sonnet-x', supported_endpoint_types: ['anthropic'] },
    { model_name: 'gpt-x', supported_endpoint_types: ['openai'] },
  ],
};

describe('AgentrouterChatProvider discovery + health', () => {
  it('reports "Models not loaded" before discovery and never fetches from provideLanguageModelChatInformation', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const provider = new AgentrouterChatProvider(authWithKey('k'), fakeMemento());

    expect(provider.health()).toMatchObject({ configured: true, status: 'not-configured', detail: 'Models not loaded' });
    expect(await provider.provideLanguageModelChatInformation({ silent: true }, token())).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips discovery entirely without an API key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const provider = new AgentrouterChatProvider(authWithKey(), fakeMemento());
    expect(await provider.loadModels()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads models, reports them as connected and serves them from the cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, pricing)));
    const provider = new AgentrouterChatProvider(authWithKey('k'), fakeMemento());
    const changed = vi.fn();
    provider.onDidChangeLanguageModelChatInformation(changed);

    await provider.loadModels();

    expect(provider.health()).toMatchObject({ status: 'connected', detail: '2 models' });
    expect(changed).toHaveBeenCalledTimes(1);
    const models = await provider.provideLanguageModelChatInformation({ silent: true }, token());
    expect(models.map((m) => m.id).sort()).toEqual(['claude-sonnet-x', 'gpt-x']);
    const tree = await provider.listModelsForTree();
    expect(tree.find((m) => m.id === 'claude-sonnet-x')?.supportsReasoning).toBe(true);
    expect(tree.find((m) => m.id === 'gpt-x')?.supportsReasoning).toBe(false);
  });

  it('maps a 401 discovery failure to auth-failed and keeps serving the stale list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: { message: 'bad key' } })));
    const provider = new AgentrouterChatProvider(authWithKey('k'), fakeMemento());

    expect(await provider.loadModels()).toEqual([]);
    expect(provider.health().status).toBe('auth-failed');
  });

  it('refreshCaches forgets loaded models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, pricing)));
    const provider = new AgentrouterChatProvider(authWithKey('k'), fakeMemento());
    await provider.loadModels();
    provider.refreshCaches();
    expect(provider.health().detail).toBe('Models not loaded');
    expect(await provider.listModelsForTree()).toEqual([]);
  });
});

describe('OmnirouteChatProvider health', () => {
  it('requires a server URL before anything else', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const provider = new OmnirouteChatProvider(authWithKey());
    expect(provider.health()).toMatchObject({ configured: false, status: 'setup-required' });
    expect(await provider.loadModels()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('NVIDIA NIM', () => {
  const nimList = {
    object: 'list',
    data: [
      { id: 'moonshotai/kimi-k3', object: 'model', owned_by: 'moonshotai' },
      { id: 'stepfun-ai/step-5-preview', object: 'model', owned_by: 'stepfun-ai' },
      { id: 'nvidia/nv-embedqa-mistral-7b-v2', object: 'model', owned_by: 'nvidia' },
      { id: 'meta/llama-guard-4-12b', object: 'model', owned_by: 'meta' },
    ],
  };

  it('shows nothing until Load Models, then only the chat models NVIDIA lists', async () => {
    const fetch = vi.fn(async () => jsonResponse(200, nimList));
    vi.stubGlobal('fetch', fetch);
    const provider = createNvidiaDescriptor().createProvider(authWithKey('k'), fakeMemento());

    expect(await provider.provideLanguageModelChatInformation({ silent: true }, token())).toEqual([]);
    expect(provider.health().detail).toBe('Models not loaded');
    expect(fetch).not.toHaveBeenCalled();

    const models = await provider.loadModels();
    expect(fetch).toHaveBeenCalledWith('https://integrate.api.nvidia.com/v1/models', expect.anything());
    // `/` is encoded for the picker; known models keep their catalog details.
    expect(models.map((m) => m.id)).toEqual(['moonshotai__kimi-k3', 'stepfun-ai__step-5-preview']);
    expect(models[0]?.name).toBe('Kimi K3');
    expect(models[1]).toMatchObject({ name: 'Step 5 Preview', maxInputTokens: 32_768, capabilities: { toolCalling: true, imageInput: false } });

    const tree = await provider.listModelsForTree();
    expect(tree.map((m) => [m.id, m.supportsReasoning])).toEqual([['moonshotai/kimi-k3', true], ['stepfun-ai/step-5-preview', false]]);
    expect(provider.health()).toMatchObject({ status: 'connected', detail: '2 models' });
  });

  it('sends the real NVIDIA id and the thinking field when chatting', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, nimList)));
    const provider = createNvidiaDescriptor().createProvider(authWithKey('k'), fakeMemento());
    const [kimi] = await provider.loadModels();

    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(sseBody([{ id: '1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }]), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }));
    const messages = [{ role: 1, content: [new LanguageModelTextPart('hi')], name: undefined }] as never;
    await provider.provideLanguageModelChatResponse(kimi!, messages, {} as never, { report: () => {} }, token());

    expect(body).toMatchObject({ model: 'moonshotai/kimi-k3', temperature: 0.7, thinking: { type: 'enabled' } });
  });

  it('does not load without an API key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await createNvidiaDescriptor().createProvider(authWithKey(), fakeMemento()).loadModels()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
