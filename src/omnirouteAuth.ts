import * as vscode from 'vscode';
import { BaseAuthManager } from './baseAuth';

const API_KEY_SECRET_KEY = 'copilot-amplify.omniroute.apiKey';

export class OmnirouteAuthManager extends BaseAuthManager {
  constructor(secrets: vscode.SecretStorage) {
    super(secrets, API_KEY_SECRET_KEY, 'Omniroute');
  }
}
