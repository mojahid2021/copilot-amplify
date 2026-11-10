import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentrouterChatProvider } from '../src/providers/agentrouter/provider';
import { OmnirouteChatProvider } from '../src/providers/omniroute/provider';
import { authWithKey, jsonResponse, token } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const pricing = {
  data: [
    { model_name: 'claude-sonnet-x', supported_endpoint_types: ['anthropic'] },
    { model_name: 'gpt-x', supported_endpoint_types: ['openai'] },
  ],
};

describe('AgentrouterChatProvider discovery + health', () => {
  it('reports "Not loaded" before discovery and never fetches from provideLanguageModelChatInformation', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const provider = new AgentrouterChatProvider(authWithKey('k'));

    expect(provider.health()).toMatchObject({ configured: true, status: 'not-configured', detail: 'Not loaded' });
    expect(await provider.provideLanguageModelChatInformation({ silent: true }, token())).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips discovery entirely without an API key', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const provider = new AgentrouterChatProvider(authWithKey());
    expect(await provider.loadModels()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads models, reports them as connected and serves them from the cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, pricing)));
    const provider = new AgentrouterChatProvider(authWithKey('k'));
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
    const provider = new AgentrouterChatProvider(authWithKey('k'));

    expect(await provider.loadModels()).toEqual([]);
    expect(provider.health().status).toBe('auth-failed');
  });

  it('refreshCaches forgets loaded models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, pricing)));
    const provider = new AgentrouterChatProvider(authWithKey('k'));
    await provider.loadModels();
    provider.refreshCaches();
    expect(provider.health().detail).toBe('Not loaded');
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
