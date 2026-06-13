import * as vscode from 'vscode';
import type { BaseAuthManager } from './baseAuth';

export interface ProviderTreeItem extends vscode.TreeItem {
  providerId: string;
  contextValue: 'provider';
}

export interface ModelTreeItem extends vscode.TreeItem {
  modelId: string;
  contextValue: 'model';
}

export interface SectionHeaderItem extends vscode.TreeItem {
  sectionId: string;
  contextValue: 'section';
}

export interface ActionTreeItem extends vscode.TreeItem {
  actionId: string;
  contextValue: 'action';
}

type TreeItem = ProviderTreeItem | ModelTreeItem | SectionHeaderItem | ActionTreeItem;

export class ProvidersTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly xiaomiAuth: BaseAuthManager;
  private readonly glmAuth: BaseAuthManager;
  private readonly groqAuth: BaseAuthManager;
  private readonly nvidiaAuth: BaseAuthManager;

  private readonly PROVIDERS_COLLAPSED = false;
  private readonly MODELS_COLLAPSED = true;
  private readonly ACTIONS_COLLAPSED = true;

  constructor(
    xiaomiAuth: BaseAuthManager,
    glmAuth: BaseAuthManager,
    groqAuth: BaseAuthManager,
    nvidiaAuth: BaseAuthManager,
  ) {
    this.xiaomiAuth = xiaomiAuth;
    this.glmAuth = glmAuth;
    this.groqAuth = groqAuth;
    this.nvidiaAuth = nvidiaAuth;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): vscode.ProviderResult<TreeItem[]> {
    if (!element) {
      return this.getRootItems();
    }

    if (element.contextValue === 'section') {
      return this.getSectionChildren(element.sectionId);
    }

    return [];
  }

  private getRootItems(): SectionHeaderItem[] {
    return [
      this.createSectionHeader('PROVIDERS', 'providers-section', !this.PROVIDERS_COLLAPSED),
      this.createSectionHeader('MODELS', 'models-section', !this.MODELS_COLLAPSED),
      this.createSectionHeader('ACTIONS', 'actions-section', !this.ACTIONS_COLLAPSED),
    ];
  }

  private getSectionChildren(sectionId: string): vscode.ProviderResult<TreeItem[]> {
    switch (sectionId) {
      case 'providers-section':
        return this.getProviderItems();
      case 'models-section':
        return this.getModelItems();
      case 'actions-section':
        return this.getActionItems();
      default:
        return [];
    }
  }

  private async getProviderItems(): Promise<ProviderTreeItem[]> {
    const xiaomiKey = await this.xiaomiAuth.getApiKey();
    const glmKey = await this.glmAuth.getApiKey();
    const groqKey = await this.groqAuth.getApiKey();
    const nvidiaKey = await this.nvidiaAuth.getApiKey();

    return [
      this.createProviderItem('xiaomi', 'Xiaomi MiMo', 'mimo-v2-flash', !!xiaomiKey),
      this.createProviderItem('glm', 'Z.ai GLM', 'glm-4.7-flash', !!glmKey),
      this.createProviderItem('groq', 'Groq', 'llama-3.3-70b-versatile', !!groqKey),
      this.createProviderItem('nvidia', 'NVIDIA NIM', 'google/gemma-4-31b-it', !!nvidiaKey),
    ];
  }

  private getModelItems(): ModelTreeItem[] {
    return [
      this.createModelItem('xiaomi-mimo', 'Xiaomi MiMo', 'mimo-v2-flash'),
      this.createModelItem('glm-4', 'Z.ai GLM', 'glm-4.7-flash'),
      this.createModelItem('groq-llama', 'Groq', 'llama-3.3-70b-versatile'),
      this.createModelItem('nvidia-gemma', 'NVIDIA NIM', 'google/gemma-4-31b-it'),
    ];
  }

  private getActionItems(): ActionTreeItem[] {
    return [
      this.createActionItem('refresh', 'Refresh', '$(sync~spin)'),
      this.createActionItem('manage', 'Manage Providers...', '$(wrench)'),
      this.createActionItem('documentation', 'View Documentation', '$(book)'),
      this.createActionItem('report', 'Report Issue', '$(bug)'),
    ];
  }

  private createSectionHeader(id: string, sectionId: string, expanded: boolean): SectionHeaderItem {
    const item = new vscode.TreeItem(id, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) as SectionHeaderItem;
    item.sectionId = sectionId;
    item.contextValue = 'section';
    item.iconPath = new vscode.ThemeIcon('$(symbol-parameter)');
    item.description = '';
    return item;
  }

  private createProviderItem(providerId: string, displayName: string, defaultModel: string, hasKey: boolean): ProviderTreeItem {
    const statusIcon = hasKey ? '$(check~gutter)' : '$(warning~gutter)';
    const statusText = hasKey ? 'Configured' : 'Not configured';
    const description = `${statusText} • ${defaultModel}`;

    const item = new vscode.TreeItem(displayName, vscode.TreeItemCollapsibleState.None) as ProviderTreeItem;
    item.providerId = providerId;
    item.contextValue = 'provider';
    item.iconPath = new vscode.ThemeIcon(statusIcon);
    item.description = description;
    item.tooltip = new vscode.MarkdownString(`**${displayName}**\n\nStatus: ${statusText}\nDefault model: ${defaultModel}\n\n**Actions:**\n- Right-click for options`);
    item.command = {
      command: 'copilot-amplify.provider.click',
      title: 'Open Provider',
      arguments: [item],
    };
    return item;
  }

  private createModelItem(modelId: string, providerName: string, modelName: string): ModelTreeItem {
    const item = new vscode.TreeItem(modelName, vscode.TreeItemCollapsibleState.None) as ModelTreeItem;
    item.modelId = modelId;
    item.contextValue = 'model';
    item.iconPath = new vscode.ThemeIcon('$(symbol-method)');
    item.description = providerName;
    item.tooltip = new vscode.MarkdownString(`**${modelName}**\n\nProvider: ${providerName}`);
    return item;
  }

  private createActionItem(actionId: string, label: string, icon: string): ActionTreeItem {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None) as ActionTreeItem;
    item.actionId = actionId;
    item.contextValue = 'action';
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }
}
