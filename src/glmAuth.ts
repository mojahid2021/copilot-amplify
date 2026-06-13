import * as vscode from 'vscode';
import { BaseAuthManager } from './baseAuth';

const API_KEY_SECRET_KEY = 'copilot-amplify.glm.apiKey';
const LEGACY_API_KEY_SECRET_KEY = 'glm-chat-provider.apiKey';

export class GlmAuthManager extends BaseAuthManager {
  constructor(secrets: vscode.SecretStorage) {
    super(secrets, API_KEY_SECRET_KEY, 'Z.ai', LEGACY_API_KEY_SECRET_KEY);
  }
}
