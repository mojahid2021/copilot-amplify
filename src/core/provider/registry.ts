import * as vscode from 'vscode';
import type { BaseAuthManager } from '../auth/authManager';
import type { BaseChatProvider } from './baseChatProvider';

/**
 * Central provider registry.
 *
 * Every provider — Xiaomi, Z.ai, Groq, NVIDIA NIM and OmniRoute alike — is
 * registered here as an equal sibling. The registry owns lazy instantiation,
 * vendor registration with the VS Code Language Model API, and disposal.
 * Adding a provider means adding a descriptor; no core logic changes.
 */

export type ProviderId = 'xiaomi' | 'glm' | 'groq' | 'nvidia' | 'omniroute';

/** Capabilities the UI (tree, diagnostics) needs from any provider. */
export interface ProviderTreeModel {
  id: string;
  name: string;
  capabilities?: { imageInput?: boolean; toolCalling?: boolean | number };
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsReasoning?: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  /** Human-readable summary for toasts. */
  message: string;
  latencyMs?: number;
  modelCount?: number;
  httpStatus?: number;
}

export interface ProviderHealth {
  configured: boolean;
  status:
    | 'connected'
    | 'not-configured'
    | 'error'
    /** Last request hit a rate limit (HTTP 429 / quota signal). */
    | 'rate-limited'
    /** Last request failed authentication (HTTP 401/403). */
    | 'auth-failed';
  detail?: string;
  lastLatencyMs?: number;
  lastRequestAt?: number;
}

/**
 * Everything the shell (extension host, tree, commands) needs to know about a
 * provider, plus factories for its instances.
 */
export interface AmplifyProviderDescriptor {
  id: ProviderId;
  /** VS Code LM API vendor identifier. */
  vendor: string;
  displayName: string;
  treeIcon: string;
  /** Fixed model count, or 'live' for dynamically discovered catalogs. */
  modelCountLabel: number | 'live';
  createAuth(secrets: vscode.SecretStorage): BaseAuthManager;
  createProvider(auth: BaseAuthManager): BaseChatProvider & AmplifyProviderFacet;
}

/**
 * Optional surface implemented by providers for commands/UI.
 * BaseChatProvider covers chat; this covers operations.
 */
export interface AmplifyProviderFacet {
  /** Lightweight reachability/auth check. Must never leak credentials. */
  testConnection(): Promise<ConnectionTestResult>;
  /** Models for the tree view (cached; no network on expand). */
  listModelsForTree(): Promise<ProviderTreeModel[]>;
  /** Invalidate any internal caches (manual refresh). */
  refreshCaches(): void;
  /** Current health snapshot for the tree/diagnostics. */
  health(): ProviderHealth;
  /** Optional eager re-discovery (OmniRoute dynamic catalogs). */
  warmupNow?(): Promise<unknown>;
}

export function isFacet(provider: unknown): provider is BaseChatProvider & AmplifyProviderFacet {
  return (
    !!provider &&
    typeof (provider as AmplifyProviderFacet).testConnection === 'function' &&
    typeof (provider as AmplifyProviderFacet).listModelsForTree === 'function' &&
    typeof (provider as AmplifyProviderFacet).refreshCaches === 'function' &&
    typeof (provider as AmplifyProviderFacet).health === 'function'
  );
}

interface RegistryEntry {
  descriptor: AmplifyProviderDescriptor;
  auth?: BaseAuthManager;
  provider?: BaseChatProvider & AmplifyProviderFacet;
}

export class ProviderRegistry implements vscode.Disposable {
  private readonly entries = new Map<ProviderId, RegistryEntry>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly secrets: vscode.SecretStorage) {}

  register(descriptor: AmplifyProviderDescriptor): void {
    this.entries.set(descriptor.id, { descriptor });
  }

  list(): AmplifyProviderDescriptor[] {
    return [...this.entries.values()].map((entry) => entry.descriptor);
  }

  get(id: ProviderId): AmplifyProviderDescriptor | undefined {
    return this.entries.get(id)?.descriptor;
  }

  /** Auth manager for a provider (created on first use). */
  auth(id: ProviderId): BaseAuthManager {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`Unknown provider: ${id}`);
    }
    entry.auth ??= entry.descriptor.createAuth(this.secrets);
    this.disposables.push(entry.auth);
    return entry.auth;
  }

  /**
   * Provider instance (created lazily on first use).
   * Instantiation must not perform network I/O.
   */
  provider(id: ProviderId): BaseChatProvider & AmplifyProviderFacet {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`Unknown provider: ${id}`);
    }
    if (!entry.provider) {
      entry.provider = entry.descriptor.createProvider(this.auth(id));
      this.disposables.push(entry.provider);
    }
    return entry.provider;
  }

  has(id: string): id is ProviderId {
    return this.entries.has(id as ProviderId);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
    this.entries.clear();
  }
}
