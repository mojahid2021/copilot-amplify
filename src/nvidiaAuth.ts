import * as vscode from 'vscode';
import { BaseAuthManager } from './baseAuth';

const API_KEY_SECRET_KEY = 'copilot-amplify.nvidia.apiKey';

export class NvidiaAuthManager extends BaseAuthManager {
  constructor(secrets: vscode.SecretStorage) {
    super(secrets, API_KEY_SECRET_KEY, 'NVIDIA NIM');
  }
}
