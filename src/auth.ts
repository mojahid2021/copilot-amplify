import * as vscode from 'vscode';
import { BaseAuthManager } from './baseAuth';

const API_KEY_SECRET_KEY = 'xiaomi-mimo.apiKey';
const NEW_API_KEY_SECRET_KEY = 'copilot-amplify.xiaomi.apiKey';

export class AuthManager extends BaseAuthManager {
  constructor(secrets: vscode.SecretStorage) {
    super(secrets, NEW_API_KEY_SECRET_KEY, 'Xiaomi', API_KEY_SECRET_KEY);
  }
}
