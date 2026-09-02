# Changelog

## [2.1.2] - 2026-09-03

Catalog expansion for the NVIDIA NIM provider. No breaking changes, no new settings, no API changes — every addition is a new model in the static catalog surfaced through the existing chat pipeline.

### Added

- **NVIDIA NIM catalog refresh.** The `NIM_MODELS` array and the NVIDIA provider id map have been rebuilt to match the user's intended lineup. The 2.1.1-era NIM catalog is fully replaced; the new lineup is exactly the set of models explicitly registered through user requests in this release cycle.

- **`kimi-k3` — Moonshot Kimi K3 (`moonshotai/kimi-k3`).** Vision-capable, 262k context, 16k max output, tool-calling. Exposes a dedicated **`NVIDIA_THINKING_CONFIGURATION`** schema (`None / High / Max`) so the user can pick a reasoning tier from the picker. Wired to both `REASONING_MODEL_IDS` and `THINKING_MODEL_IDS` in the NVIDIA provider, which:
  - Pins `temperature: 0.7` for tool-call JSON stability (same rationale as QwQ/GLM-NIM).
  - Forwards the chosen tier as the standard `reasoning_effort` field on the wire (via `applyOptionalParams` in `src/core/api/client.ts`).

- **`deepseek-v4-pro-0813` — DeepSeek V4 Pro 08-13 (`deepseek-ai/deepseek-v4-pro-0813`).** Text-only, tool-calling, 1M context, 16k max output. Surfaced as "DeepSeek V4 Pro (08-13)" so it is distinguishable from the (now removed) generic `deepseek-v4-pro` entry. The model uses DeepSeek V4's `chat_template_kwargs.thinking` reasoning form rather than the `reasoning_effort` enum, so it is intentionally not added to `REASONING_MODEL_IDS` / `THINKING_MODEL_IDS` — adding it would send `reasoning_effort` on the wire and conflict with the model's expected `chat_template_kwargs` form.

- **`deepseek-v4-flash-0731` — DeepSeek V4 Flash 07-31 (`deepseek-ai/deepseek-v4-flash-0731`).** Text-only, tool-calling, 1M context, 16k max output. Surfaced as "DeepSeek V4 Flash (07-31)" to keep the two DeepSeek V4 variants adjacent and distinguishable. Same `chat_template_kwargs` reasoning form as the Pro variant — no `reasoning_effort` plumbing.

- **`laguna-xs-2.1` — Poolside Laguna XS 2.1 (`poolside/laguna-xs-2.1`).** Text-only, tool-calling, 262k context, 8k max output. The upstream snippet uses a plain `temperature: 1, top_p: 0.95, max_tokens: 8192` call with no reasoning plumbing, so the model is registered without a `configurationSchema` and without membership in the reasoning/thinking sets — `temperature: 1` is preserved on the wire.

- **`minimax-m3` — MiniMax M3 (`minimaxai/minimax-m3`).** Vision-capable, tool-calling, 1M context, 8k max output. Plain-call registration, same rationale as Laguna XS 2.1.

- **`nemotron-3-ultra-550b-a55b` — NVIDIA Nemotron 3 Ultra 550B (`nvidia/nemotron-3-ultra-550b-a55b`).** Text-only, tool-calling, 1M context, 16k max output. Reasoning is gated by `chat_template_kwargs.enable_thinking` (Nemotron's chat-template flag, distinct from DeepSeek V4's `chat_template_kwargs.thinking` field), so no `reasoning_effort` plumbing — the model's reasoning form would conflict with the standard enum-based wiring.

- **`gemma-4-31b-it` — Google Gemma 4 31B IT (`google/gemma-4-31b-it`).** Vision-capable, tool-calling, 262k context, 8k max output. Same `chat_template_kwargs.enable_thinking` reasoning form as Nemotron 3 Ultra, same registration rationale.

