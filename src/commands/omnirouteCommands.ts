import * as vscode from 'vscode';
import type { ConnectionTestResult, ProviderRegistry } from '../core/provider/registry';
import { validateBaseUrl, normalizeBaseUrl, joinEndpoint } from '../core/url';
import { showLogChannel } from '../core/logging/logger';
import { getOmnirouteConfig } from '../providers/omniroute/config';
import { testOmnirouteConnection } from '../providers/omniroute/connectionTest';
import { buildOmnirouteDiagnostics } from '../providers/omniroute/diagnostics';
import { showTextReport } from '../core/diagnostics';
import type { ProvidersTreeDataProvider } from '../ui/treeProvider';
import { connectionSummary, isAuthFailure } from '../ui/notifications';

/** OmniRoute-only commands: server URL, key, diagnostics and reset. */

const SECTION = 'copilot-amplify.CA-omniroute';

/** Every OmniRoute setting, so "Reset" can clear them all. Keep in sync with package.json. */
const SETTING_KEYS = [
  'baseUrl', 'noCache', 'noMemory', 'compression', 'sessionId', 'progress',
  'modelCacheTtlSeconds', 'requestTimeoutMs', 'discoveryTimeoutMs', 'logTelemetry',
  'warmupOnStartup', 'debugLogging',
];

export interface OmnirouteCommandDeps {
  registry: ProviderRegistry;
  tree: ProvidersTreeDataProvider;
}

