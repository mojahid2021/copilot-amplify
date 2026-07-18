import * as vscode from 'vscode';
import type { BaseAuthManager } from './baseAuth';
import {
  MIMO_MODELS,
  GLM_MODELS,
  GROQ_MODELS,
  NIM_MODELS,
} from './models';

// ─── Provider metadata ───────────────────────────────────────────────────────

interface ProviderMeta {
  brand:     string;
  modelCount: number;
  icon:      string;
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  xiaomi: { brand: 'Xiaomi MiMo', modelCount: MIMO_MODELS.length, icon: 'device-mobile' },
  glm:    { brand: 'Z.ai GLM',    modelCount: GLM_MODELS.length,  icon: 'hubot'         },
  groq:   { brand: 'Groq',        modelCount: GROQ_MODELS.length, icon: 'rocket'        },
  nvidia: { brand: 'NVIDIA NIM',   modelCount: NIM_MODELS.length,  icon: 'server'        },
};

// ─── Tree item interfaces ────────────────────────────────────────────────────

export interface ProviderTreeItem extends vscode.TreeItem {
  providerId:   string;
  contextValue: 'provider';
}

export interface SectionTreeItem extends vscode.TreeItem {
  sectionId:    string;
  contextValue: 'section';
}

export interface ModelGroupTreeItem extends vscode.TreeItem {
  modelId:      string;
  contextValue: 'model-group';
}

export interface ModelTreeItem extends vscode.TreeItem {
  modelId:      string;
  contextValue: 'model';
}

export interface ActionTreeItem extends vscode.TreeItem {
  actionId:     string;
  contextValue: 'action';
}

type AnyTreeItem = ProviderTreeItem | SectionTreeItem | ModelGroupTreeItem | ModelTreeItem | ActionTreeItem;

// ─── Action catalogue ────────────────────────────────────────────────────────

const ACTIONS = [
  { id: 'manage', label: 'Manage Providers...', icon: 'wrench', command: 'copilot-amplify.manage' },
];

// ─── Tree data provider ───────────────────────────────────────────────────────

