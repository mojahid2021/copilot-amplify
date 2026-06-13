import { BaseChatProvider } from './baseProvider';
import { GLM_MODELS } from './models';
import { BASE_URL } from './glmApi';

export class GlmChatProvider extends BaseChatProvider {
  protected override readonly baseURL = BASE_URL;
  protected override readonly providerID = 'glm';
  protected override readonly providerDisplayName = 'Z.ai';
  protected override readonly models = GLM_MODELS;

  protected override readonly errorMessages: Record<number, string> = {
    400: 'Invalid request format. Check parameters and message format.',
    401: 'Authentication failed. Use the Manage command to set a new key.',
    403: 'Access denied. The API key may be restricted.',
    421: 'Request blocked by content filter. Avoid unsafe or sensitive content.',
    429: 'Rate limit reached. Please wait and try again.',
    500: 'GLM server error. Please try again later.',
    503: 'GLM server overloaded. Please try again later.',
  };
}
