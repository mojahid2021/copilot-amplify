import { BaseChatProvider } from './baseProvider';
import { MIMO_MODELS } from './models';
import { BASE_URL } from './api';

export class MiMoChatProvider extends BaseChatProvider {
  protected override readonly baseURL = BASE_URL;
  protected override readonly providerID = 'xiaomi';
  protected override readonly providerDisplayName = 'Xiaomi';
  protected override readonly models = MIMO_MODELS;

  protected override readonly errorMessages: Record<number, string> = {
    400: 'Invalid request format. Check parameters and message format.',
    401: 'Authentication failed. Please set a new key using "Copilot Amplify: Xiaomi - Set API Key".',
    403: 'Access denied. The service may not be available in your region, or your API key is restricted.',
    421: 'Request blocked by content filter. Avoid unsafe or sensitive content.',
    429: 'Rate limit reached. Please wait and try again.',
    500: 'MiMo server error. Please try again later.',
    503: 'MiMo server overloaded. Please try again later.',
  };
}