- **`gpt-oss-120b` — OpenAI GPT-OSS 120B (`openai/gpt-oss-120b`).** Text-only, tool-calling, 131k context, 65k max output. The model is a reasoning model (its responses include a `reasoning_content` field) but the request side needs no explicit reasoning toggle — the upstream snippet is a plain `temperature: 1, top_p: 1, max_tokens: 4096` call. Registered without a `configurationSchema` and outside the reasoning/thinking sets so the snippet's `temperature: 1, top_p: 1` defaults pass through unchanged.

- **`mistral-nemotron` — Mistral Nemotron (`mistralai/mistral-nemotron`).** Text-only, tool-calling, 32k context, 4k max output. The upstream snippet is a plain `temperature: 0.6, top_p: 0.7, max_tokens: 4096` call with no reasoning plumbing. Registered without a `configurationSchema` and outside the reasoning/thinking sets so the snippet's deliberate `temperature: 0.6, top_p: 0.7` values pass through unchanged.

- **`NVIDIA_THINKING_CONFIGURATION` — new per-family thinking-effort schema.** Defined in `src/core/models/catalog.ts` next to the existing `GLM_*` and `QWQ_*` schemas, exposing `enum: ['none', 'high', 'max']` with NVIDIA-flavored labels and descriptions. Mirrors the per-family ownership pattern already in place for GLM and QwQ rather than sharing one schema across families, so labels and descriptions can match NVIDIA NIM's vocabulary exactly.

### Removed

- **Pre-2.1.2 NIM catalog trimmed.** The following entries (and their id-map rows) were removed as part of the catalog refresh: `gemma-3-27b-it`, `nemotron-3-super-120b-a12b`, `deepseek-v4-flash`, `deepseek-v4-pro`, `llama-3.3-70b-instruct`, `mistral-large-2-123b-instruct-2512`, `qwen3-coder-480b-a35b-instruct`, `granite-3.3-8b-instruct`, `qwq-32b`, `step-3.5-flash`, `step-3.7-flash`, `kimi-k2.6`, `devstral-2-123b-instruct-2512`, `falcon3-7b-instruct`, `laguna-xs-2.1` (v1.0 line), and `gpt-oss-120b` (v1 entry). The `GLM_5_2_THINKING_CONFIGURATION` and `QWQ_THINKING_CONFIGURATION` schemas (orphaned after their sole consumers were dropped) were also removed. The Z.ai `GLM_MODELS` array — owned by the Z.ai provider — is unchanged.

### Notes

- **No new settings, no new commands, no new transport plumbing.** Every addition flows through the existing `NIM_MODELS` → `NvidiaChatProvider` → `GenericApiClient` path; only catalog entries, id-map rows, and the `NVIDIA_THINKING_CONFIGURATION` schema are new.
- **Provider tree view automatically reflects the new model list.** `listModelsForTree` reads from `NIM_MODELS` directly, so no provider-side changes are needed for the new entries to appear in the Copilot Chat picker.
- **Idempotent in-flight call path.** Streaming, retry, circuit breaker, and diagnostics layers are untouched and apply to the new models exactly as they did for the removed ones.

## [2.1.1] - 2026-08-27

### Changed

- **OmniRoute chat endpoint is now fixed at `{baseUrl}/chat/completions`.** The `copilot-amplify.omniroute.chatEndpoint` setting, the `OmniRoute: Edit Chat Endpoint` command, the *Edit OmniRoute Chat Endpoint* tree action, and the Manage QuickPick entry have all been removed. Gateways that previously needed a custom chat-completions route must now be exposed behind the same `/v1` prefix as the rest of the OmniRoute API. Any pre-existing `chatEndpoint` value in user/workspace settings is ignored (harmless leftover).
- **User-facing strings now make the `/v1` requirement explicit.** The base-URL input boxes (both the `Configure…` flow and the new `Edit Base URL` flow), the `validateBaseUrl` error message, the `baseUrl` setting description, and the README settings table all spell out that the base URL must include the `/v1` path.

