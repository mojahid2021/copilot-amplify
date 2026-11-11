import * as vscode from 'vscode';
import type { AmplifyProviderDescriptor, ProviderHealth, ProviderId, ProviderRegistry, ProviderTreeModel } from '../core/provider/registry';
import type { NetworkQuality } from '../core/resilience/networkQuality';

/**
 * The "Providers & Models" sidebar.
 *
 *   Favorites            (only when something is pinned)
 *   Providers            (a provider row expands into its models)
 *
 * Without favorites the providers are shown at the top level. Rendering never
 * does network I/O: model lists come from what each provider has cached.
 * Tool actions (diagnostics, docs, …) live in the view's title bar.
 */

export interface ProviderTreeItem extends vscode.TreeItem {
  providerId: string;
  /** omniroute-provider adds server-URL actions to the menu. */
  contextValue: 'dynamic-provider' | 'omniroute-provider';
}

export interface SectionTreeItem extends vscode.TreeItem {
  sectionId: 'favorites' | 'providers';
  contextValue: 'section';
}

export interface ModelTreeItem extends vscode.TreeItem {
  modelId: string;
  providerId: string;
  contextValue: 'model' | 'favorite-model';
}

/** A one-line "what to do next" row shown when a provider has no models yet. */
interface HintTreeItem extends vscode.TreeItem {
  contextValue: 'hint';
}

type AnyTreeItem = ProviderTreeItem | SectionTreeItem | ModelTreeItem | HintTreeItem;

interface PinnedModel {
  providerId: string;
  modelId: string;
  name: string;
}

/** Health → short status shown next to the provider name. */
type Status = { text: string; color?: string; ready: boolean };

