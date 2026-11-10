import * as vscode from 'vscode';
import type { ProviderRegistry } from '../core/provider/registry';
import type { NetworkQuality } from '../core/resilience/networkQuality';

export function qualityIcon(level: NetworkQuality['level']): string {
  return level === 'good' ? '$(check)' : level === 'degraded' ? '$(warning)' : '$(error)';
}

/**
 * Status bar item showing the network quality of the provider that served
 * the latest request. Returns a function that re-renders it.
 */
export function createNetworkQualityStatusBar(context: vscode.ExtensionContext, registry: ProviderRegistry): () => void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  item.command = 'copilot-amplify.showNetworkQuality';
  item.name = 'Copilot Amplify Network Quality';
  item.show();

  function update(): void {
    // Follow the provider used last: most people pick models in Copilot's own
    // picker, which never touches our saved selection.
    const providers = registry.list().map((d) => ({ label: d.displayName, provider: registry.provider(d.id) }));
    const latest = providers
      .filter((p) => p.provider.getLatestRequestOutcome())
      .sort((a, b) => b.provider.getLatestRequestOutcome()!.at - a.provider.getLatestRequestOutcome()!.at)[0];
    const quality = latest?.provider.getNetworkQuality();

    if (!latest || !quality || quality.sampleCount === 0) {
      item.text = '$(pulse) —';
      item.tooltip = 'Network quality appears after your first chat request. Click for details.';
      item.backgroundColor = undefined;
      return;
    }
    item.text = `${qualityIcon(quality.level)} ${quality.avgLatencyMs} ms`;
    item.tooltip = `${latest.label}: ${quality.avgLatencyMs} ms to first token, ${Math.round(quality.errorRate * 100)}% errors (last ${quality.sampleCount} requests). Click for all providers.`;
    item.backgroundColor =
      quality.level === 'poor' ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : quality.level === 'degraded' ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
  }

  update();
  const interval = setInterval(update, 30_000);
  context.subscriptions.push(item, { dispose: () => clearInterval(interval) });
  return update;
}
