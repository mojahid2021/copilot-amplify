/**
 * AgentRouter catalog builder.
 *
 * Converts the normalized model map produced by {@link fetchAgentrouterPricing}
 * into `vscode.LanguageModelChatInformation[]` entries that the Copilot Chat
 * picker can render.
 *
 * Token limits and capability defaults are seeded from a small `KNOWN_*`
 * table for the well-known Claude Opus 4 variants the user explicitly
 * named, and otherwise fall back to safe defaults. The AgentRouter server
 * does not currently advertise `max_input_tokens` / `max_output_tokens` /
 * `capabilities` in the `/api/pricing` payload, so we do not derive them
 * from discovery.
 */

import type * as vscode from 'vscode';
import { AGENTROUTER_CLAUDE_THINKING_CONFIGURATION } from '../../core/models/catalog';
import type { DiscoveredAgentrouterModel, AgentrouterEndpointType } from './discovery';
import { AGENTROUTER_DISPLAY_NAME } from './descriptor';

interface ConfigurableLanguageModelChatInformation extends vscode.LanguageModelChatInformation {
  configurationSchema?: typeof AGENTROUTER_CLAUDE_THINKING_CONFIGURATION;
}

interface ModelDefaults {
  maxInputTokens: number;
  maxOutputTokens: number;
  imageInput: boolean;
  toolCalling: boolean;
}

const DEFAULT_FALLBACK: ModelDefaults = {
  maxInputTokens: 128_000,
  maxOutputTokens: 8_192,
  imageInput: false,
  toolCalling: true,
};

/**
 * Seeded defaults for the Claude Opus 4 line (Anthropic's public specs).
 * Only the variants the user explicitly named get hand-tuned entries;
 * everything else falls through to the safe defaults.
 */
const KNOWN_CLAUDE_DEFAULTS: Record<string, ModelDefaults> = {
  'claude-opus-4-6': {
    maxInputTokens: 200_000,
    maxOutputTokens: 32_000,
    imageInput: true,
    toolCalling: true,
  },
  'claude-opus-4-7': {
    maxInputTokens: 200_000,
    maxOutputTokens: 32_000,
    imageInput: true,
    toolCalling: true,
  },
  'claude-opus-4-8': {
    maxInputTokens: 200_000,
    maxOutputTokens: 32_000,
    imageInput: true,
    toolCalling: true,
  },
  'claude-opus-4-5': {
    maxInputTokens: 200_000,
    maxOutputTokens: 32_000,
    imageInput: true,
    toolCalling: true,
  },
};

/** Best-effort defaults for the well-known GPT and GLM model families. */
const KNOWN_GPT_DEFAULTS: Record<string, ModelDefaults> = {
  'gpt-5.5': {
    maxInputTokens: 256_000,
    maxOutputTokens: 16_384,
    imageInput: true,
    toolCalling: true,
  },
  'gpt-5.6': {
    maxInputTokens: 256_000,
    maxOutputTokens: 16_384,
    imageInput: true,
    toolCalling: true,
  },
};

const KNOWN_GLM_DEFAULTS: Record<string, ModelDefaults> = {
  'glm-5.2': {
    maxInputTokens: 128_000,
    maxOutputTokens: 8_192,
    imageInput: false,
    toolCalling: true,
  },
  'glm-5.3': {
    maxInputTokens: 128_000,
    maxOutputTokens: 8_192,
    imageInput: false,
    toolCalling: true,
  },
};

function resolveDefaults(id: string): ModelDefaults {
  const lower = id.toLowerCase();
  if (lower.startsWith('claude-opus-4-')) {
    return KNOWN_CLAUDE_DEFAULTS[id] ?? KNOWN_CLAUDE_DEFAULTS['claude-opus-4-8'] ?? DEFAULT_FALLBACK;
  }
  if (lower.startsWith('claude-')) {
    return { ...DEFAULT_FALLBACK, imageInput: true, maxInputTokens: 200_000 };
  }
  if (lower.startsWith('gpt-')) {
    return KNOWN_GPT_DEFAULTS[id] ?? { ...DEFAULT_FALLBACK, imageInput: true };
  }
  if (lower.startsWith('glm-')) {
    return KNOWN_GLM_DEFAULTS[id] ?? DEFAULT_FALLBACK;
  }
  return DEFAULT_FALLBACK;
}

/**
 * Pick a transport decision for a model based on the discovered
 * `supported_endpoint_types` array.
 *
 * Rules (in priority order):
 *   1. **Claude is priority** — if the model id starts with `claude-` AND
 *      the server advertises `anthropic` in `supported_endpoint_types`,
 *      use the Anthropic transport. Claude models prefer their native
 *      protocol over the OpenAI-compatible path even when both are
 *      advertised.
 *   2. **Use what the server declares** — otherwise, if the server
 *      advertised any endpoints, use the only one it declared. If it
 *      declared both for a non-Claude model, OpenAI-compatible wins
 *      (the native Anthropic transport is Claude-only).
 *   3. **Heuristic fallback** — when the server returned no
 *      `supported_endpoint_types` at all, infer from the id:
 *      `claude-*` → anthropic, everything else → openai.
 */