export function registerOmnirouteCommands(context: vscode.ExtensionContext, deps: OmnirouteCommandDeps): void {
  const { registry, tree } = deps;
  const auth = () => registry.auth('omniroute');
  const provider = () => registry.provider('omniroute');

  async function saveBaseUrl(baseUrl: string): Promise<void> {
    const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await vscode.workspace.getConfiguration(SECTION).update('baseUrl', baseUrl, target);
  }

  async function testWithProgress(baseUrl: string): Promise<ConnectionTestResult> {
    const apiKey = await auth().getApiKey();
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Testing OmniRoute…' },
      () => testOmnirouteConnection({ baseUrl, apiKey }),
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-amplify.CA-omniroute.configure', async () => {
      try {
        const baseUrl = await promptBaseUrl(getOmnirouteConfig().baseUrl, 'Set Up OmniRoute (1/2)');
        if (baseUrl === undefined) {
          return;
        }
        await saveBaseUrl(baseUrl);

        const hasKey = Boolean(await auth().getApiKey());
        const keyChoice = await vscode.window.showQuickPick(
          [
            { label: '$(key) Set API Key…', detail: 'Required if your server has authentication turned on', value: 'set' },
            {
              label: hasKey ? '$(check) Keep Current Key' : '$(globe) Continue Without a Key',
              detail: hasKey ? undefined : 'Works when the server allows anonymous access',
              value: 'keep',
            },
          ],
          { title: 'Set Up OmniRoute (2/2)', placeHolder: 'API key' },
        );
        if (keyChoice?.value === 'set' && !(await auth().promptForApiKey())) {
          return;
        }

        const test = await testWithProgress(baseUrl);
        tree.refresh();
        if (test.ok) {
          const load = await vscode.window.showInformationMessage(`${connectionSummary('OmniRoute', test)} Setup complete.`, 'Load Models');
          if (load) {
            await vscode.commands.executeCommand('copilot-amplify.loadModels', { providerId: 'omniroute' });
          }
        } else {
          await showTestFailure(test, 'Your settings were saved; run "OmniRoute: Set Up…" again to change them.');
        }
      } catch (error) {
        void vscode.window.showErrorMessage(`OmniRoute setup failed. ${errorText(error)}`);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.CA-omniroute.editBaseUrl', async () => {
      try {
        const current = getOmnirouteConfig().baseUrl;
        const baseUrl = await promptBaseUrl(current);
        if (baseUrl === undefined) {
          return;
        }
        if (baseUrl === current) {
          void vscode.window.showInformationMessage('The OmniRoute server URL is unchanged.');
          return;
        }
        await saveBaseUrl(baseUrl);
        provider().refreshCaches();

        const test = await testWithProgress(baseUrl);
        tree.refresh();
        if (test.ok) {
          void vscode.window.showInformationMessage(`Server URL saved. ${connectionSummary('OmniRoute', test)}`);
        } else {
          await showTestFailure(test, 'The URL was saved anyway.');
        }
      } catch (error) {
        void vscode.window.showErrorMessage(`Couldn't change the OmniRoute server URL. ${errorText(error)}`);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.CA-omniroute.setApiKey', async () => {
      if (await auth().promptForApiKey()) {
        tree.refresh();
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.CA-omniroute.removeApiKey', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Remove the saved OmniRoute API key?',
        { modal: true, detail: 'OmniRoute requests will be sent without a key afterwards.' },
        'Remove',
      );
      if (confirm !== 'Remove') {
        return;
      }
      await auth().deleteApiKey();
      provider().refreshCaches();
      tree.refresh();
      void vscode.window.showInformationMessage('OmniRoute API key removed.');
    }),

    vscode.commands.registerCommand('copilot-amplify.CA-omniroute.testConnection', async () => {
      const test = await testWithProgress(getOmnirouteConfig().baseUrl);
      tree.refresh();
      if (test.ok) {
        void vscode.window.showInformationMessage(connectionSummary('OmniRoute', test));
      } else {
        await showTestFailure(test);
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.CA-omniroute.refreshModels', async () => {
      provider().refreshCaches();
      const models = await provider().loadModels();
      tree.refresh();
      if (models.length > 0) {
        void vscode.window.showInformationMessage(`Loaded ${models.length} OmniRoute models.`);
      } else {
        void vscode.window.showWarningMessage('No OmniRoute models were loaded. Check that the server is running and the URL is correct.');
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.CA-omniroute.showDiagnostics', async () => {
      const models = await provider().listModelsForTree();
      const health = provider().health();
      const failed = health.status === 'error' || health.status === 'auth-failed' || health.status === 'rate-limited';

      const report = buildOmnirouteDiagnostics({
        baseUrl: joinEndpoint(getOmnirouteConfig().baseUrl, ''),
        apiKeyConfigured: Boolean(await auth().getApiKey()),
        breakerState: provider().getCircuitState(),
        modelCount: models.length > 0 ? models.length : undefined,
        modelCacheFresh: health.status === 'connected',
        lastDiscoveryError: failed ? health.detail : undefined,
      });
      await showTextReport(report);
      showLogChannel(true);
    }),

    vscode.commands.registerCommand('copilot-amplify.CA-omniroute.resetConfiguration', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Reset all OmniRoute settings?',
        { modal: true, detail: 'This restores the default settings and removes the saved OmniRoute API key.' },
        'Reset',
      );
      if (choice !== 'Reset') {
        return;
      }
      // Removing the overrides brings back the defaults declared in package.json.
      const config = vscode.workspace.getConfiguration(SECTION);
      for (const key of SETTING_KEYS) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
        if (vscode.workspace.workspaceFolders) {
          await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
        }
      }
      await auth().deleteApiKey();
      provider().refreshCaches();
      tree.refresh();
      void vscode.window.showInformationMessage('OmniRoute settings were reset.');
    }),

    vscode.commands.registerCommand('copilot-amplify.CA-omniroute.showTelemetry', () => showLogChannel(false)),
  );
}

/** Ask for the server URL. Returns the normalized URL, or undefined when dismissed. */
async function promptBaseUrl(current: string, title = 'OmniRoute Server URL'): Promise<string | undefined> {
  const input = await vscode.window.showInputBox({
    title,
    prompt: 'Address of your OmniRoute server, including /v1',
    placeHolder: 'http://localhost:20128/v1',
    value: current,
    ignoreFocusOut: true,
    validateInput: (value) => validateBaseUrl(value).error,
  });
  return input === undefined ? undefined : normalizeBaseUrl(input, '');
}

/** Show a failed test with the button that most likely fixes it. */
async function showTestFailure(test: ConnectionTestResult, note = ''): Promise<void> {
  const message = `${connectionSummary('OmniRoute', test)}${note ? ` ${note}` : ''}`;
  const fix = isAuthFailure(test) ? 'Set API Key' : 'Change Server URL';
  const choice = await vscode.window.showErrorMessage(message, fix);
  if (choice === 'Set API Key') {
    await vscode.commands.executeCommand('copilot-amplify.CA-omniroute.setApiKey');
  } else if (choice === 'Change Server URL') {
    await vscode.commands.executeCommand('copilot-amplify.CA-omniroute.editBaseUrl');
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
