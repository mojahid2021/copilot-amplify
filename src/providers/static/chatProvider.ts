import { ApiError, GenericApiClient } from '../../core/api/client';
import { joinEndpoint } from '../../core/url';
import {
  ConfigurableChatProvider,
  type ConfigurableChatProviderOptions,
  type ProviderRequestOutcome,
} from '../../core/provider/baseChatProvider';
import type {
  AmplifyProviderFacet,
  ConnectionTestResult,
  ProviderHealth,
  ProviderTreeModel,
} from '../../core/provider/registry';

/**
 * Shared facet for providers with fixed model catalogs (Xiaomi, Z.ai, Groq,
 * NVIDIA NIM). Adds connection testing, tree listing and health reporting on
 * top of the standard chat pipeline.
 */

const PROBE_TIMEOUT_MS = 8_000;

export interface StaticChatProviderOptions extends ConfigurableChatProviderOptions {
  /** Default temperature forwarded to the API client. */
  defaultTemperature?: number;
  /** Client factory override (e.g. Xiaomi token-plan URL switching). */
  createClient?: (apiKey: string) => GenericApiClient;
}

export abstract class StaticChatProvider
  extends ConfigurableChatProvider
  implements AmplifyProviderFacet
{
  private lastTest?: { ok: boolean; at: number };

  protected abstract createProbeClient(apiKey: string): GenericApiClient;

  async testConnection(): Promise<ConnectionTestResult> {
    const apiKey = await this.authManager.getApiKey();
    if (!apiKey) {
      return { ok: false, message: 'API key is not set' };
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(joinEndpoint(this.baseURL, '/models'), {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;

      if (response.ok) {
        this.lastTest = { ok: true, at: Date.now() };
        let modelCount: number | undefined;
        try {
          const json = (await response.json()) as { data?: unknown[] };
          modelCount = Array.isArray(json.data) ? json.data.length : undefined;
        } catch {
          /* body shape is informational only */
        }
        return {
          ok: true,
          message: 'Connected',
          latencyMs,
          ...(modelCount !== undefined ? { modelCount } : {}),
        };
      }

      // Some gateways don't expose /models — fall back to a 1-token chat ping.
      if (response.status === 404 || response.status === 405 || response.status === 501) {
        return await this.pingFallback(apiKey);
      }

      this.lastTest = { ok: false, at: Date.now() };
      const reason =
        response.status === 401 || response.status === 403
          ? 'Authentication failed'
          : `Server returned HTTP ${response.status}`;
      return { ok: false, message: reason, httpStatus: response.status, latencyMs };
    } catch (error) {
      this.lastTest = { ok: false, at: Date.now() };
      if (error instanceof Error && error.name === 'AbortError') {
        return { ok: false, message: `Timed out after ${PROBE_TIMEOUT_MS} ms` };
      }
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  private async pingFallback(apiKey: string): Promise<ConnectionTestResult> {
    const modelId = this.models[0]?.id;
    if (!modelId) {
      return { ok: false, message: 'No models configured for probe' };
    }
    const started = Date.now();
    try {
      const client = this.createProbeClient(apiKey);
      await client.chat(this.mapModelId(modelId), [{ role: 'user', content: 'Ping' }], { maxTokens: 1 });
      this.lastTest = { ok: true, at: Date.now() };
      return { ok: true, message: 'Connected (chat ping)', latencyMs: Date.now() - started };
    } catch (error) {
      this.lastTest = { ok: false, at: Date.now() };
      const status = error instanceof ApiError ? error.statusCode : undefined;
      return {
        ok: false,
        message: status === 401 || status === 403 ? 'Authentication failed' : (error instanceof Error ? error.message : String(error)),
        ...(status !== undefined && status > 0 ? { httpStatus: status } : {}),
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
      // Truthful reasoning badge: models exposing a thinking-effort schema,
      // or providers that declare thinking support for the model.
      supportsReasoning:
        (info as { configurationSchema?: unknown }).configurationSchema !== undefined ||
        this.supportsThinking(info.id),
    }));
  }

  refreshCaches(): void {
    // Fixed catalogs have nothing to invalidate; client cache self-bounds.
  }

  health(): ProviderHealth {
    const latest = this.getLatestRequestOutcome();
    const test = this.lastTest;

    if (!test && !latest) {
      return { configured: false, status: 'not-configured' };
    }

    // The most recent chat-request outcome wins when it is newer than the
    // last explicit connection test — it reflects live provider behavior.
    if (latest && latest.at >= (test?.at ?? 0)) {
      return requestOutcomeHealth(latest);
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

  /** Expose catalog size for descriptors without re-importing catalogs. */
  get modelCount(): number {
    return this.models.length;
  }
}

/** Translate a recorded chat-request outcome into a health snapshot. */
function requestOutcomeHealth(outcome: ProviderRequestOutcome): ProviderHealth {
  if (outcome.ok) {
    return {
      configured: true,
      status: 'connected',
      detail: 'Last request succeeded',
      lastRequestAt: outcome.at,
    };
  }
  if (outcome.category === 'auth-failed') {
    return {
      configured: true,
      status: 'auth-failed',
      detail: `Authentication failed${outcome.statusCode ? ` (HTTP ${outcome.statusCode})` : ''}`,
      lastRequestAt: outcome.at,
    };
  }
  if (outcome.category === 'rate-limited') {
    return {
      configured: true,
      status: 'rate-limited',
      detail: 'Rate limited on the last request',
      lastRequestAt: outcome.at,
    };
  }
  return {
    configured: true,
    status: 'error',
    detail: 'Last request failed',
    lastRequestAt: outcome.at,
  };
}
