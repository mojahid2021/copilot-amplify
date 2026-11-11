import { describe, expect, it } from 'vitest';
import { createProviderRegistry } from '../src/providers';
import { ProvidersTreeDataProvider, type ProviderTreeItem } from '../src/ui/treeProvider';
import { fakeMemento, fakeSecrets } from './helpers';

function treeWith(secrets: Record<string, string>) {
  return new ProvidersTreeDataProvider(createProviderRegistry(fakeSecrets(secrets) as never, fakeMemento()));
}

describe('providers tree', () => {
  it('lists providers at the top level with plain-language status', async () => {
    const rows = (await treeWith({ 'copilot-amplify.CA-groq.apiKey': 'k' }).getChildren()) as ProviderTreeItem[];
    const row = (id: string) => rows.find((r) => r.providerId === id);

    expect(row('groq')).toMatchObject({ label: 'Groq', description: 'Ready · Models not loaded' });
    expect(row('glm')?.description).toBe('API key needed');
    expect(row('omniroute')?.description).toBe('Server URL needed');
    expect(row('agentrouter')?.description).toBe('API key needed');
  });

  it('shows a clickable next step instead of an empty provider', async () => {
    const tree = treeWith({});
    const rows = (await tree.getChildren()) as ProviderTreeItem[];
    const [hint] = await tree.getChildren(rows.find((r) => r.providerId === 'agentrouter'));

    expect(hint).toMatchObject({ label: 'Add an API key to get started', contextValue: 'hint' });
    expect(hint?.command?.command).toBe('copilot-amplify.setApiKey');
  });
});
