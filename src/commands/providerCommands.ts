import * as vscode from 'vscode';
import type { ProviderId, ProviderRegistry } from '../core/provider/registry';
import { buildAmplifyDiagnostics, showTextReport } from '../core/diagnostics';
import type { ProvidersTreeDataProvider, ProviderTreeItem, ModelTreeItem } from '../ui/treeProvider';
import { isOmnirouteBaseUrlConfigured } from '../providers/omniroute/config';
import { qualityIcon } from '../ui/networkQuality';
import { asSentence, connectionSummary, isAuthFailure } from '../ui/notifications';

/** Commands that work for every provider (API keys, testing, model selection, reports). */

export interface ProviderCommandDeps {
  registry: ProviderRegistry;
  tree: ProvidersTreeDataProvider;
  statusBarItem: vscode.StatusBarItem;
  updateNetQualityBar: () => void;
}

type ProviderAction = 'setApiKey' | 'test' | 'clearApiKey';
type MenuEntry = vscode.QuickPickItem & { command?: string; providerAction?: ProviderAction };

const separator = (label: string): MenuEntry => ({ label, kind: vscode.QuickPickItemKind.Separator });

/** The "Manage Providers" menu: either run a command, or pick a provider first. */
const MANAGE_MENU: MenuEntry[] = [
  separator('Providers'),
  { label: '$(key) Set API Key…', detail: 'Add or replace the key for a provider', providerAction: 'setApiKey' },
  { label: '$(plug) Test Connection', detail: 'Check that a provider is reachable and the key works', providerAction: 'test' },
  { label: '$(trash) Remove API Key', detail: 'Delete a saved key from your keychain', providerAction: 'clearApiKey' },
  { label: '$(refresh) Refresh Providers and Models', detail: 'Reload every provider\'s model list', command: 'copilot-amplify.refresh' },
  separator('OmniRoute'),
  { label: '$(settings-gear) Set Up OmniRoute…', detail: 'Server URL, API key and a connection test', command: 'copilot-amplify.CA-omniroute.configure' },
  { label: '$(link) Change Server URL…', command: 'copilot-amplify.CA-omniroute.editBaseUrl' },
  { label: '$(output) Show Request Log', command: 'copilot-amplify.CA-omniroute.showTelemetry' },
  separator('Troubleshooting'),
  { label: '$(pulse) Show Diagnostics', detail: 'Status, keys and errors for every provider', command: 'copilot-amplify.showDiagnostics' },
  { label: '$(dashboard) Show Network Quality', detail: 'Response time and error rate per provider', command: 'copilot-amplify.showNetworkQuality' },
];

const ACTION_VERBS: Record<ProviderAction, string> = {
  setApiKey: 'set an API key for',
  test: 'test',
  clearApiKey: 'remove the API key from',
};

