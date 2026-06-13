import { GenericApiClient, ApiError, type GenericMessage, type GenericTool } from './baseApi';

export const BASE_URL = 'https://api.groq.com/openai/v1';

export type GroqMessage = GenericMessage;
export type GroqTool = GenericTool;
export { ApiError as GroqApiError };

export class GroqApiClient extends GenericApiClient {
  constructor(apiKey: string) {
    super(apiKey, BASE_URL, 'Groq', 1.0);
  }
}