import * as vscode from 'vscode';
import type { ProviderRegistry, ProviderTreeModel } from '../core/provider/registry';
import type { ProviderHealth, ProviderId } from '../core/provider/registry';

/**
 * Providers & Models tree.
 *
 * Structure:
 *   FAVORITES (if any pinned models)
 *   PROVIDERS  — each provider row is collapsible; expanding shows its models
 *   ACTIONS
 *
 * Model lists come from each provider's cached data — expanding never triggers
 * network I/O. Dynamic providers (OmniRoute, AgentRouter) show a "Not loaded"
 * hint when no models have been fetched yet; use the ↓ Load Models inline button.
 */

// ─── Tree item interfaces ────────────────────────────────────────────────────

export interface ProviderTreeItem extends vscode.TreeItem {
  providerId: string;
  contextValue: 'provider' | 'dynamic-provider' | 'omniroute-provider';
}

export interface SectionTreeItem extends vscode.TreeItem {
  sectionId: string;
  contextValue: 'section';
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

type AnyTreeItem = ProviderTreeItem | SectionTreeItem | ModelTreeItem | ActionTreeItem;

// ─── Action catalogue ────────────────────────────────────────────────────────

const ACTIONS = [
  { id: 'refresh', label: 'Refresh Providers & Models', icon: 'sync', command: 'copilot-amplify.refresh' },
  { id: 'diagnostics', label: 'Show Diagnostics', icon: 'pulse', command: 'copilot-amplify.showDiagnostics' },
  { id: 'docs', label: 'View Documentation & Guide', icon: 'book', command: 'copilot-amplify.documentation' },
  { id: 'report', label: 'Report Issue or Feedback', icon: 'bug', command: 'copilot-amplify.report' },
];

// Actions that live under the OmniRoute provider row when expanded (not in global ACTIONS).
const OMNIROUTE_ACTIONS = [
  { id: 'omniroute-diagnostics', label: 'Show OmniRoute Diagnostics', icon: 'pulse', command: 'copilot-amplify.CA-omniroute.showDiagnostics' },
  { id: 'telemetry', label: 'Show Telemetry Logs', icon: 'output', command: 'copilot-amplify.CA-omniroute.showTelemetry' },
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
  private readonly apiKeyCache = new Map<string, boolean>();
  private readonly _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly context?: vscode.ExtensionContext,
  ) {
    if (this.context) {
      this.pinnedModels = this.context.globalState.get('pinnedModels', []);
      this.activeProviderId = this.context.globalState.get('activeProviderId', 'xiaomi');
      this.activeModelId = this.context.globalState.get('activeModelId', '');
    }
    for (const descriptor of registry.list()) {
      this._disposables.push(
        registry.auth(descriptor.id).onDidChangeApiKey(async () => {
          const key = await registry.auth(descriptor.id).getApiKey();
          this.apiKeyCache.set(descriptor.id, Boolean(key));
          this.refresh();
        }),
      );
    }
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    for (const d of this._disposables) d.dispose();
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
    this.pinnedModels = this.pinnedModels.filter(
      (m) => !(m.providerId === providerId && m.modelId === modelId),
    );
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
    if (element.contextValue === 'provider' || element.contextValue === 'dynamic-provider' || element.contextValue === 'omniroute-provider') {
      return this.getModelsForProvider((element as ProviderTreeItem).providerId as ProviderId);
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
      this.mkSection('actions', 'ACTIONS', 'zap', true),
    );
    return sections;
  }