export function resolveAgentrouterTransport(
  model: DiscoveredAgentrouterModel,
): AgentrouterEndpointType {
  const types = model.supportedEndpointTypes;
  const isClaude = model.id.toLowerCase().startsWith('claude-');

  // Rule 1: Claude is priority when Anthropic is available for it.
  if (isClaude && types.includes('anthropic')) {
    return 'anthropic';
  }

  // Rule 2: use the endpoint(s) the server explicitly declared.
  if (types.length > 0) {
    // Claude with no 'anthropic' entry — fall through to whatever the
    // server did advertise. Most commonly this is 'openai' for Claude
    // variants that haven't been wired up to the native endpoint yet.
    if (types.length === 1) {
      return types[0] as AgentrouterEndpointType;
    }
    // Both advertised for a non-Claude model: Anthropic transport is
    // Claude-only, so the OpenAI-compatible path is the only valid
    // choice.
    return 'openai';
  }

  // Rule 3: heuristic fallback when the server gave no endpoint info.
  return isClaude ? 'anthropic' : 'openai';
}

/**
 * Pretty-print a model id as a picker display name.
 *   `claude-opus-4-8`        → "Claude Opus 4.8"
 *   `gpt-5.5`                → "GPT-5.5"
 *   `glm-5.2`                → "GLM-5.2"
 *   `deepseek-v4-flash`      → "Deepseek V4 Flash"
 */
export function agentrouterDisplayName(id: string): string {
  const lower = id.toLowerCase();
  if (lower.startsWith('claude-opus-4-')) {
    const suffix = id.slice('claude-opus-4-'.length);
    return `Claude Opus 4.${suffix}`;
  }
  if (lower.startsWith('claude-opus-')) {
    const suffix = id.slice('claude-opus-'.length);
    return `Claude Opus ${suffix}`;
  }
  if (lower.startsWith('claude-')) {
    return `Claude ${id.slice('claude-'.length).replaceAll('-', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}`;
  }
  if (lower.startsWith('gpt-oss-')) {
    return `GPT-OSS ${id.slice('gpt-oss-'.length)}`;
  }
  if (lower.startsWith('gpt-')) {
    return id.toUpperCase().replace(/^GPT-/, 'GPT-');
  }
  if (lower.startsWith('glm-')) {
    // "glm-5.2" → "GLM-5.2" (preserve original numeric format verbatim).
    return `GLM-${id.slice(4)}`;
  }
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildInformation(
  model: DiscoveredAgentrouterModel,
): ConfigurableLanguageModelChatInformation {
  const defaults = resolveDefaults(model.id);
  const transport = resolveAgentrouterTransport(model);
  const transportLabel = transport === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible';
  // Surface the discovered `supported_endpoint_types` so the user can see
  // exactly what the server declared for this model — useful when a model
  // is wired up to a single endpoint (so a future addition to the server
  // side is visible immediately on next refresh).
  const declaredTypes = model.supportedEndpointTypes.length > 0
    ? model.supportedEndpointTypes.join(' + ')
    : 'auto';
  const info: ConfigurableLanguageModelChatInformation = {
    id: model.id,
    name: agentrouterDisplayName(model.id),
    family: 'agentrouter',
    version: model.id,
    tooltip: `${AGENTROUTER_DISPLAY_NAME} · ${transportLabel} (server: ${declaredTypes})`,
    detail: `${AGENTROUTER_DISPLAY_NAME} · ${transportLabel}`,
    maxInputTokens: defaults.maxInputTokens,
    maxOutputTokens: defaults.maxOutputTokens,
    capabilities: {
      imageInput: defaults.imageInput,
      toolCalling: defaults.toolCalling,
    },
  };
  if (transport === 'anthropic') {
    info.configurationSchema = AGENTROUTER_CLAUDE_THINKING_CONFIGURATION;
  }
  return info;
}

/**
 * Build a sorted, de-duplicated `vscode.LanguageModelChatInformation[]`
 * from a discovered model map. Sorting is stable by display name.
 */
export function buildAgentrouterCatalog(
  models: Iterable<DiscoveredAgentrouterModel>,
): ConfigurableLanguageModelChatInformation[] {
  const seen = new Set<string>();
  const out: ConfigurableLanguageModelChatInformation[] = [];
  for (const model of models) {
    if (seen.has(model.id)) {
      continue;
    }
    seen.add(model.id);
    out.push(buildInformation(model));
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
