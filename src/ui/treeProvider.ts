import * as vscode from 'vscode';
import type { ProviderRegistry, ProviderTreeModel } from '../core/provider/registry';
import type { ProviderHealth, ProviderId } from '../core/provider/registry';

/**
 * Providers & Models tree.
 *
 * Consumes the provider registry exclusively: model rows come from each
 * provider's cached list (`listModelsForTree`), so expanding a section never
 * performs network I/O. Run "Refresh Providers & Models" to update caches.
 */

// ─── Tree item interfaces ────────────────────────────────────────────────────

export interface ProviderTreeItem extends vscode.TreeItem {
  providerId: string;
  contextValue: 'provider';
}

export interface SectionTreeItem extends vscode.TreeItem {
  sectionId: string;
  contextValue: 'section';
}

export interface ModelGroupTreeItem extends vscode.TreeItem {
  modelId: string;
  contextValue: 'model-group';
}

export interface ModelTreeItem extends vscode.TreeItem {
  modelId: string;
  providerId: string;
  contextValue: 'model' | 'favorite-model';
}

export interface ActionTreeItem extends vscode.TreeItem {
  actionId: string;
  contextValue: 'action';
}

type AnyTreeItem = ProviderTreeItem | SectionTreeItem | ModelGroupTreeItem | ModelTreeItem | ActionTreeItem;

// ─── Action catalogue ────────────────────────────────────────────────────────

const ACTIONS = [
  { id: 'refresh', label: 'Refresh Providers & Models', icon: 'sync', command: 'copilot-amplify.refresh' },
  { id: 'diagnostics', label: 'Show Diagnostics', icon: 'pulse', command: 'copilot-amplify.showDiagnostics' },
  { id: 'omniroute-baseurl', label: 'Edit OmniRoute Base URL', icon: 'link', command: 'copilot-amplify.omniroute.editBaseUrl' },
  { id: 'omniroute-diagnostics', label: 'Show OmniRoute Diagnostics', icon: 'pulse', command: 'copilot-amplify.omniroute.showDiagnostics' },
  { id: 'telemetry', label: 'Show OmniRoute Telemetry Logs', icon: 'output', command: 'copilot-amplify.omniroute.showTelemetry' },
  { id: 'docs', label: 'View Documentation & Guide', icon: 'book', command: 'copilot-amplify.documentation' },
  { id: 'report', label: 'Report Issue or Feedback', icon: 'bug', command: 'copilot-amplify.report' },
];

// ─── Tree data provider ───────────────────────────────────────────────────────

interface PinnedModel {
  providerId: string;
  modelId: string;
  name: string;
}