### Added

- **`OmniRoute: Edit Base URL`** — new dedicated command (`copilot-amplify.omniroute.editBaseUrl`) for changing the OmniRoute base URL on its own, surfaced in the Providers & Models tree ACTIONS panel and the Manage QuickPick (`$(link) Edit OmniRoute Base URL`). Prompts for the URL with the `/v1` path explicit, busts the model cache on change, runs a connection test against the new host, and refreshes the tree.

## [2.1.0] - 2026-08-23

Audit-driven reliability, observability and security hardening on top of the 2.0.0 architecture. No breaking changes.

### Added

- **Custom OmniRoute chat endpoint** — new `copilot-amplify.omniroute.chatEndpoint` setting accepts an absolute URL or a path relative to the Base URL for gateways that expose chat completions on a non-standard route. Invalid overrides (wrong scheme, embedded credentials, malformed URLs) fall back safely to the standard `{Base URL}/chat/completions`; model discovery always uses the standard base path. Editable from the Providers & Models tree ACTIONS panel (*Edit OmniRoute Chat Endpoint*), the Manage QuickPick, the guided `OmniRoute: Configure…` flow, or directly via settings.
- **Unified diagnostics** — new `Copilot Amplify: Show Diagnostics` command renders a credential-free report for **all five providers** (key state as a boolean flag only, health status + detail, model counts, per-provider circuit-breaker state, last request outcome). Also available from the Manage QuickPick and the tree ACTIONS section.
- **Richer health states** — `ProviderHealth.status` now includes `rate-limited` and `auth-failed` alongside connected/not-configured/error; the Providers tree reflects live health (including OmniRoute circuit-open) instead of stored-key presence alone.
- **Saturation classification** — HTTP 503/529 response bodies are inspected to distinguish *queue saturation* from *maintenance* from generic unavailability. Saturated/maintenance failures get an actionable hint appended to the user-facing error.
- **Request-outcome tracking** — every chat request records its outcome (success or classified failure with HTTP status) in the base provider; surfaced via provider facets, health, and diagnostics.
- **`copilot-amplify.requestTimeoutMs`** (default 120000) — explicit chat-request timeout for fixed-catalog providers (Xiaomi MiMo, Z.ai, Groq, NVIDIA NIM), applied by the shared API client so no SDK-path request can hang indefinitely.
- **Contract test suite** parameterized over all five providers (registry shape, lazy instantiation, facet surface, health-before-config, truthful capabilities, key non-leakage in diagnostics), plus first provider-specific suites (Xiaomi token-plan routing, NVIDIA id mapping, Z.ai thinking flags, Groq temperature default) and an OmniRoute transport suite (Retry-After capture, mid-stream failure wrapping, plain-JSON fallback, session-header presence). Suite grows from 16 files / 173 tests to 21 files / 213 tests.
- `docs/adding-a-provider.md`: full step-by-step guide covering descriptor modules, inherited pipeline behavior, registration wiring, catalogs vs dynamic discovery, and testing.

### Changed

- **Circuit breaker now guards all providers.** Ownership moved into `BaseChatProvider`; the `copilot-amplify.circuitBreaker.*` settings previously affected only OmniRoute. The shared breaker also protects model-discovery paths, and open-circuit rejections (`CircuitOpenError`) are no longer retried — requests fail fast instead of sleeping through backoff against a breaker that keeps refusing.
- **Retry-After honored on OmniRoute's raw-fetch path** — non-ok responses now carry their headers into `ApiError`, matching what the OpenAI-SDK path already did.
- TypeScript strictness raised: `noUncheckedIndexedAccess` enabled; ESLint typed linting extended to cover `tests/` via `tsconfig.eslint.json`.
- Removed dead Node `http`/`https` agent plumbing from the shared fetch wrapper (silently ignored by undici).

### Fixed

