import { BaseChatProvider } from './baseProvider';
import { GROQ_MODELS } from './models';
import { BASE_URL } from './groqApi';

export class GroqChatProvider extends BaseChatProvider {
  protected override readonly baseURL = BASE_URL;
  protected override readonly providerDisplayName = 'Groq';
  protected override readonly models = GROQ_MODELS;

  protected override readonly errorMessages: Record<number, string> = {
    400: 'Invalid request format. Check parameters and message format.',
    401: 'Authentication failed. Please set a new key using "Copilot Amplify: Groq - Set API Key".',
    403: 'Access denied. The API key may be restricted for this model.',
    404: 'Model not found. Try a different Groq model.',
    429: 'Rate limit reached. Please wait and try again.',
    500: 'Groq server error. Please try again later.',
    503: 'Groq server overloaded. Please try again later.',
  };
}
