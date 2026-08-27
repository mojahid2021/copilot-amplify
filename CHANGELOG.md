# Changelog

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
