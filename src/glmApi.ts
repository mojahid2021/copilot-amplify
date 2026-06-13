import { GenericApiClient, ApiError, type GenericMessage, type GenericTool } from './baseApi';

export const BASE_URL = 'https://api.z.ai/api/coding/paas/v4';

export type GlmMessage = GenericMessage;
export type GlmTool = GenericTool;
export { ApiError as GlmApiError };

export class GlmApiClient extends GenericApiClient {
  constructor(apiKey: string) {
    super(apiKey, BASE_URL, 'Z.ai', 0.7);
  }
}
