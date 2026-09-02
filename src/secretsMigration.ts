import * as vscode from 'vscode';
import { logger } from './core/logging/logger';

/**
 * One-time migration of legacy plaintext API-key settings into SecretStorage.
 *
 * Versions < 2.0.0 documented `copilot-amplify.<provider>.apiKey` settings.
 * The runtime never read them (it always used SecretStorage), but values users
 * typed into settings.json were silently ignored — and sat in plaintext on
 * disk. This migration moves any such value into SecretStorage so it finally
 * takes effect, then removes the plaintext entry.
 */

const log = logger.child({ component: 'secrets-migration' });

/**
 * Legacy plaintext API-key settings (pre-2.2.0) are migrated into the
 * prefixed secret keys. The `setting` field is the (no-longer-registered)
 * plaintext location; the `secretKey` is the new prefixed SecretStorage
 * location. After 2.2.0 the runtime never reads `copilot-amplify.<provider>.apiKey`
 * — only the prefixed variant.
 */
const LEGACY_KEYS: ReadonlyArray<{ setting: string; secretKey: string; provider: string }> = [
  { setting: 'copilot-amplify.xiaomi.apiKey', secretKey: 'copilot-amplify.CA-xiaomi.apiKey', provider: 'Xiaomi MiMo' },
  { setting: 'copilot-amplify.glm.apiKey', secretKey: 'copilot-amplify.CA-glm.apiKey', provider: 'Z.ai GLM' },
  { setting: 'copilot-amplify.groq.apiKey', secretKey: 'copilot-amplify.CA-groq.apiKey', provider: 'Groq' },
  { setting: 'copilot-amplify.nvidia.apiKey', secretKey: 'copilot-amplify.CA-nvidia.apiKey', provider: 'NVIDIA NIM' },
  { setting: 'copilot-amplify.CA-omniroute.apiKey', secretKey: 'copilot-amplify.CA-omniroute.apiKey', provider: 'OmniRoute' },
  { setting: 'copilot-amplify.CA-agentrouter.apiKey', secretKey: 'copilot-amplify.CA-agentrouter.apiKey', provider: 'AgentRouter' },
];

export interface MigrationResult {
  migratedProviders: string[];
}

/**
 * Migrate every plaintext key found. Idempotent: keys already present in
 * SecretStorage win, and the plaintext value is cleared either way.
 */
export async function migratePlaintextApiKeys(context: vscode.ExtensionContext): Promise<MigrationResult> {
  const migratedProviders: string[] = [];
  const config = vscode.workspace.getConfiguration('copilot-amplify');

  for (const entry of LEGACY_KEYS) {
    try {
      const inspection = config.inspect<string>(entry.setting);
      const plaintext =
        inspection?.globalValue ?? inspection?.workspaceValue ?? inspection?.workspaceFolderValue;
      if (!plaintext || plaintext.trim().length === 0) {
        continue;
      }

      const existingSecret = await context.secrets.get(entry.secretKey);
      if (!existingSecret) {
        await context.secrets.store(entry.secretKey, plaintext.trim());
        migratedProviders.push(entry.provider);
        log.info(`migrated plaintext API key for ${entry.provider} into SecretStorage`);
      } else {
        log.info(`plaintext API key for ${entry.provider} ignored (SecretStorage already set)`);
      }

      // Remove from every scope we can touch (global + workspace).
      await config.update(entry.setting, undefined, vscode.ConfigurationTarget.Global);
      if (inspection?.workspaceValue !== undefined) {
        await config.update(entry.setting, undefined, vscode.ConfigurationTarget.Workspace);
      }
    } catch (error) {
      // Never block activation on migration issues.
      log.warn(`migration failed for ${entry.provider}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { migratedProviders };
}
