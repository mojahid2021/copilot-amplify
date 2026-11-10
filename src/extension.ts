import * as vscode from 'vscode';
import { createProviderRegistry } from './providers';
import { logger, disposeLogChannel } from './core/logging/logger';
import { disposeOmnirouteConfig } from './providers/omniroute/config';
import { disposeAgentrouterConfig } from './providers/agentrouter/config';
import { disposeGlobalConfig } from './core/globalConfig';
import { migratePlaintextApiKeys } from './secretsMigration';
import { ProvidersTreeDataProvider } from './ui/treeProvider';
import { createNetworkQualityStatusBar } from './ui/networkQuality';
import { registerProviderCommands } from './commands/providerCommands';
import { registerOmnirouteCommands } from './commands/omnirouteCommands';

/**
 * Extension entry point. Activation does no network I/O: model discovery only
 * happens when the user asks for it (Load Models / Refresh).
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = logger.child({ component: 'extension' });

  // Must finish before any provider reads its key, so migrated keys are visible.
  try {
    const { migratedProviders } = await migratePlaintextApiKeys(context);
    if (migratedProviders.length > 0) {
      void vscode.window.showInformationMessage(
        `Copilot Amplify moved your ${migratedProviders.join(', ')} API key${migratedProviders.length === 1 ? '' : 's'} from settings.json into your system keychain.`,
      );
    }
  } catch (error) {
    log.warn('secrets migration failed', { error: error instanceof Error ? error.message : String(error) });
  }

  const registry = createProviderRegistry(context.secrets);
  context.subscriptions.push(registry);
  for (const descriptor of registry.list()) {
    try {
      context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(descriptor.vendor, registry.provider(descriptor.id)));
    } catch (error) {
      // One bad vendor id must not stop the other providers from loading.
      log.warn(`could not register provider ${descriptor.displayName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const tree = new ProvidersTreeDataProvider(registry, context);
  context.subscriptions.push(tree, vscode.window.createTreeView('copilot-amplify.providers', { treeDataProvider: tree }));

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.name = 'Copilot Amplify';
  statusBarItem.command = 'copilot-amplify.manage';
  const activeModel = context.globalState.get<string>('activeModelName') ?? context.globalState.get<string>('activeModelId');
  statusBarItem.text = activeModel ? `$(sparkle) ${activeModel}` : '$(sparkle) Copilot Amplify';
  statusBarItem.tooltip = 'Copilot Amplify: manage providers and models';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const updateNetQualityBar = createNetworkQualityStatusBar(context, registry);

  registerProviderCommands(context, { registry, tree, statusBarItem, updateNetQualityBar });
  registerOmnirouteCommands(context, { registry, tree });

  log.info('activation complete');
}

export function deactivate(): void {
  disposeOmnirouteConfig();
  disposeAgentrouterConfig();
  disposeGlobalConfig();
  disposeLogChannel();
}