  private getSectionChildren(sectionId: string): vscode.ProviderResult<AnyTreeItem[]> {
    switch (sectionId) {
      case 'favorites': return this.getFavoriteItems();
      case 'providers': return this.getProviderItems();
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

    // Populate key cache on first render (one IPC pass, then served synchronously).
    if (this.apiKeyCache.size === 0) {
      const entries = await Promise.all(
        descriptors.map(async (d) => [d.id, Boolean(await this.registry.auth(d.id).getApiKey())] as const),
      );
      for (const [id, hasKey] of entries) this.apiKeyCache.set(id, hasKey);
    }

    const healths = await Promise.all(
      descriptors.map(async (d) => {
        try {
          return this.registry.provider(d.id).health();
        } catch {
          return undefined;
        }
      }),
    );

    return descriptors.map((descriptor, index) => {
      const hasKey = this.apiKeyCache.get(descriptor.id) ?? false;
      const isDynamic = descriptor.modelCountLabel === 'live';
      // OmniRoute supports anonymous access — no key warning needed
      const anonymousOk = descriptor.id === 'omniroute';
      const health = healths[index];
      const degraded = health !== undefined
        && health.status !== 'connected'
        && health.status !== 'not-configured'
        && health.status !== 'setup-required';
      const statusTxt = this.statusLabel(health, hasKey, anonymousOk);

      // For dynamic providers: show count when connected, "Not loaded" otherwise.
      // Don't reuse health.detail when it's an error message (degraded) to avoid
      // printing the same text twice in the description.
      const countTxt = isDynamic
        ? (degraded ? 'Not loaded' : (health?.detail ?? 'Not loaded'))
        : `${descriptor.modelCountLabel} models`;

      const healthyIcon = !degraded && (hasKey || anonymousOk);

      // Collapsible: click arrow to browse models; inline buttons act on the row.
      const item = new vscode.TreeItem(
        descriptor.displayName,
        vscode.TreeItemCollapsibleState.Collapsed,
      ) as ProviderTreeItem;

      // Warning badge: shown only when a key is actually required and missing.
      // @ts-ignore TreeItemBadge not exported in current @types/vscode version; runtime supports it
      item.badge = (hasKey || anonymousOk) ? undefined : {
        value: '⚠',
        tooltip: 'No API key — click the row to set one',
      };

      item.providerId = descriptor.id;
      item.contextValue = descriptor.id === 'omniroute' ? 'omniroute-provider' : isDynamic ? 'dynamic-provider' : 'provider';
      item.description = `${statusTxt}${health?.detail && degraded ? ` — ${health.detail}` : ''}  ·  ${countTxt}`;
      item.iconPath = new vscode.ThemeIcon(
        descriptor.treeIcon,
        new vscode.ThemeColor(healthyIcon ? 'testing.iconPassed' : 'testing.iconFailed'),
      );
      item.tooltip = this.providerTooltip(descriptor.displayName, hasKey, descriptor.modelCountLabel, statusTxt, health?.detail);
      item.command = { command: 'copilot-amplify.provider.click', title: 'Open Provider', arguments: [item] };
      return item;
    });
  }

  private statusLabel(health: ProviderHealth | undefined, hasKey: boolean, anonymousOk: boolean): string {
    if (!health) {
      return anonymousOk
        ? (hasKey ? '✓ Ready (key set)' : '○ Ready (anonymous)')
        : (hasKey ? '✓ Ready' : '⚠ No API key');
    }
    switch (health.status) {
      case 'connected':      return anonymousOk && !hasKey ? '✓ Connected (anonymous)' : '✓ Connected';
      case 'rate-limited':   return '⚠ Rate limited';
      case 'auth-failed':    return '✗ Auth failed';
      case 'error':          return '✗ Error';
      case 'setup-required': return '⚠ No server URL';
      case 'not-configured':
      default:
        return anonymousOk ? '○ Ready (anonymous)' : '⚠ No API key';
    }
  }

  private providerTooltip(
    brand: string,
    hasKey: boolean,
    modelCount: number | 'live',
    statusTxt: string,
    detail?: string,
  ): vscode.MarkdownString {
    const countMd = modelCount === 'live'
      ? '**Models:** discovered at runtime (click ↓ to load)'
      : `**Models:** ${modelCount} built-in`;
    const detailMd = detail ? `\n**Detail:** ${detail}\n` : '\n';
    const md = new vscode.MarkdownString(
      `### ${brand}\n\n**Status:** ${statusTxt}\n${countMd}\n${detailMd}\nExpand to browse models. Right-click for key / connection actions.`,
    );
    md.isTrusted = true;
    return md;
  }

  // ── Model rows (children of a provider item) ────────────────────────────────

  private async getModelsForProvider(providerId: ProviderId): Promise<(ModelTreeItem | ActionTreeItem)[]> {
    let models: ProviderTreeModel[];
    try {
      models = await this.registry.provider(providerId).listModelsForTree();
    } catch {
      models = [];
    }
    const descriptor = this.registry.get(providerId);
    if (!descriptor) { return []; }

    // Provider-specific management actions appended after models.
    const providerActionItems: ActionTreeItem[] = providerId === 'omniroute'
      ? OMNIROUTE_ACTIONS.map((a) => {
          const item = new vscode.TreeItem(a.label, vscode.TreeItemCollapsibleState.None) as ActionTreeItem;
          item.actionId = a.id;
          item.contextValue = 'action';
          item.iconPath = new vscode.ThemeIcon(a.icon);
          item.tooltip = a.label;
          item.command = { command: a.command, title: a.label };
          return item;
        })
      : [];

    if (models.length === 0) {
      const isDynamic = descriptor.modelCountLabel === 'live';
      const hasKey = this.apiKeyCache.get(providerId) ?? false;
      const needsKey = providerId !== 'omniroute' && !hasKey;

      let providerHealth: import('../core/provider/registry').ProviderHealth | undefined;
      try { providerHealth = this.registry.provider(providerId).health(); } catch { /* not yet instantiated */ }
      const needsUrl = providerHealth?.status === 'setup-required';

      let hintText: string;
      let hintIcon: string;
      if (isDynamic) {
        if (needsUrl) {
          hintText = 'Set server URL first — click the row to configure';
          hintIcon = 'warning';
        } else if (needsKey) {
          hintText = 'Set an API key first, then click ↓ Load Models';
          hintIcon = 'warning';
        } else {
          hintText = 'No models loaded — click ↓ Load Models';
          hintIcon = 'info';
        }
      } else {
        hintText = 'No models available';
        hintIcon = 'info';
      }

      const hint = new vscode.TreeItem(hintText, vscode.TreeItemCollapsibleState.None) as ModelTreeItem;
      hint.modelId = '';
      hint.providerId = providerId;
      hint.contextValue = 'model';
      hint.iconPath = new vscode.ThemeIcon(hintIcon);
      hint.description = '';
      return [hint, ...providerActionItems];
    }

    const modelItems = models.map((model) => {
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

    return [...modelItems, ...providerActionItems];
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
      collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
    ) as SectionTreeItem;
    item.sectionId = sectionId;
    item.contextValue = 'section';
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }
}
