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

  /**
   * Cached value of the most recent `getApiKey()` lookup. Hot-path chat
   * requests can satisfy the lookup without two `secrets.get` round trips
   * per call. Cleared whenever the key is mutated.
   */
  private cachedKey?: string;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly secretKey: string,
    private readonly displayName: string,
    private readonly legacySecretKey?: string,
  ) { }

  dispose(): void {
    this.onDidChangeApiKeyEmitter.dispose();
    this.cachedKey = undefined;
  }

  async getApiKey(): Promise<string | undefined> {
    // Hot path: most chat calls arrive in quick succession and the same
    // key keeps being used. Cache avoids two `secrets.get` reads per call.
    if (this.cachedKey !== undefined) {
      return this.cachedKey;
    }
    const key = await this.secrets.get(this.secretKey);
    if (key) {
      this.cachedKey = key;
      return key;
    }
    if (this.legacySecretKey) {
      const legacyKey = await this.secrets.get(this.legacySecretKey);
      if (legacyKey) {
        // One-time migration: copy to current key, drop legacy entry.
        // The migration happens on the first read after activation; reads
        // made BEFORE this branch (because the cache is empty) are rare.
        try {
          await this.secrets.store(this.secretKey, legacyKey);
          await this.secrets.delete(this.legacySecretKey);
        } catch {
          /* storage failures must not break request paths */
        }
        this.cachedKey = legacyKey;
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
    this.cachedKey = undefined;
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
    this.cachedKey = key;
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