export class ProvidersTreeDataProvider implements vscode.TreeDataProvider<AnyTreeItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<AnyTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private pinnedModels: PinnedModel[] = [];
  private activeProviderId = '';
  private activeModelId = '';
  /** Whether each provider has a key; filled once, then kept current by key-change events. */
  private readonly apiKeyCache = new Map<string, boolean>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly context?: vscode.ExtensionContext,
  ) {
    if (context) {
      this.pinnedModels = context.globalState.get('pinnedModels', []);
      this.activeProviderId = context.globalState.get('activeProviderId', '');
      this.activeModelId = context.globalState.get('activeModelId', '');
    }
    for (const descriptor of registry.list()) {
      const auth = registry.auth(descriptor.id);
      this.disposables.push(
        auth.onDidChangeApiKey(async () => {
          this.apiKeyCache.set(descriptor.id, Boolean(await auth.getApiKey()));
          this.refresh();
        }),
      );
    }
  }

  dispose(): void {
    this.changeEmitter.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  setActiveModel(providerId: string, modelId: string, modelName: string): void {
    this.activeProviderId = providerId;
    this.activeModelId = modelId;
    void this.context?.globalState.update('activeProviderId', providerId);
    void this.context?.globalState.update('activeModelId', modelId);
    void this.context?.globalState.update('activeModelName', modelName);
    this.refresh();
  }

  pinModel(providerId: string, modelId: string, name: string): void {
    if (!this.pinnedModels.some((m) => m.providerId === providerId && m.modelId === modelId)) {
      this.pinnedModels.push({ providerId, modelId, name });
      this.savePinnedModels();
    }
  }

  unpinModel(providerId: string, modelId: string): void {
    this.pinnedModels = this.pinnedModels.filter((m) => !(m.providerId === providerId && m.modelId === modelId));
    this.savePinnedModels();
  }

  getTreeItem(element: AnyTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AnyTreeItem): Promise<AnyTreeItem[]> {
    if (!element) {
      return this.pinnedModels.length > 0
        ? [section('favorites', 'Favorites', 'star-full'), section('providers', 'Providers', 'layers')]
        : this.getProviderItems();
    }
    switch (element.contextValue) {
      case 'section':
        return element.sectionId === 'favorites' ? this.getFavoriteItems() : this.getProviderItems();
      case 'dynamic-provider':
      case 'omniroute-provider':
        return this.getModelItems(element.providerId as ProviderId);
      default:
        return [];
    }
  }

  private savePinnedModels(): void {
    void this.context?.globalState.update('pinnedModels', this.pinnedModels);
    this.refresh();
  }

  private isActive(providerId: string, modelId: string): boolean {
    return this.activeProviderId === providerId && this.activeModelId === modelId;
  }

  // ── Favorites ──

  private getFavoriteItems(): ModelTreeItem[] {
    return this.pinnedModels.map((fav) => {
      const item = new vscode.TreeItem(fav.name, vscode.TreeItemCollapsibleState.None) as ModelTreeItem;
      item.modelId = fav.modelId;
      item.providerId = fav.providerId;
      item.contextValue = 'favorite-model';
      const providerName = this.registry.get(fav.providerId as ProviderId)?.displayName ?? fav.providerId;
      item.description = this.isActive(fav.providerId, fav.modelId) ? `${providerName} · Selected` : providerName;
      item.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
      item.tooltip = `${fav.name} (${providerName})`;
      item.command = { command: 'copilot-amplify.selectModel', title: 'Select Model', arguments: [item] };
      return item;
    });
  }

  // ── Providers ──

  private async getProviderItems(): Promise<ProviderTreeItem[]> {
    const descriptors = this.registry.list();
    if (this.apiKeyCache.size === 0) {
      const keys = await Promise.all(descriptors.map((d) => this.registry.auth(d.id).getApiKey()));
      descriptors.forEach((d, i) => this.apiKeyCache.set(d.id, Boolean(keys[i])));
    }

    return descriptors.map((descriptor) => {
      const provider = this.registry.provider(descriptor.id);
      const health = provider.health();
      const status = statusOf(health, this.apiKeyCache.get(descriptor.id) ?? false, descriptor.id === 'omniroute');

      const item = new vscode.TreeItem(descriptor.displayName, vscode.TreeItemCollapsibleState.Collapsed) as ProviderTreeItem;
      item.providerId = descriptor.id;
      item.contextValue = descriptor.id === 'omniroute' ? 'omniroute-provider' : 'dynamic-provider';
      item.description = status.ready && health.detail ? `${status.text} · ${health.detail}` : status.text;
      item.iconPath = new vscode.ThemeIcon(descriptor.treeIcon, status.color ? new vscode.ThemeColor(status.color) : undefined);
      item.tooltip = providerTooltip(descriptor.displayName, status, health, provider.getNetworkQuality());
      item.command = { command: 'copilot-amplify.provider.click', title: 'Open Provider', arguments: [item] };
      return item;
    });
  }

  // ── Models ──

  private async getModelItems(providerId: ProviderId): Promise<AnyTreeItem[]> {
    const descriptor = this.registry.get(providerId);
    if (!descriptor) {
      return [];
    }
    const models = await this.registry.provider(providerId).listModelsForTree();
    if (models.length === 0) {
      return [this.hintFor(descriptor)];
    }
    return models.map((model) => this.modelItem(descriptor, model));
  }

  private modelItem(descriptor: AmplifyProviderDescriptor, model: ProviderTreeModel): ModelTreeItem {
    const item = new vscode.TreeItem(model.name, vscode.TreeItemCollapsibleState.None) as ModelTreeItem;
    item.modelId = model.id;
    item.providerId = descriptor.id;
    item.contextValue = 'model';

    const features = [
      model.capabilities?.imageInput && 'Vision',
      model.capabilities?.toolCalling && 'Tools',
      model.supportsReasoning && 'Reasoning',
    ].filter((f): f is string => Boolean(f));
    const selected = this.isActive(descriptor.id, model.id);

    item.description = [selected ? 'Selected' : '', ...features].filter(Boolean).join(' · ');
    item.iconPath = selected
      ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
      : new vscode.ThemeIcon(model.supportsReasoning ? 'sparkle' : 'symbol-method');

    const lines = [`**${model.name}**`, '', `Model ID: \`${model.id}\``, `Provider: ${descriptor.displayName}`];
    if (features.length > 0) {
      lines.push(`Features: ${features.join(', ')}`);
    }
    if (model.maxInputTokens) {
      lines.push(`Context: ${formatTokens(model.maxInputTokens)} input · ${formatTokens(model.maxOutputTokens ?? 8192)} output`);
    }
    item.tooltip = new vscode.MarkdownString(lines.join('  \n'));
    item.command = { command: 'copilot-amplify.selectModel', title: 'Select Model', arguments: [item] };
    return item;
  }

  /** What the user should do next when a provider shows no models. Clicking the row does it. */
  private hintFor(descriptor: AmplifyProviderDescriptor): HintTreeItem {
    const target = { providerId: descriptor.id };
    const needsUrl = this.registry.provider(descriptor.id).health().status === 'setup-required';
    const needsKey = descriptor.id !== 'omniroute' && !this.apiKeyCache.get(descriptor.id);

    const [label, icon, command]: [string, string, vscode.Command | undefined] =
      needsUrl ? ['Set the server URL to get started', 'link', { command: 'copilot-amplify.CA-omniroute.editBaseUrl', title: '' }]
      : needsKey ? ['Add an API key to get started', 'key', { command: 'copilot-amplify.setApiKey', title: '', arguments: [target] }]
      : ['Load models from the server', 'cloud-download', { command: 'copilot-amplify.loadModels', title: '', arguments: [target] }];

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None) as HintTreeItem;
    item.contextValue = 'hint';
    item.iconPath = new vscode.ThemeIcon(icon);
    item.command = command;
    return item;
  }
}

