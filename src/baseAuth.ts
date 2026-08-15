import * as vscode from 'vscode';

export class BaseAuthManager implements vscode.Disposable {
  private readonly onDidChangeApiKeyEmitter = new vscode.EventEmitter<void>();

  readonly onDidChangeApiKey = this.onDidChangeApiKeyEmitter.event;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly secretKey: string,
    private readonly displayName: string,
    private readonly legacySecretKey?: string,
  ) { }

  dispose(): void {
    this.onDidChangeApiKeyEmitter.dispose();
  }

  async getApiKey(): Promise<string | undefined> {
    const key = await this.secrets.get(this.secretKey);
    if (key) {
      return key;
    }
    if (this.legacySecretKey) {
      const legacyKey = await this.secrets.get(this.legacySecretKey);
      if (legacyKey) {
        return legacyKey;
      }
    }

    return undefined;
  }

  async deleteApiKey(): Promise<void> {
    const deletions = [this.secrets.delete(this.secretKey)];
    if (this.legacySecretKey) {
      deletions.push(this.secrets.delete(this.legacySecretKey));
    }
    await Promise.all(deletions);
    this.onDidChangeApiKeyEmitter.fire();
  }

  async promptForApiKey(): Promise<string | undefined> {
    const input = await vscode.window.showInputBox({
      prompt: `Enter your ${this.displayName} API Key`,
      password: true,
      placeHolder: 'your-api-key',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return 'API key cannot be empty';
        }
        return undefined;
      },
    });

    if (!input) {
      return undefined;
    }

    const key = input.trim();
    await this.secrets.store(this.secretKey, key);
    this.onDidChangeApiKeyEmitter.fire();
    vscode.window.showInformationMessage(`${this.displayName} API key saved successfully`);
    return key;
  }

  async getOrPromptApiKey(): Promise<string | undefined> {
    return (await this.getApiKey()) ?? this.promptForApiKey();
  }
}