export function registerProviderCommands(context: vscode.ExtensionContext, deps: ProviderCommandDeps): void {
  const { registry, tree, statusBarItem, updateNetQualityBar } = deps;

  const displayName = (id: ProviderId) => registry.get(id)?.displayName ?? id;

  /** The provider id from a tree item, or ask the user to pick one. */
  async function resolveProviderId(item?: { providerId?: string }, placeHolder?: string): Promise<ProviderId | undefined> {
    const id = item?.providerId ?? (await pickProviderId(registry, placeHolder));
    return id && registry.has(id) ? id : undefined;
  }

  /**
   * True when the provider can be used right now. Otherwise offers to fix
   * the missing setup: the server URL for OmniRoute, an API key for the rest.
   */
  async function ensureReady(id: ProviderId): Promise<boolean> {
    if (id === 'omniroute') {
      if (isOmnirouteBaseUrlConfigured()) {
        return true;
      }
      const choice = await vscode.window.showInformationMessage('Set your OmniRoute server URL first.', 'Set Server URL');
      if (choice) {
        await vscode.commands.executeCommand('copilot-amplify.CA-omniroute.editBaseUrl');
        tree.refresh();
      }
      return false;
    }

    const auth = registry.auth(id);
    if (await auth.getApiKey()) {
      return true;
    }
    const choice = await vscode.window.showInformationMessage(`Add your ${displayName(id)} API key first.`, 'Set API Key');
    if (choice) {
      await auth.promptForApiKey();
      tree.refresh();
    }
    return false;
  }

  async function testConnection(id: ProviderId): Promise<void> {
    if (!(await ensureReady(id))) {
      return;
    }
    const name = displayName(id);
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Testing ${name}…` },
        () => registry.provider(id).testConnection(),
      );
      tree.refresh();
      if (result.ok) {
        void vscode.window.showInformationMessage(connectionSummary(name, result));
        return;
      }
      if (isAuthFailure(result)) {
        if (await vscode.window.showErrorMessage(connectionSummary(name, result), 'Update API Key')) {
          await setApiKey({ providerId: id });
        }
        return;
      }
      void vscode.window.showErrorMessage(connectionSummary(name, result));
    } catch (error) {
      void vscode.window.showErrorMessage(`Couldn't test ${name}. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function setApiKey(item?: { providerId?: string }): Promise<void> {
    const id = await resolveProviderId(item, 'Choose a provider to set an API key for');
    if (id) {
      await registry.auth(id).promptForApiKey();
      tree.refresh();
    }
  }

  async function clearApiKey(item?: { providerId?: string }): Promise<void> {
    const id = await resolveProviderId(item, 'Choose a provider to remove the API key from');
    if (!id) {
      return;
    }
    const name = displayName(id);
    const confirm = await vscode.window.showWarningMessage(
      `Remove the saved ${name} API key?`,
      { modal: true, detail: `${name} models stop working until you add a key again.` },
      'Remove',
    );
    if (confirm !== 'Remove') {
      return;
    }
    await registry.auth(id).deleteApiKey();
    registry.provider(id).refreshCaches();
    tree.refresh();
    void vscode.window.showInformationMessage(`${name} API key removed.`);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-amplify.manage', async () => {
      const choice = await vscode.window.showQuickPick(MANAGE_MENU, {
        title: 'Copilot Amplify',
        placeHolder: 'What would you like to do?',
      });
      if (choice?.command) {
        await vscode.commands.executeCommand(choice.command);
        return;
      }
      if (!choice?.providerAction) {
        return;
      }
      const id = await resolveProviderId(undefined, `Choose a provider to ${ACTION_VERBS[choice.providerAction]}`);
      if (!id) {
        return;
      }
      const actions: Record<ProviderAction, () => Promise<void>> = {
        setApiKey: () => setApiKey({ providerId: id }),
        test: () => testConnection(id),
        clearApiKey: () => clearApiKey({ providerId: id }),
      };
      await actions[choice.providerAction]();
    }),

    vscode.commands.registerCommand('copilot-amplify.refresh', () => {
      for (const descriptor of registry.list()) {
        const provider = registry.provider(descriptor.id);
        provider.refreshCaches();
        // Refetch right away on an explicit refresh; failures show up in health().
        void provider.loadModels().then(() => tree.refresh());
      }
      tree.refresh();
    }),

    vscode.commands.registerCommand('copilot-amplify.loadModels', async (item?: ProviderTreeItem) => {
      const id = item?.providerId;
      if (!id || !registry.has(id)) {
        return;
      }
      const provider = registry.provider(id);
      if (!(await ensureReady(id))) {
        return;
      }
      const name = displayName(id);
      const models = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Loading ${name} models…` },
        () => provider.loadModels(),
      );
      tree.refresh();
      // A failed load keeps the previous list, so check health rather than the count.
      const health = provider.health();
      const failed = models.length === 0 || health.status === 'error' || health.status === 'auth-failed';
      if (failed) {
        const reason = health.detail && health.status !== 'not-configured' ? ` ${asSentence(health.detail)}` : '';
        void vscode.window.showWarningMessage(`No ${name} models were loaded.${reason}`);
      } else {
        void vscode.window.showInformationMessage(`Loaded ${models.length} ${name} models.`);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.showDiagnostics', async () => {
      const report = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Collecting diagnostics…' },
        () => buildAmplifyDiagnostics(registry),
      );
      await showTextReport(report);
    }),

    // Clicking a provider row: set it up if needed, otherwise test it.
    vscode.commands.registerCommand('copilot-amplify.provider.click', async (item: ProviderTreeItem) => {
      const id = item?.providerId;
      if (!id || !registry.has(id)) {
        return;
      }
      if (id === 'omniroute' && !isOmnirouteBaseUrlConfigured()) {
        await vscode.commands.executeCommand('copilot-amplify.CA-omniroute.editBaseUrl');
      } else if (id !== 'omniroute' && !(await registry.auth(id).getApiKey())) {
        await registry.auth(id).promptForApiKey();
      } else {
        await testConnection(id);
        return;
      }
      tree.refresh();
    }),

    vscode.commands.registerCommand('copilot-amplify.setApiKey', setApiKey),
    vscode.commands.registerCommand('copilot-amplify.clearApiKey', clearApiKey),

    vscode.commands.registerCommand('copilot-amplify.testConnection', async (item?: ProviderTreeItem) => {
      const id = await resolveProviderId(item, 'Choose a provider to test');
      if (id) {
        await testConnection(id);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.pinModel', (item?: ModelTreeItem) => {
      if (item?.providerId && item.modelId) {
        tree.pinModel(item.providerId, item.modelId, typeof item.label === 'string' ? item.label : item.modelId);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.unpinModel', (item?: ModelTreeItem) => {
      if (item?.providerId && item.modelId) {
        tree.unpinModel(item.providerId, item.modelId);
      }
    }),

    // Marks a model as the one you're using. VS Code has no API to switch
    // Copilot Chat's model, so the message points the user at the picker.
    vscode.commands.registerCommand('copilot-amplify.selectModel', async (item?: ModelTreeItem) => {
      if (!item?.providerId || !item.modelId) {
        return;
      }
      const name = typeof item.label === 'string' ? item.label : item.modelId;
      tree.setActiveModel(item.providerId, item.modelId, name);
      statusBarItem.text = `$(sparkle) ${name}`;
      const choice = await vscode.window.showInformationMessage(
        `${name} selected. Choose it in Copilot Chat's model picker to start using it.`,
        'Open Chat',
      );
      if (choice) {
        await vscode.commands.executeCommand('workbench.action.chat.open');
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.documentation', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/mojahid2021/copilot-amplify#readme')),
    ),
    vscode.commands.registerCommand('copilot-amplify.report', () =>
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/mojahid2021/copilot-amplify/issues/new')),
    ),

    vscode.commands.registerCommand('copilot-amplify.showNetworkQuality', async () => {
      const items: vscode.QuickPickItem[] = registry.list().map((descriptor) => {
        const q = registry.provider(descriptor.id).getNetworkQuality();
        if (q.sampleCount === 0) {
          return { label: `$(circle-outline) ${descriptor.displayName}`, description: 'No requests yet' };
        }
        return {
          label: `${qualityIcon(q.level)} ${descriptor.displayName}`,
          description: `${q.avgLatencyMs} ms to first token · ${Math.round(q.errorRate * 100)}% errors`,
          detail: `Based on the last ${q.sampleCount} request${q.sampleCount === 1 ? '' : 's'}`,
        };
      });
      await vscode.window.showQuickPick(items, { title: 'Network Quality', placeHolder: 'Response time and errors per provider' });
      updateNetQualityBar();
    }),
  );
}

async function pickProviderId(registry: ProviderRegistry, placeHolder = 'Choose a provider'): Promise<string | undefined> {
  const entries = registry.list().map((d) => ({ label: d.displayName, id: d.id }));
  return (await vscode.window.showQuickPick(entries, { title: 'Copilot Amplify', placeHolder }))?.id;
}
