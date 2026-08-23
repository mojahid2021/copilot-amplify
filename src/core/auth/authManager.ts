import * as vscode from 'vscode';

/**
 * SecretStorage-backed credential management for one provider.
 *
 * Keys live exclusively in VS Code's secret store — never in settings.json.
 * A legacy key name can be provided for backwards compatibility; on first
 * successful read the legacy value is migrated to the current key and the
 * legacy entry removed.
 */
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
        // One-time migration: copy to current key, drop legacy entry.
        try {
          await this.secrets.store(this.secretKey, legacyKey);
          await this.secrets.delete(this.legacySecretKey);
        } catch {
          /* storage failures must not break request paths */
        }
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

  /**
   * Prompt the user for an API key and persist it.
   * Resolves undefined when dismissed.
   */
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

  hasApiKey(): Thenable<boolean> {
    return this.secrets.get(this.secretKey).then((key) => key !== undefined || (this.legacySecretKey !== undefined ? this.secrets.get(this.legacySecretKey).then((legacy) => legacy !== undefined) : false));
  }
}
