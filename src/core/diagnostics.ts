import * as vscode from 'vscode';
import type { ProviderRegistry } from './provider/registry';

/**
 * Unified, credential-free diagnostics across every registered provider.
 *
 * Security: API keys are rendered strictly as a Configured / Not configured
 * flag — values are never read into the report.
 */
export async function buildAmplifyDiagnostics(registry: ProviderRegistry): Promise<string> {
  const lines: string[] = [
    'Copilot Amplify Diagnostics',
    `Generated: ${new Date().toLocaleString()}`,
    '',
    '========================================',
  ];

  for (const descriptor of registry.list()) {
    lines.push('', descriptor.displayName, '-'.repeat(Math.max(3, descriptor.displayName.length)));

    // Credential state — boolean only, never the value itself.
    let keyConfigured = false;
    try {
      keyConfigured = Boolean(await registry.auth(descriptor.id).getApiKey());
    } catch {
      /* treat as unconfigured */
    }
    lines.push(`API Key:         ${keyConfigured ? 'Configured' : 'Not configured'}`);

    let provider;
    try {
      provider = registry.provider(descriptor.id);
    } catch (error) {
      lines.push(`Status:          error (${error instanceof Error ? error.message : String(error)})`);
      lines.push('========================================');
      continue;
    }

    try {
      const health = provider.health();
      lines.push(
        `Status:          ${health.status}${health.detail ? ` — ${health.detail}` : ''}`,
      );
    } catch (error) {
      lines.push(`Status:          unavailable (${error instanceof Error ? error.message : String(error)})`);
    }

    try {
      const models = await provider.listModelsForTree();
      lines.push(`Models:          ${models.length}`);
    } catch {
      lines.push('Models:          unavailable');
    }

    try {
      lines.push(`Circuit breaker: ${provider.getCircuitState()}`);
    } catch {
      /* defensive: never let one provider's diagnostics break the report */
    }

    const outcome = provider.getLatestRequestOutcome();
    if (outcome) {
      const age = formatAge(outcome.at);
      lines.push(
        outcome.ok
          ? `Last request:    Success (${age})`
          : `Last request:    Failed — ${outcome.category ?? 'error'}${
            outcome.statusCode ? ` (HTTP ${outcome.statusCode})` : ''
          } (${age})`,
      );
    }
    lines.push('========================================');
  }

  lines.push(
    '',
    'Tip: "Copilot Amplify: Show Omniroute Telemetry" opens per-request routing/cost logs.',
    'API keys are stored exclusively in VS Code SecretStorage and are never displayed.',
  );
  return lines.join('\n');
}

function formatAge(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  return `${Math.round(minutes / 60)}h ago`;
}

/** Open a plaintext report in a preview editor (falls back to an output channel). */
export async function showTextReport(report: string): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument({ content: report, language: 'plaintext' });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch {
    const channel = vscode.window.createOutputChannel('Copilot Amplify — Report');
    channel.appendLine(report);
    channel.show(true);
  }
}
