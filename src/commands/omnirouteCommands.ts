import * as vscode from 'vscode';
import type { ProviderRegistry } from '../core/provider/registry';
import { validateBaseUrl, normalizeBaseUrl, joinEndpoint } from '../core/url';
import { showLogChannel } from '../core/logging/logger';
import { DEFAULT_BASE_URL, getOmnirouteConfig } from '../providers/omniroute/config';
import { testOmnirouteConnection } from '../providers/omniroute/connectionTest';
import {
  buildOmnirouteDiagnostics,
  showOmnirouteDiagnostics,
} from '../providers/omniroute/diagnostics';
import type { ProvidersTreeDataProvider } from '../ui/treeProvider';

/**
 * Dedicated OmniRoute provider commands:
 *   configure / setApiKey / removeApiKey / testConnection /
 *   refreshModels / showDiagnostics / resetConfiguration
 */

const SECTION = 'copilot-amplify.omniroute';

export interface OmnirouteCommandDeps {
  registry: ProviderRegistry;
  tree: ProvidersTreeDataProvider;
}

export function registerOmnirouteCommands(context: vscode.ExtensionContext, deps: OmnirouteCommandDeps): void {
  const { registry, tree } = deps;

  const configTarget = (): vscode.ConfigurationTarget =>
    vscode.workspace.workspaceFolders
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;

  async function updateSetting(key: string, value: unknown): Promise<void> {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    await cfg.update(key, value, configTarget());
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('copilot-amplify.omniroute.configure', async () => {
      try {
        const cfg = getOmnirouteConfig();
        const auth = registry.auth('omniroute');

        // 1. Base URL (validated).
        let baseUrl: string | undefined;
        for (;;) {
          const input = await vscode.window.showInputBox({
            prompt: 'OmniRoute Base URL',
            placeHolder: 'http://localhost:3000 or https://omniroute.example.com',
            value: cfg.baseUrl,
            ignoreFocusOut: true,
            validateInput: (value) => validateBaseUrl(value).error,
          });
          if (input === undefined) { return; }
          baseUrl = normalizeBaseUrl(input, '');
          await updateSetting('baseUrl', baseUrl);
          break;
        }

        // 1b. Optional custom chat endpoint (absolute URL or path; empty = standard).
        const chatEndpoint = await vscode.window.showInputBox({
          prompt: 'Custom chat-completions endpoint (leave empty for the default {Base URL}/chat/completions)',
          placeHolder: 'e.g. my-proxy/chat or https://gateway.example.com/custom/chat',
          value: cfg.chatEndpoint,
          ignoreFocusOut: true,
          validateInput: (value) => {
            const trimmed = (value ?? '').trim();
            if (!trimmed || /^https?:\/\//i.test(trimmed)) {
              return undefined; // empty or absolute — validated at resolution time
            }
            // Relative paths must not contain a scheme fragment or spaces.
            return /[\s]/.test(trimmed) ? 'Path cannot contain whitespace.' : undefined;
          },
        });
        if (chatEndpoint === undefined) { return; }
        await updateSetting('chatEndpoint', chatEndpoint.trim());

        // 2. API key (optional; stored in SecretStorage only).
        const setKeyChoice = await vscode.window.showQuickPick(
          [
            { label: '$(key) Set API key', value: 'set' as const },
            { label: '$(skip) Keep current key', value: 'keep' as const },
          ],
          { placeHolder: `OmniRoute API key (${(await auth.getApiKey()) ? 'currently configured' : 'not configured — anonymous mode'})` },
        );
        if (setKeyChoice?.value === 'set') {
          const key = await auth.promptForApiKey();
          if (!key) { return; }
        }

        // 3. Test connection.
        const key = await auth.getApiKey();
        const test = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Copilot Amplify: testing OmniRoute…' },
          () => testOmnirouteConnection({ baseUrl, ...(key ? { apiKey: key } : {}) }),
        );

        if (!test.ok) {
          const status = test.httpStatus !== undefined ? `\n\nHTTP Status:\n${test.httpStatus}` : '';
          void vscode.window.showErrorMessage(
            `✗ OmniRoute connection failed\n\nReason:\n${test.message}${status}\n\nConfiguration was saved. Adjust it via "Configure OmniRoute" again.`,
            { modal: false },
          );
          return;
        }

        void vscode.window.showInformationMessage(
          `✓ OmniRoute connected\n\nLatency: ${test.latencyMs ?? '?'} ms\nModels available: ${test.modelCount ?? '?'}`,
        );
        tree.refresh();
      } catch (error) {
        void vscode.window.showErrorMessage(
          `OmniRoute configuration failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.omniroute.setApiKey', async () => {
      const auth = registry.auth('omniroute');
      const key = await auth.promptForApiKey();
      if (key) { tree.refresh(); }
    }),

    vscode.commands.registerCommand('copilot-amplify.omniroute.removeApiKey', async () => {
      const auth = registry.auth('omniroute');
      await auth.deleteApiKey();
      try {
        registry.provider('omniroute').refreshCaches();
      } catch { /* not yet instantiated */ }
      tree.refresh();
      void vscode.window.showInformationMessage('OmniRoute API key removed');
    }),

    vscode.commands.registerCommand('copilot-amplify.omniroute.testConnection', async () => {
      const auth = registry.auth('omniroute');
      const key = await auth.getApiKey();
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Copilot Amplify: testing OmniRoute…' },
        () => testOmnirouteConnection({ baseUrl: getOmnirouteConfig().baseUrl, ...(key ? { apiKey: key } : {}) }),
      );

      if (result.ok) {
        void vscode.window.showInformationMessage(
          `✓ OmniRoute connected\n\nLatency: ${result.latencyMs ?? '?'} ms\nModels available: ${result.modelCount ?? '?'}`,
        );
      } else {
        const status = result.httpStatus !== undefined ? `\n\nHTTP Status:\n${result.httpStatus}` : '';
        const hint = !key && (result.httpStatus === 401 || result.httpStatus === 403)
          ? '\n\nRun:\nCopilot Amplify: Set OmniRoute API Key'
          : '';
        void vscode.window.showErrorMessage(
          `✗ OmniRoute connection failed\n\nReason:\n${result.message}${status}${hint}`,
        );
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.omniroute.refreshModels', async () => {
      try {
        const provider = registry.provider('omniroute');
        provider.refreshCaches();
        const models = (await provider.warmupNow?.()) as unknown[] ?? [];
        if (models.length > 0) {
          void vscode.window.showInformationMessage(`OmniRoute: discovered ${models.length} chat models`);
        } else {
          void vscode.window.showWarningMessage(
            'OmniRoute model discovery returned no models. Check that the server is running.',
          );
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          `OmniRoute refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        tree.refresh();
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.omniroute.showDiagnostics', async () => {
      const cfg = getOmnirouteConfig();
      const auth = registry.auth('omniroute');
      const apiKeyConfigured = Boolean(await auth.getApiKey());
      const provider = registry.provider('omniroute');
      const models = await provider.listModelsForTree();
      const health = provider.health();

      const report = buildOmnirouteDiagnostics({
        baseUrl: joinEndpoint(cfg.baseUrl, ''),
        apiKeyConfigured,
        breakerState: provider.getCircuitState(),
        modelCount: models.length > 0 ? models.length : undefined,
        modelCacheFresh: health.status === 'connected',
        lastDiscoveryError:
          health.status === 'error' || health.status === 'auth-failed' || health.status === 'rate-limited'
            ? health.detail
            : undefined,
      });
      await showOmnirouteDiagnostics(report);
      showLogChannel(true);
    }),

    vscode.commands.registerCommand('copilot-amplify.omniroute.editChatEndpoint', async () => {
      try {
        const cfg = getOmnirouteConfig();
        const current = cfg.chatEndpoint;
        const input = await vscode.window.showInputBox({
          prompt: `Custom chat-completions endpoint (current: ${current || 'default — {Base URL}/chat/completions'})`,
          placeHolder: 'e.g. my-proxy/chat or https://gateway.example.com/custom/chat — leave empty to reset',
          value: current,
          ignoreFocusOut: true,
          validateInput: (value) => {
            const trimmed = (value ?? '').trim();
            if (!trimmed || /^https?:\/\//i.test(trimmed)) {
              return undefined; // empty or absolute — validated at resolution time
            }
            return /[\s]/.test(trimmed) ? 'Path cannot contain whitespace.' : undefined;
          },
        });
        if (input === undefined) { return; } // dismissed

        await updateSetting('chatEndpoint', input.trim());
        try {
          registry.provider('omniroute').refreshCaches();
        } catch { /* not yet instantiated */ }
        tree.refresh();

        const trimmed = input.trim();
        void vscode.window.showInformationMessage(
          trimmed
            ? `OmniRoute chat endpoint set to: ${trimmed}`
            : 'OmniRoute chat endpoint reset to the default ({Base URL}/chat/completions)',
        );
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Updating the chat endpoint failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),

    vscode.commands.registerCommand('copilot-amplify.omniroute.resetConfiguration', async () => {
      const choice = await vscode.window.showWarningMessage(
        'Reset all OmniRoute settings and remove its stored API key?',
        { modal: true },
        'Reset',
      );
      if (choice !== 'Reset') { return; }

      const defaults: Record<string, unknown> = {
        baseUrl: DEFAULT_BASE_URL,
        chatEndpoint: '',
        noCache: false,
        noMemory: true,
        compression: '',
        sessionId: '',
        progress: false,
        modelCacheTtlSeconds: 300,
        requestTimeoutMs: 120_000,
        discoveryTimeoutMs: 8_000,
        logTelemetry: true,
        warmupOnStartup: false,
        debugLogging: false,
      };
      for (const [key, value] of Object.entries(defaults)) {
        await updateSetting(key, value);
      }
      await registry.auth('omniroute').deleteApiKey();
      try {
        registry.provider('omniroute').refreshCaches();
      } catch { /* not yet instantiated */ }
      tree.refresh();
      void vscode.window.showInformationMessage('OmniRoute configuration reset to defaults');
    }),

    vscode.commands.registerCommand('copilot-amplify.omniroute.showTelemetry', () => {
      showLogChannel(false);
    }),
  );
}