export class ProvidersTreeDataProvider implements vscode.TreeDataProvider<AnyTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AnyTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly xiaomiAuth: BaseAuthManager,
    private readonly glmAuth:    BaseAuthManager,
    private readonly groqAuth:   BaseAuthManager,
    private readonly nvidiaAuth: BaseAuthManager,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
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
      return this.getModelsForProvider((element as ModelGroupTreeItem).modelId);
    }
    return [];
  }

  private getRootSections(): SectionTreeItem[] {
    return [
      this.mkSection('providers', 'PROVIDERS', 'layers',    false),
      this.mkSection('models',    'MODELS',    'list-tree', true),
      this.mkSection('actions',   'ACTIONS',   'zap',       true),
    ];
  }

  private getSectionChildren(sectionId: string): vscode.ProviderResult<AnyTreeItem[]> {
    switch (sectionId) {
      case 'providers': return this.getProviderItems();
      case 'models':    return this.getModelItems();
      case 'actions':   return this.getActionItems();
      default:         return [];
    }
  }

  // ── PROVIDERS section ───────────────────────────────────────────────────────

  private async getProviderItems(): Promise<ProviderTreeItem[]> {
    const [k1, k2, k3, k4] = await Promise.all([
      this.xiaomiAuth.getApiKey(),
      this.glmAuth.getApiKey(),
      this.groqAuth.getApiKey(),
      this.nvidiaAuth.getApiKey(),
    ]);
    return [
      this.mkProviderItem('xiaomi', Boolean(k1)),
      this.mkProviderItem('glm',    Boolean(k2)),
      this.mkProviderItem('groq',   Boolean(k3)),
      this.mkProviderItem('nvidia', Boolean(k4)),
    ];
  }

  private mkProviderItem(id: string, hasKey: boolean): ProviderTreeItem {
    const meta      = PROVIDER_META[id];
    const statusTxt = hasKey ? '✓ Connected' : '⚠ Not configured';
    const item      = new vscode.TreeItem(meta.brand, vscode.TreeItemCollapsibleState.None) as ProviderTreeItem;

    item.providerId   = id;
    item.contextValue = 'provider';
    item.description  = `${statusTxt}  ·  ${meta.modelCount} models`;
    item.iconPath     = new vscode.ThemeIcon(meta.icon, new vscode.ThemeColor(hasKey ? 'testing.iconPassed' : 'testing.iconFailed'));
    item.tooltip      = this.providerTooltip(meta.brand, hasKey, meta.modelCount);
    item.command      = { command: 'copilot-amplify.provider.click', title: 'Open Provider', arguments: [item] };
    return item;
  }

  private providerTooltip(brand: string, hasKey: boolean, modelCount: number): vscode.MarkdownString {
    const statusMd = hasKey
      ? '**Status:**  ✓ Connected'
      : '**Status:**  ⚠ Not configured';
    const md = new vscode.MarkdownString(
      `### ${brand}\n\n${statusMd}\n**Models available:** ${modelCount}\n\nRight-click the row to set API key, test connection, or clear key.`,
    );
    md.isTrusted = true;
    return md;
  }

  // ── MODELS section ─────────────────────────────────────────────────────────

  private getModelItems(): AnyTreeItem[] {
    return Object.entries(PROVIDER_META).map(([id, meta]) => {
      const header = new vscode.TreeItem(
        `${meta.brand}  ·  ${meta.modelCount} models`,
        vscode.TreeItemCollapsibleState.Collapsed,
      ) as ModelGroupTreeItem;
      header.modelId      = id;
      header.contextValue = 'model-group';
      header.iconPath     = new vscode.ThemeIcon(meta.icon);
      header.description  = `Click to see all ${meta.modelCount} models`;
      header.tooltip      = new vscode.MarkdownString(
        `**${meta.brand}** — ${meta.modelCount} models available.\n\nClick to expand and see all model IDs.`,
      );
      return header;
    });
  }

  private getModelsForProvider(providerId: string): ModelTreeItem[] {
    const models = this.getModelListForProvider(providerId);
    const meta   = PROVIDER_META[providerId];
    if (!meta) { return []; }
    return models.map((model) => {
      const item = new vscode.TreeItem(model.name, vscode.TreeItemCollapsibleState.None) as ModelTreeItem;
      item.modelId      = model.id;
      item.contextValue = 'model';
      item.iconPath     = new vscode.ThemeIcon('symbol-method');
      item.description  = model.id;
      item.tooltip      = new vscode.MarkdownString(
        `**${model.name}**\n\nModel ID: \`${model.id}\`\nProvider: ${meta.brand}`,
      );
      return item;
    });
  }

  private getModelListForProvider(providerId: string): Array<{ id: string; name: string }> {
    switch (providerId) {
      case 'xiaomi': return MIMO_MODELS.map((m) => ({ id: m.id, name: m.name }));
      case 'glm':    return GLM_MODELS.map((m) => ({ id: m.id, name: m.name }));
      case 'groq':   return GROQ_MODELS.map((m) => ({ id: m.id, name: m.name }));
      case 'nvidia': return NIM_MODELS.map((m) => ({ id: m.id, name: m.name }));
      default:       return [];
    }
  }

  // ── ACTIONS section ─────────────────────────────────────────────────────────

  private getActionItems(): ActionTreeItem[] {
    return ACTIONS.map((a) => {
      const item = new vscode.TreeItem(a.label, vscode.TreeItemCollapsibleState.None) as ActionTreeItem;
      item.actionId     = a.id;
      item.contextValue = 'action';
      item.iconPath     = new vscode.ThemeIcon(a.icon);
      item.tooltip      = 'Open a dialog to manage any provider';
      item.command      = { command: a.command, title: a.label };
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
    item.sectionId    = sectionId;
    item.contextValue = 'section';
    item.iconPath     = new vscode.ThemeIcon(icon);
    return item;
  }
}
