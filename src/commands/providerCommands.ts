import * as vscode from 'vscode';
import type { ProviderRegistry } from '../core/provider/registry';
import { buildAmplifyDiagnostics, showTextReport } from '../core/diagnostics';
import type { ProvidersTreeDataProvider, ProviderTreeItem, ModelTreeItem } from '../ui/treeProvider';

/**
 * General provider commands (all providers, preserved from 1.x):
 * manage / refresh / provider.click / setApiKey / testConnection /
 * clearApiKey / pinModel / unpinModel / selectModel / documentation / report.
 */

export interface ProviderCommandDeps {
  registry: ProviderRegistry;
  tree: ProvidersTreeDataProvider;
  statusBarItem: vscode.StatusBarItem;
}

function toQuickPickEntries(registry: ProviderRegistry): Array<{ label: string; id: string }> {
  return registry.list().map((d) => ({ label: d.displayName, id: d.id }));
}

export function registerProviderCommands(context: vscode.ExtensionContext, deps: ProviderCommandDeps): void {
  const { registry, tree, statusBarItem } = deps;

  const authOf = (id?: string) => (id && registry.has(id) ? registry.auth(id as never) : undefined);

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-amplify.manage', async () => {
      const selectedAction = await vscode.window.showQuickPick(
        [
          { label: '$(key) Set API Key', action: 'setApiKey', description: 'Configure credentials for a provider' },
          { label: '$(plug) Test Connection', action: 'test', description: 'Verify provider connection & model availability' },
          { label: '$(trash) Clear API Key', action: 'clearApiKey', description: 'Remove saved credentials' },
          { label: '$(sync) Refresh Providers & Models', action: 'refresh', description: 'Refetch live models and update state' },
          { label: '$(pulse) Show Diagnostics', action: 'diagnostics', description: 'All providers: status, keys, circuits' },
          { label: '$(gear) Configure OmniRoute…', action: 'omniroute-configure', description: 'Base URL, API key and options' },
          { label: '$(link) Edit OmniRoute Base URL', action: 'omniroute-baseurl', description: 'Change the OmniRoute server URL' },
          { label: '$(pulse) Show OmniRoute Diagnostics', action: 'omniroute-diagnostics', description: 'Connection, cache and health report' },
          { label: '$(output) Show OmniRoute Telemetry Logs', action: 'telemetry', description: 'Open OmniRoute response logs' },
        ],
        { placeHolder: 'Manage Copilot Amplify Providers' },
      );

      if (!selectedAction) {
        return;
      }

      if (selectedAction.action === 'refresh') {
        await vscode.commands.executeCommand('copilot-amplify.refresh');
        return;
      }
      if (selectedAction.action === 'diagnostics') {
        await vscode.commands.executeCommand('copilot-amplify.showDiagnostics');
        return;
      }
      if (selectedAction.action === 'telemetry') {
        await vscode.commands.executeCommand('copilot-amplify.omniroute.showTelemetry');
        return;
      }
      if (selectedAction.action === 'omniroute-configure') {
        await vscode.commands.executeCommand('copilot-amplify.omniroute.configure');
        return;
      }
      if (selectedAction.action === 'omniroute-baseurl') {
        await vscode.commands.executeCommand('copilot-amplify.omniroute.editBaseUrl');
        return;
      }
      if (selectedAction.action === 'omniroute-diagnostics') {
        await vscode.commands.executeCommand('copilot-amplify.omniroute.showDiagnostics');
        return;
      }

      const selectedProvider = await vscode.window.showQuickPick(toQuickPickEntries(registry), {
        placeHolder: `Select provider to ${selectedAction.label.toLowerCase()}`,
      });
      if (!selectedProvider) {
        return;
      }

      const id = selectedProvider.id;
      const auth = authOf(id);
      if (!auth || !registry.has(id)) {
        return;
      }
      const displayName = registry.get(id as never)?.displayName ?? id;

      if (selectedAction.action === 'setApiKey') {
        await vscode.commands.executeCommand('copilot-amplify.setApiKey', { providerId: id } satisfies Partial<ProviderTreeItem>);
      } else if (selectedAction.action === 'test') {
        await runTestConnection(registry, tree, id, displayName);
      } else if (selectedAction.action === 'clearApiKey') {
        await vscode.commands.executeCommand('copilot-amplify.clearApiKey', { providerId: id } satisfies Partial<ProviderTreeItem>);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.refresh', async () => {
      for (const descriptor of registry.list()) {
        try {
          registry.provider(descriptor.id).refreshCaches();
        } catch {
          /* lazy instantiation failures are non-fatal here */
        }
      }
      // Re-discover OmniRoute models eagerly so the picker updates immediately.
      try {
        void (registry.provider('omniroute') as unknown as { warmupNow?(): Promise<unknown> }).warmupNow?.().catch(() => {});
      } catch {
        /* discovery errors surface via health */
      }
      tree.refresh();
    }),

    vscode.commands.registerCommand('copilot-amplify.showDiagnostics', async () => {
      const report = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Copilot Amplify: building diagnostics…' },
        () => buildAmplifyDiagnostics(registry),
      );
      await showTextReport(report);
    }),

    vscode.commands.registerCommand('copilot-amplify.provider.click', async (item: ProviderTreeItem) => {
      const id = item?.providerId;
      if (!id || !registry.has(id)) { return; }
      const auth = registry.auth(id);
      const key = await auth.getApiKey();
      if (key || id === 'omniroute') {
        await runTestConnection(registry, tree, id, registry.get(id)?.displayName ?? id);
      } else {
        await auth.promptForApiKey();
        tree.refresh();
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.setApiKey', async (item?: ProviderTreeItem) => {
      const id = item?.providerId;
      const auth = id ? authOf(id) : await pickProviderThenAuth(registry);
      if (!auth) { return; }
      await auth.promptForApiKey();
      tree.refresh();
    }),

    vscode.commands.registerCommand('copilot-amplify.testConnection', async (item?: ProviderTreeItem) => {
      const id = item?.providerId ?? (await pickProviderId(registry));
      if (!id || !registry.has(id)) { return; }
      await runTestConnection(registry, tree, id, registry.get(id)?.displayName ?? id);
    }),

    vscode.commands.registerCommand('copilot-amplify.clearApiKey', async (item?: ProviderTreeItem) => {
      const id = item?.providerId;
      const auth = id ? authOf(id) : await pickProviderThenAuth(registry);
      if (!auth || !id || !registry.has(id)) { return; }
      await auth.deleteApiKey();
      try {
        registry.provider(id).refreshCaches();
      } catch { /* not yet instantiated */ }
      tree.refresh();
      vscode.window.showInformationMessage(`${registry.get(id)?.displayName ?? id} API key cleared`);
    }),

    vscode.commands.registerCommand('copilot-amplify.pinModel', (item?: ModelTreeItem) => {
      if (item && item.providerId && item.modelId) {
        const name = typeof item.label === 'string' ? item.label : item.modelId;
        tree.pinModel(item.providerId, item.modelId, name);
        vscode.window.showInformationMessage(`Pinned ${name} to Favorites`);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.unpinModel', (item?: ModelTreeItem) => {
      if (item && item.providerId && item.modelId) {
        tree.unpinModel(item.providerId, item.modelId);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.selectModel', async (item?: ModelTreeItem) => {
      if (item && item.providerId && item.modelId) {
        tree.setActiveModel(item.providerId, item.modelId);
        statusBarItem.text = `$(sparkle) Amplify: ${item.modelId}`;
        vscode.window.showInformationMessage(`Selected model ${item.modelId}`);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.documentation', () => {
      void vscode.env.openExternal(vscode.Uri.parse('https://github.com/mojahid2021/copilot-amplify#readme'));
    }),
    vscode.commands.registerCommand('copilot-amplify.report', () => {
      void vscode.env.openExternal(vscode.Uri.parse('https://github.com/mojahid2021/copilot-amplify/issues/new'));
    }),
  );
}

async function pickProviderId(registry: ProviderRegistry): Promise<string | undefined> {
  const choice = await vscode.window.showQuickPick(toQuickPickEntries(registry), {
    placeHolder: 'Select a provider',
  });
  return choice?.id;
}

async function pickProviderThenAuth(registry: ProviderRegistry) {
  const id = await pickProviderId(registry);
  return id ? registry.auth(id as never) : undefined;
}

async function runTestConnection(
  registry: ProviderRegistry,
  tree: ProvidersTreeDataProvider,
  id: string,
  displayName: string,
): Promise<void> {
  if (!registry.has(id)) { return; }
  let provider;
  try {
    provider = registry.provider(id as never);
  } catch {
    return;
  }
  if (id !== 'omniroute') {
    const auth = registry.auth(id as never);
    if (!(await auth.getApiKey())) {
      const choice = await vscode.window.showInformationMessage(
        `${displayName} API key is not set. Would you like to set it now?`,
        'Set API Key',
      );
      if (choice === 'Set API Key') {
        await auth.promptForApiKey();
        tree.refresh();
      }
      return;
    }
  }

  try {
    const result = await provider.testConnection();
    if (result.ok) {
      const extras =
        result.latencyMs !== undefined ? ` · ${result.latencyMs} ms` : '';
      const models = result.modelCount !== undefined ? ` · ${result.modelCount} models` : '';
      void vscode.window.showInformationMessage(`✓ ${displayName}: ${result.message}${extras}${models}`);
    } else {
      const status = result.httpStatus !== undefined ? `\n\nHTTP status: ${result.httpStatus}` : '';
      void vscode.window.showErrorMessage(
        `✗ ${displayName} connection failed\n\nReason:\n${result.message}${status}`,
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`${displayName} test failed: ${msg}`);
  }
}