function section(sectionId: SectionTreeItem['sectionId'], label: string, icon: string): SectionTreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded) as SectionTreeItem;
  item.sectionId = sectionId;
  item.contextValue = 'section';
  item.iconPath = new vscode.ThemeIcon(icon);
  return item;
}

function statusOf(health: ProviderHealth, hasKey: boolean, keyOptional: boolean): Status {
  switch (health.status) {
    case 'connected':
      return { text: 'Connected', color: 'testing.iconPassed', ready: true };
    case 'rate-limited':
      return { text: 'Rate limited', color: 'list.warningForeground', ready: true };
    case 'auth-failed':
      return { text: 'API key rejected', color: 'list.errorForeground', ready: false };
    case 'error':
      return { text: 'Connection problem', color: 'list.errorForeground', ready: false };
    case 'setup-required':
      return { text: 'Server URL needed', color: 'list.warningForeground', ready: false };
    case 'not-configured':
      // Nothing sent or tested yet: readiness depends only on the key.
      return hasKey || keyOptional
        ? { text: 'Ready', ready: true }
        : { text: 'API key needed', color: 'list.warningForeground', ready: false };
  }
}

function providerTooltip(name: string, status: Status, health: ProviderHealth, quality: NetworkQuality): vscode.MarkdownString {
  const lines = [`**${name}**`, '', `Status: ${status.text}`, 'Models: loaded from the server with Load Models, and kept between sessions'];
  if (health.detail && !status.ready) {
    lines.push(`Details: ${health.detail}`);
  }
  if (quality.sampleCount > 0) {
    lines.push(
      `Network: ${quality.avgLatencyMs} ms to first token · ${Math.round(quality.errorRate * 100)}% errors (last ${quality.sampleCount} requests)`,
    );
  }
  lines.push('', 'Expand to see models. Right-click for more actions.');
  return new vscode.MarkdownString(lines.join('  \n'));
}

/** 128000 → "128K", 1048576 → "1M". */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${+(tokens / 1_000_000).toFixed(1)}M`;
  }
  return tokens >= 1_000 ? `${Math.round(tokens / 1_000)}K` : String(tokens);
}
