import * as vscode from 'vscode';
import { BaseAuthManager } from './baseAuth';

const API_KEY_SECRET_KEY = 'copilot-amplify.groq.apiKey';

export class GroqAuthManager extends BaseAuthManager {
  constructor(secrets: vscode.SecretStorage) {
    super(secrets, API_KEY_SECRET_KEY, 'Groq');
  }
}
