import { GenericApiClient, ApiError, type GenericMessage, type GenericTool, type GenericToolCall } from './baseApi';

export const BASE_URL = 'https://api.xiaomimimo.com/v1';
export const TOKEN_PLAN_BASE_URL = 'https://token-plan-cn.xiaomimimo.com/v1';

export type MiMoMessage = GenericMessage;
export type MiMoTool = GenericTool;
export type MiMoToolCall = GenericToolCall;
export { ApiError as MiMoApiError };

export class MiMoApiClient extends GenericApiClient {
  constructor(apiKey: string) {
    super(
      apiKey,
      apiKey.startsWith('tp-') ? TOKEN_PLAN_BASE_URL : BASE_URL,
      'Xiaomi'
    );
  }
}
