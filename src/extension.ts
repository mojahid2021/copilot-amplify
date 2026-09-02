import * as vscode from 'vscode';
import { createProviderRegistry } from './providers';
import { logger, disposeLogChannel } from './core/logging/logger';
import { disposeOmnirouteConfig } from './providers/omniroute/config';
import { migratePlaintextApiKeys } from './secretsMigration';
import { ProvidersTreeDataProvider } from './ui/treeProvider';
import { registerProviderCommands } from './commands/providerCommands';
import { registerOmnirouteCommands } from './commands/omnirouteCommands';

/**
 * Copilot Amplify — extension host.
 *
 * Activation stays lightweight: no network I/O happens here. Provider
 * instances are created lazily by the registry on first use; OmniRoute model
 * discovery runs on the first Language Model API query (or via explicit
 * refresh / optional warmup setting).
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = logger.child({ component: 'extension' });

  // 1. One-time plaintext → SecretStorage migration (must complete before any
  //    provider can be queried so migrated keys are visible immediately).
  try {
    const result = await migratePlaintextApiKeys(context);
    if (result.migratedProviders.length > 0) {
      void vscode.window.showInformationMessage(
        `Copilot Amplify: moved API key(s) for ${result.migratedProviders.join(', ')} into VS Code SecretStorage. The plaintext settings were removed.`,
      );
    }
  } catch (error) {
    log.warn('secrets migration failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 2. Registry + vendor registration.
  const registry = createProviderRegistry(context.secrets);
  context.subscriptions.push(registry);

  for (const descriptor of registry.list()) {
    try {
      context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider(descriptor.vendor, registry.provider(descriptor.id)),
      );
    } catch (error) {
      log.warn(`could not register provider ${descriptor.displayName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 3. Tree view.
  const tree = new ProvidersTreeDataProvider(registry, context);
  context.subscriptions.push(
    tree,
    vscode.window.createTreeView('copilot-amplify.providers', { treeDataProvider: tree }),
  );

  // 4. Status bar.
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'copilot-amplify.manage';
  const initialModel = context.globalState.get<string>('activeModelId', '');
  statusBarItem.text = initialModel ? `$(sparkle) Amplify: ${initialModel}` : '$(sparkle) Copilot Amplify';
  statusBarItem.tooltip = 'Copilot Amplify: Click to manage providers & active models';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 5. Commands (general + OmniRoute).
  registerProviderCommands(context, { registry, tree, statusBarItem });
  registerOmnirouteCommands(context, { registry, tree });

  log.info('activation complete');
}

export function deactivate(): void {
  disposeOmnirouteConfig();
  disposeLogChannel();
}
