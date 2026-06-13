import { GenericApiClient, ApiError, type GenericMessage, type GenericTool } from './baseApi';

export const BASE_URL = 'https://integrate.api.nvidia.com/v1';

export type NvidiaMessage = GenericMessage;
export type NvidiaTool = GenericTool;
export { ApiError as NvidiaApiError };

export class NvidiaNimApiClient extends GenericApiClient {
  constructor(apiKey: string) {
    super(apiKey, BASE_URL, 'NVIDIA NIM', 0.7);
  }
}
