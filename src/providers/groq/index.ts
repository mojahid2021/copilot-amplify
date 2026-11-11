import type { AmplifyProviderDescriptor, ProviderId } from '../../core/provider/registry';
import { BaseAuthManager } from '../../core/auth/authManager';
import { GROQ_MODELS } from '../../core/models/catalog';
import { OpenAiCompatibleProvider } from '../openaiCompatible/provider';

export function createGroqDescriptor(): AmplifyProviderDescriptor & { id: ProviderId } {
  return {
    id: 'groq',
    vendor: 'LuneCode.CA-groq',
    displayName: 'Groq',
    treeIcon: 'rocket',
    createAuth: (secrets) => new BaseAuthManager(secrets, 'copilot-amplify.CA-groq.apiKey', 'Groq'),
    createProvider: (auth, state) =>
      new OpenAiCompatibleProvider(auth, state, {
        id: 'groq',
        displayName: 'Groq',
        baseURL: 'https://api.groq.com/openai/v1',
        knownModels: GROQ_MODELS,
        // Groq's list also has speech-to-text, text-to-speech and guard models.
        notChat: /whisper|orpheus|tts|guard/i,
        // Groq lists each model's context window, which replaces this default.
        newModelDefaults: { maxInputTokens: 32_768, maxOutputTokens: 8_192, toolCalling: true },
      }),
  };
}
