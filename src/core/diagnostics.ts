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

    const provider = registry.provider(descriptor.id);
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

    lines.push(`Circuit breaker: ${provider.getCircuitState()}`);

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
    'Tip: "Copilot Amplify: OmniRoute: Show Request Log" shows the route, latency and cost of each OmniRoute request.',
    'API keys are kept in your system keychain and never appear in this report.',
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
