import type * as vscode from 'vscode';
import { ApiError, GenericApiClient } from '../../core/api/client';
import type { BaseAuthManager } from '../../core/auth/authManager';
import { BaseChatProvider, type ProviderRequestOutcome } from '../../core/provider/baseChatProvider';
import type {
  AmplifyProviderFacet,
  ConnectionTestResult,
  ProviderHealth,
  ProviderTreeModel,
} from '../../core/provider/registry';
import { joinEndpoint } from '../../core/url';

/**
 * Provider with a fixed, built-in model list (Xiaomi, Z.ai, Groq, NVIDIA).
 * Most providers are just `new StaticChatProvider(auth, options)`; subclass
 * only to change how the API client is built (see Xiaomi).
 */

export interface StaticChatProviderOptions {
  baseURL: string;
  providerDisplayName: string;
  models: vscode.LanguageModelChatInformation[];
  /** HTTP status → message shown to the user. */
  errorMessages?: Record<number, string>;
  /** Catalog id → id the API expects (e.g. NVIDIA's namespaced ids). */
  mapModelId?: (modelId: string) => string;
  supportsThinking?: boolean | ((modelId: string) => boolean);
  /** Sampling temperature sent with every request. Default 1.0. */
  defaultTemperature?: number;
}

const PROBE_TIMEOUT_MS = 8_000;

export class StaticChatProvider extends BaseChatProvider implements AmplifyProviderFacet {
  protected override readonly baseURL: string;
  protected override readonly providerDisplayName: string;
  protected override readonly models: vscode.LanguageModelChatInformation[];
  protected override readonly errorMessages: Record<number, string>;
  protected readonly defaultTemperature: number;

  private readonly options: StaticChatProviderOptions;
  private lastTest?: { ok: boolean; at: number };

  constructor(authManager: BaseAuthManager, options: StaticChatProviderOptions) {
    super(authManager);
    this.options = options;
    this.baseURL = options.baseURL;
    this.providerDisplayName = options.providerDisplayName;
    this.models = options.models;
    this.errorMessages = options.errorMessages ?? {};
    this.defaultTemperature = options.defaultTemperature ?? 1.0;
  }

  protected override getApiClient(apiKey: string): GenericApiClient {
    return new GenericApiClient(apiKey, this.baseURL, this.providerDisplayName, this.defaultTemperature);
  }

  protected override mapModelId(modelId: string): string {
    return this.options.mapModelId?.(modelId) ?? modelId;
  }

  protected override supportsThinking(modelId: string): boolean {
    const { supportsThinking } = this.options;
    return typeof supportsThinking === 'function' ? supportsThinking(modelId) : supportsThinking ?? false;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const apiKey = await this.authManager.getApiKey();
    if (!apiKey) {
      return { ok: false, message: 'No API key is set' };
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    timer.unref?.();
    try {
      const response = await fetch(joinEndpoint(this.baseURL, '/models'), {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;

      if (response.ok) {
        this.lastTest = { ok: true, at: Date.now() };
        const json = (await response.json().catch(() => ({}))) as { data?: unknown[] };
        return {
          ok: true,
          message: 'Connected',
          latencyMs,
          ...(Array.isArray(json.data) ? { modelCount: json.data.length } : {}),
        };
      }

      // Some gateways don't expose /models; fall back to a 1-token chat ping.
      if (response.status === 404 || response.status === 405 || response.status === 501) {
        return await this.pingWithChat(apiKey);
      }

      this.lastTest = { ok: false, at: Date.now() };
      return { ok: false, message: describeHttpFailure(response.status), httpStatus: response.status, latencyMs };
    } catch (error) {
      this.lastTest = { ok: false, at: Date.now() };
      if (error instanceof Error && error.name === 'AbortError') {
        return { ok: false, message: `No response within ${PROBE_TIMEOUT_MS / 1000} seconds` };
      }
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  private async pingWithChat(apiKey: string): Promise<ConnectionTestResult> {
    const modelId = this.models[0]?.id;
    if (!modelId) {
      return { ok: false, message: 'This provider has no models to test with' };
    }
    const started = Date.now();
    try {
      await this.getApiClient(apiKey).chat(this.mapModelId(modelId), [{ role: 'user', content: 'Ping' }], { maxTokens: 1 });
      this.lastTest = { ok: true, at: Date.now() };
      return { ok: true, message: 'Connected', latencyMs: Date.now() - started };
    } catch (error) {
      this.lastTest = { ok: false, at: Date.now() };
      const status = error instanceof ApiError ? error.statusCode : undefined;
      return {
        ok: false,
        message: status === 401 || status === 403 ? 'Your API key was not accepted' : (error instanceof Error ? error.message : String(error)),
        ...(status ? { httpStatus: status } : {}),
        latencyMs: Date.now() - started,
      };
    }
  }

  async listModelsForTree(): Promise<ProviderTreeModel[]> {
    return this.models.map((info) => ({
      id: info.id,
      name: info.name,
      capabilities: info.capabilities,
      maxInputTokens: info.maxInputTokens,
      maxOutputTokens: info.maxOutputTokens,
      // Models with a reasoning-effort picker, or that the provider marks as thinking.
      supportsReasoning:
        (info as { configurationSchema?: unknown }).configurationSchema !== undefined || this.supportsThinking(info.id),
    }));
  }

  refreshCaches(): void {
    // A fixed catalog has nothing to refetch.
  }

  health(): ProviderHealth {
    const latest = this.getLatestRequestOutcome();
    const test = this.lastTest;

    // Whichever happened last wins: a real chat request or an explicit test.
    if (latest && latest.at >= (test?.at ?? 0)) {
      return healthFromOutcome(latest);
    }
    if (test) {
      return {
        configured: true,
        status: test.ok ? 'connected' : 'error',
        detail: test.ok ? 'Last connection test passed' : 'Last connection test failed',
        lastRequestAt: test.at,
      };
    }
    return { configured: false, status: 'not-configured' };
  }
}

function describeHttpFailure(status: number): string {
  return status === 401 || status === 403 ? 'Your API key was not accepted' : `The server returned HTTP ${status}`;
}

function healthFromOutcome(outcome: ProviderRequestOutcome): ProviderHealth {
  const base = { configured: true, lastRequestAt: outcome.at };
  if (outcome.ok) {
    return { ...base, status: 'connected', detail: 'Last request succeeded' };
  }
  if (outcome.category === 'auth-failed') {
    const status = outcome.statusCode ? ` (HTTP ${outcome.statusCode})` : '';
    return { ...base, status: 'auth-failed', detail: `The last request was rejected because of the API key${status}` };
  }
  if (outcome.category === 'rate-limited') {
    return { ...base, status: 'rate-limited', detail: 'The last request hit the rate limit' };
  }
  return { ...base, status: 'error', detail: 'The last request failed' };
}