- `OmniRoute: Reset Configuration` now also resets `debugLogging` (previously left stale).
- `MockSecretStorage` in tests: the backing map shadowed the `store()` method; seeding secrets directly is now possible.

## [2.0.0] - 2026-08-23

Production-grade architecture upgrade. OmniRoute becomes a first-class provider among equals; core infrastructure rebuilt around a provider registry with shared transport, retry, resilience, and logging layers.

### ⚠ Breaking changes

- **Plaintext API key settings removed.** The documented-but-dead `copilot-amplify.<provider>.apiKey` settings entries are gone from the manifest. On first activation any existing plaintext values are migrated into VS Code SecretStorage automatically and cleared from settings. Keys were always read from SecretStorage at runtime — no action needed for most users.

### Added

- **Provider registry**: Xiaomi, Z.ai, Groq, NVIDIA NIM, and OmniRoute registered as equal siblings via descriptors; lazy instantiation; uniform lifecycle/disposal.
- **OmniRoute provider module** (`src/providers/omniroute/`): dedicated config/API/models/session/telemetry/connection-test/diagnostics units.
- **7 new OmniRoute commands**: Configure…, Set API Key, Remove API Key, Test Connection, Refresh Models, Show Diagnostics, Reset Configuration.
- **Connection testing**: lightweight `/models` probe with latency measurement and model count; actionable failure reasons including HTTP status; graceful chat-ping fallback for gateways without `/models`.
- **Diagnostics report**: base URL, key-configured flag (never the value), timeouts, header options, cache state, breaker state, last errors.
- **Error taxonomy**: normalized provider errors (Authentication/RateLimit/InvalidRequest/Network/Timeout/ModelNotFound/ProviderUnavailable/Stream/Cancelled) mapped from HTTP statuses.
- **Circuit breaker** per provider (configurable threshold/cooldown, half-open probing) with `copilot-amplify.circuitBreaker.*` settings.
- **Retry hardening**: honors server `Retry-After`; retries 408/500 alongside 429/502/503/504; full-jitter backoff; retry budget option; fixed cancellation-listener leak and sleep race.
- **URL utilities**: base URL validation (scheme/userinfo checks) and normalization (`//v1` collapses, trailing slashes stripped) for all provider endpoints.
- **Shared SSE parser**: fragmented chunks, multi-event frames, CRLF, comments, `[DONE]`, malformed-frame tolerance, trailing flush.
- **Structured logging** to a single "Copilot Amplify" output channel with child bindings and secret redaction; replaces scattered console logging.
- **Session tagging**: stable window-scoped `X-OmniRoute-Session-Id` (setting override wins) — previously advertised but unimplemented.
- Configurable `requestTimeoutMs`, `discoveryTimeoutMs`, `warmupOnStartup`, `debugLogging`; OpenAI SDK clients now carry explicit timeouts.
- Vitest unit suite: 16 files / 173 tests covering URL handling, SSE robustness, retry semantics, breaker transitions, cache coalescing, error mapping, redaction, tool parsing, context integrity, discovery filtering, connection testing, sessions, telemetry, migration, and the registry.

### Changed

- Activation performs zero network I/O; OmniRoute discovery now runs on first LM-API use (opt-in warmup available).
- Tree view reads cached model lists per provider — expanding sections no longer triggers live requests.
- 401/403 responses no longer silently delete stored API keys; users get an actionable message instead.
- Model capabilities made truthful: thinking-effort schemas scoped to actually-thinking models; reasoning badges derived from provider data instead of loose id regexes.
- Client caches bounded (LRU-style) instead of growing without limit; OmniRoute capability store bounded.
- Non-streaming fallback path is cancellation-aware.
- GLM detail strings corrected ("Z.AI"); README rewritten to match reality (model tables, architecture).

### Fixed

- Context sanitization (orphaned tool results / leading tool messages) now also runs when no truncation is required.
- `invalidateAll()` during an in-flight cache fetch can no longer resurrect stale values.
- Retry-After previously ignored entirely.