export class ProvidersTreeDataProvider implements vscode.TreeDataProvider<AnyTreeItem>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<AnyTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private pinnedModels: PinnedModel[] = [];
  private activeProviderId = 'xiaomi';
  private activeModelId = '';

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly context?: vscode.ExtensionContext,
  ) {
    if (this.context) {
      this.pinnedModels = this.context.globalState.get('pinnedModels', []);
      this.activeProviderId = this.context.globalState.get('activeProviderId', 'xiaomi');
      this.activeModelId = this.context.globalState.get('activeModelId', '');
    }
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setActiveModel(providerId: string, modelId: string): void {
    this.activeProviderId = providerId;
    this.activeModelId = modelId;
    if (this.context) {
      this.context.globalState.update('activeProviderId', providerId);
      this.context.globalState.update('activeModelId', modelId);
    }
    this.refresh();
  }

  pinModel(providerId: string, modelId: string, name: string): void {
    if (!this.pinnedModels.some((m) => m.providerId === providerId && m.modelId === modelId)) {
      this.pinnedModels.push({ providerId, modelId, name });
      this.savePinnedModels();
      this.refresh();
    }
  }

  unpinModel(providerId: string, modelId: string): void {
    this.pinnedModels = this.pinnedModels.filter((m) => !(m.providerId === providerId && m.modelId === modelId));
    this.savePinnedModels();
    this.refresh();
  }

  private savePinnedModels(): void {
    if (this.context) {
      this.context.globalState.update('pinnedModels', this.pinnedModels);
    }
  }

  getTreeItem(element: AnyTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AnyTreeItem): vscode.ProviderResult<AnyTreeItem[]> {
    if (!element) { return this.getRootSections(); }
    if (element.contextValue === 'section') {
      return this.getSectionChildren((element as SectionTreeItem).sectionId);
    }
    if (element.contextValue === 'model-group') {
      return this.getModelsForProvider((element as ModelGroupTreeItem).modelId as ProviderId);
    }
    return [];
  }

  private getRootSections(): SectionTreeItem[] {
    const sections: SectionTreeItem[] = [];
    if (this.pinnedModels.length > 0) {
      sections.push(this.mkSection('favorites', 'FAVORITES', 'star-full', false));
    }
    sections.push(
      this.mkSection('providers', 'PROVIDERS', 'layers', false),
      this.mkSection('models', 'MODELS', 'list-tree', true),
      this.mkSection('actions', 'ACTIONS', 'zap', true),
    );
    return sections;
  }

  private getSectionChildren(sectionId: string): vscode.ProviderResult<AnyTreeItem[]> {
    switch (sectionId) {
      case 'favorites': return this.getFavoriteItems();
      case 'providers': return this.getProviderItems();
      case 'models': return this.getModelItems();
      case 'actions': return this.getActionItems();
      default: return [];
    }
  }

  private getFavoriteItems(): ModelTreeItem[] {
    return this.pinnedModels.map((fav) => {
      const descriptor = this.registry.get(fav.providerId as ProviderId);
      const item = new vscode.TreeItem(fav.name, vscode.TreeItemCollapsibleState.None) as ModelTreeItem;
      item.modelId = fav.modelId;
      item.providerId = fav.providerId;
      item.contextValue = 'favorite-model';
      const isSelected = this.activeProviderId === fav.providerId && this.activeModelId === fav.modelId;
      item.description = `${descriptor?.displayName ?? fav.providerId} ${isSelected ? '✓ Active' : ''}`;
      item.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('symbolIcon.keywordForeground'));
      item.command = {
        command: 'copilot-amplify.selectModel',
        title: 'Use Model',
        arguments: [item],
      };
      return item;
    });
  }

  // ── PROVIDERS section ───────────────────────────────────────────────────────

  private async getProviderItems(): Promise<ProviderTreeItem[]> {
    const descriptors = this.registry.list();
    const keys = await Promise.all(
      descriptors.map(async (d) => Boolean(await this.registry.auth(d.id).getApiKey())),
    );

    const healths = await Promise.all(
      descriptors.map(async (d) => {
        try {
          return this.registry.provider(d.id).health();
        } catch {
          return undefined; // lazy instantiation failures degrade to key-based status
        }
      }),
    );

    return descriptors.map((descriptor, index) => {
      const hasKey = keys[index] ?? false;
      const isOmni = descriptor.id === 'omniroute';
      const health = healths[index];
      const statusTxt = this.statusLabel(health, hasKey, isOmni);
      const countTxt = descriptor.modelCountLabel === 'live' ? 'live' : `${descriptor.modelCountLabel} models`;
      const degraded = health !== undefined && health.status !== 'connected' && health.status !== 'not-configured';
      const healthyIcon = !degraded && (hasKey || isOmni);
      const item = new vscode.TreeItem(descriptor.displayName, vscode.TreeItemCollapsibleState.None) as ProviderTreeItem;

      item.providerId = descriptor.id;
      item.contextValue = 'provider';
      item.description = `${statusTxt}${health?.detail && degraded ? ` — ${health.detail}` : ''}  ·  ${countTxt}`;
      item.iconPath = new vscode.ThemeIcon(
        descriptor.treeIcon,
        new vscode.ThemeColor(healthyIcon ? 'testing.iconPassed' : 'testing.iconFailed'),
      );
      item.tooltip = this.providerTooltip(
        descriptor.displayName,
        hasKey,
        descriptor.modelCountLabel,
        statusTxt,
        health?.detail,
      );
      item.command = { command: 'copilot-amplify.provider.click', title: 'Open Provider', arguments: [item] };
      return item;
    });
  }

  /** Human-readable status line derived from live health when available. */
  private statusLabel(health: ProviderHealth | undefined, hasKey: boolean, isOmni: boolean): string {
    if (!health) {
      return isOmni
        ? hasKey ? '✓ Connected (Key)' : '○ Not configured (anonymous OK)'
        : hasKey ? '✓ Connected' : '⚠ Not configured';
    }
    switch (health.status) {
      case 'connected':
        return isOmni && !hasKey ? '✓ Connected (anonymous)' : '✓ Connected';
      case 'rate-limited':
        return '⚠ Rate limited';
      case 'auth-failed':
        return '✗ Auth failed';
      case 'error':
        return '✗ Error';
      case 'not-configured':
      default:
        return isOmni ? '○ Not configured (anonymous OK)' : '⚠ Not configured';
    }
  }

  private providerTooltip(brand: string, hasKey: boolean, modelCount: number | 'live', statusTxt?: string, detail?: string): vscode.MarkdownString {
    const statusMd = statusTxt ?? (hasKey ? '**Status:**  ✓ Connected' : '**Status:**  ⚠ Not configured');
    const countMd = modelCount === 'live'
      ? '**Models available:** Live (discovered from the server)'
      : `**Models available:** ${modelCount}`;
    const detailMd = detail ? `\n**Detail:** ${detail}\n` : '\n';
    const md = new vscode.MarkdownString(
      `### ${brand}\n\n**Status:**  ${statusMd}\n${countMd}\n${detailMd}\nRight-click the row to set API key, test connection, or clear key.`,
    );
    md.isTrusted = true;
    return md;
  }

  // ── MODELS section ─────────────────────────────────────────────────────────

  private getModelItems(): AnyTreeItem[] {
    return this.registry.list().map((descriptor) => {
      const countTxt = descriptor.modelCountLabel === 'live' ? 'live (cached)' : `${descriptor.modelCountLabel} models`;
      const header = new vscode.TreeItem(
        `${descriptor.displayName}  ·  ${countTxt}`,
        vscode.TreeItemCollapsibleState.Collapsed,
      ) as ModelGroupTreeItem;
      header.modelId = descriptor.id;
      header.contextValue = 'model-group';
      header.iconPath = new vscode.ThemeIcon(descriptor.treeIcon);
      header.description = descriptor.modelCountLabel === 'live'
        ? 'Cached models — use Refresh to re-discover'
        : `Click to see all ${descriptor.modelCountLabel} models`;
      header.tooltip = new vscode.MarkdownString(
        `**${descriptor.displayName}** — ${countTxt}.\n\nClick to expand and see model IDs.`,
      );
      return header;
    });
  }

  private async getModelsForProvider(providerId: ProviderId): Promise<ModelTreeItem[]> {
    let models: ProviderTreeModel[];
    try {
      models = await this.registry.provider(providerId).listModelsForTree();
    } catch {
      models = [];
    }
    const descriptor = this.registry.get(providerId);
    if (!descriptor) { return []; }

    if (models.length === 0 && descriptor.modelCountLabel === 'live') {
      const hint = new vscode.TreeItem('No cached models yet — run "Refresh Providers & Models"', vscode.TreeItemCollapsibleState.None) as ModelTreeItem;
      hint.modelId = '';
      hint.providerId = providerId;
      hint.contextValue = 'model';
      hint.iconPath = new vscode.ThemeIcon('info');
      hint.description = '';
      return [hint];
    }

    return models.map((model) => {
      const item = new vscode.TreeItem(model.name, vscode.TreeItemCollapsibleState.None) as ModelTreeItem;
      item.modelId = model.id;
      item.providerId = providerId;
      item.contextValue = 'model';

      const isSelected = this.activeProviderId === providerId && this.activeModelId === model.id;
      const isVision = Boolean(model.capabilities?.imageInput);
      const isTools = Boolean(model.capabilities?.toolCalling);
      const isReasoning = model.supportsReasoning === true;

      const badges: string[] = [];
      if (isVision) { badges.push('Vision'); }
      if (isTools) { badges.push('Tools'); }
      if (isReasoning) { badges.push('Reasoning'); }

      item.iconPath = new vscode.ThemeIcon(
        isSelected ? 'check' : isReasoning ? 'sparkle' : isVision ? 'eye' : 'symbol-method',
        isSelected ? new vscode.ThemeColor('testing.iconPassed') : undefined,
      );
      item.description = badges.length > 0
        ? `${model.id}  [${badges.join(', ')}]${isSelected ? '  ✓ Active' : ''}`
        : `${model.id}${isSelected ? '  ✓ Active' : ''}`;

      const limitsInfo = model.maxInputTokens
        ? `\n\n**Max Input:** ${model.maxInputTokens.toLocaleString()} tokens\n**Max Output:** ${(model.maxOutputTokens || 8192).toLocaleString()} tokens`
        : '';

      item.tooltip = new vscode.MarkdownString(
        `**${model.name}**\n\nModel ID: \`${model.id}\`\nProvider: ${descriptor.displayName}${badges.length > 0 ? `\nCapabilities: ${badges.join(', ')}` : ''}${limitsInfo}\n\nRight-click to pin this model.`,
      );
      item.command = {
        command: 'copilot-amplify.selectModel',
        title: 'Select Model',
        arguments: [item],
      };
      return item;
    });
  }

  // ── ACTIONS section ─────────────────────────────────────────────────────────

  private getActionItems(): ActionTreeItem[] {
    return ACTIONS.map((a) => {
      const item = new vscode.TreeItem(a.label, vscode.TreeItemCollapsibleState.None) as ActionTreeItem;
      item.actionId = a.id;
      item.contextValue = 'action';
      item.iconPath = new vscode.ThemeIcon(a.icon);
      item.tooltip = a.label;
      item.command = { command: a.command, title: a.label };
      return item;
    });
  }

  // ── Factory helpers ─────────────────────────────────────────────────────────

  private mkSection(sectionId: string, label: string, icon: string, collapsed: boolean): SectionTreeItem {
    const item = new vscode.TreeItem(
      label,
      collapsed
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded,
    ) as SectionTreeItem;
    item.sectionId = sectionId;
    item.contextValue = 'section';
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }
}
