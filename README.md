<div align="center">

<img src="icon.png" alt="Copilot Amplify logo" width="128" />

# Copilot Amplify

**Extend GitHub Copilot Chat with the AI providers *you* choose.**

Xiaomi MiMo · Z.ai GLM · Groq · NVIDIA NIM · OmniRoute · AgentRouter — all first-class,
equal siblings inside the VS Code Language Model API.

[![Version](https://img.shields.io/badge/version-2.3.0-blue)](CHANGELOG.md)
[![VS Code Marketplace](https://img.shields.io/badge/VS_Code_Marketplace-installed-0098FF?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=mojahid2021.copilot-amplify)
[![Open VSX](https://img.shields.io/badge/Open_VSX-2.3.0-8A2BE2)](https://open-vsx.org/extension/mojahid2021/copilot-amplify)
[![Publish Extension](https://github.com/mojahid2021/copilot-amplify/actions/workflows/publish-openvsx.yml/badge.svg)](https://github.com/mojahid2021/copilot-amplify/actions/workflows/publish-openvsx.yml)
[![Tests](https://img.shields.io/badge/tests-vitest-brightgreen)](#-development)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](#-development)
[![License](https://img.shields.io/badge/license-ISC-yellow)](LICENSE)

[Install](#-installation) · [Quick Start](#-quick-start) · [Configuration](#%EF%B8%8F-configuration) · [Contributing](#-contributing)

</div>

---

## ✨ Why Copilot Amplify?

GitHub Copilot Chat is great — but you're limited to GitHub's model catalog.
Copilot Amplify opens it up:

| | |
|---|---|
| 🔌 **Bring your own provider** | Xiaomi MiMo, Z.ai GLM, Groq, NVIDIA NIM, OmniRoute, and AgentRouter work out of the box |
| ⚖️ **No privileged provider** | Every provider is an equal sibling — no hidden routing, no forced hierarchy |
| 🔐 **Secrets done right** | API keys live in VS Code SecretStorage (OS keychain), never in `settings.json` or logs |
| 🧠 **Full AI capability surface** | Streaming, tool calling, reasoning/thinking output, vision input, system prompts |
| 🛡️ **Production-grade reliability** | Retries with `Retry-After`, per-provider circuit breakers, timeouts everywhere, saturation-aware errors |
| 🌊 **Live model catalogs** | OmniRoute and AgentRouter discover models from your server at runtime — new models appear without updating the extension |
| 👁️ **Observable** | Unified diagnostics, per-request telemetry logs, live health states in the tree view |

> **OmniRoute is a provider, not a middleman.** Its internal multi-provider
> routing lives entirely on the OmniRoute server; this extension only ever
> talks to your configured base URL — exactly like any other vendor endpoint.

## 🗺️ Contents

- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Supported Providers](#-supported-providers)
- [Architecture](#%EF%B8%8F-architecture)
- [Configuration](#%EF%B8%8F-configuration)
- [Commands](#-commands)
- [Reliability](#%EF%B8%8F-reliability)
- [Security](#-security)
- [Troubleshooting](#-troubleshooting)
- [Development](#-development)
- [Contributing](#-contributing)
- [License](#-license)

## 📦 Installation

**Option A — from a marketplace (recommended)**

Available on both major registries:

| Registry | Install |
|---|---|
| **VS Code Marketplace** | [Install for VS Code](https://marketplace.visualstudio.com/items?itemName=mojahid2021.copilot-amplify) — click *Install*, or inside VS Code: `Extensions → Search "Copilot Amplify"` |
| **Open VSX** | [Install for VSCodium / Gitpod / Cursor & friends](https://open-vsx.org/extension/mojahid2021/copilot-amplify) — or CLI: `open-vsx` compatible editors via `code --install-extension mojahid2021.copilot-amplify` |

Or straight from the terminal:

```bash
# VS Code / Cursor / Windsurf
code --install-extension mojahid2021.copilot-amplify
```

**Option B — build from source**

```bash
git clone https://github.com/mojahid2021/copilot-amplify.git
cd copilot-amplify
npm install
npm run compile
```

Then press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

**Option C — packaged VSIX**

```bash
npm install && npm run package   # → copilot-amplify-<version>.vsix
```

Install via `Extensions: Install from VSIX…`.

> Requires **VS Code ≥ 1.125** and an active GitHub Copilot subscription
> (the extension extends Copilot Chat's Language Model API).

## 🚀 Quick Start

1. **Open the panel**: click the Copilot Amplify icon in the activity bar.
2. **Add a key**: click a provider marked *API key needed* and paste your key. It is stored in your system keychain.
3. **Pick a model**: open Copilot Chat's model picker and choose one, for example *GLM 5.2*.
4. **Chat.** That's it.

Before step 3, select **Load Models** (the cloud icon on the provider row) once;
the list is kept between sessions. For OmniRoute, run **OmniRoute: Set Up…** instead of step 2.

No `settings.json` edits required.

## 🔌 Supported Providers

| Provider | Catalog | Highlights |
|---|---|---|
| **Xiaomi MiMo** | 🔄 Loaded from Xiaomi | Auto-routes token-plan (`tp-`) keys to the dedicated gateway; up to 1M-token context |
| **Z.ai GLM** | 🔄 Loaded from Z.ai | Reasoning-effort control on GLM-5.x; vision on `glm-5v-turbo` |
| **Groq** | 🔄 Loaded from Groq | Ultra-fast Llama & GPT-OSS serving; context windows come straight from Groq |
| **NVIDIA NIM** | 🔄 Loaded from NVIDIA | Every chat model NVIDIA serves (`GET /v1/models`) |
| **OmniRoute** | 🔄 Dynamic | Loads models from your server (`GET /models`); works without a key when the server allows it |
| **AgentRouter** | 🔄 Dynamic | Discovers models from `GET /api/pricing`; routes Claude models to the native Anthropic `messages` API and everything else to the OpenAI-compatible endpoint; single API key covers both transports |

Capabilities shown in the picker are **truthful by design** — a model is only
advertised with vision/tools/reasoning if it actually supports them.

## 🏗️ Architecture

Every provider plugs into VS Code's Language Model API through one shared
base class. A chat request takes this path:

```text
Copilot Chat
  └─ BaseChatProvider.provideLanguageModelChatResponse
       ├─ resolveApiKey()          key from SecretStorage (OmniRoute: optional)
       ├─ runChatOperation()       retry with backoff + circuit breaker + health stats
       │    └─ sendChatRequest()   pick the transport (AgentRouter: Claude → Anthropic API)
       │         └─ consumeChatStream()   chunks → text / reasoning / tool-call parts
       └─ throwMappedError()       HTTP status → readable message
```

Every provider's model list comes from its server when you select **Load
Models** (or **Refresh Providers and Models**), and is kept between VS Code
sessions. VS Code asks for the model list often, so the extension never
fetches on its own; it answers from the saved list.

| Class | Providers | Model list |
|---|---|---|
| `OpenAiCompatibleProvider` | Xiaomi, Z.ai, Groq, NVIDIA | `GET {baseURL}/models` |
| `OmnirouteChatProvider` | OmniRoute | `GET {serverUrl}/models` |
| `AgentrouterChatProvider` | AgentRouter | `GET /api/pricing` |

All three extend `DynamicCatalogProvider`. The model lists of the first four
carry ids (Groq adds context windows) but not whether a model supports tools
or images, and they mix in speech, embedding and safety models. So:

- non-chat models are filtered out by id;
- models in `src/core/models/catalog.ts` keep their exact limits, vision, tools and reasoning settings;
- other models get a 32K context (or what the server reports) with tools on;
- when a provider has no list endpoint (Z.ai, and Xiaomi so far), its known models are used.

<details>
<summary><strong>Project layout</strong></summary>

```text
src/
├── extension.ts            # activate(): registry, tree, status bar, commands (no network I/O)
├── secretsMigration.ts     # one-time move of old plaintext keys into SecretStorage
├── core/
│   ├── provider/
│   │   ├── baseChatProvider.ts        # the chat pipeline above
│   │   ├── dynamicCatalogProvider.ts  # model list loading, cache, saving between sessions, health
│   │   └── registry.ts                # ProviderRegistry + the provider/descriptor interfaces
│   ├── api/                # OpenAI-SDK client, Anthropic client, SSE parser, fetch helpers
│   ├── auth/               # BaseAuthManager (SecretStorage)
│   ├── context/            # VS Code messages → API messages, token estimate, trimming
│   ├── resilience/         # circuit breaker, TTL cache, 503 classifier, network quality
│   ├── retry/              # backoff + Retry-After
│   ├── thinking/           # <think>…</think> extraction from streamed text
│   ├── models/             # known model details (catalog.ts), picker id helpers (modelIds.ts)
│   ├── logging/            # output-channel logger with secret redaction
│   └── diagnostics.ts, globalConfig.ts, url.ts, util/
├── providers/
│   ├── index.ts            # registers every provider
│   ├── openaiCompatible/   # OpenAiCompatibleProvider (Xiaomi, Z.ai, Groq, NVIDIA)
│   ├── xiaomi/ zai/ groq/ nvidia/      # one descriptor file each
│   ├── omniroute/          # dynamic: config, API client, discovery, diagnostics
│   └── agentrouter/        # dynamic: config, discovery, catalog, dual transport
├── commands/               # command handlers (general + OmniRoute)
└── ui/                     # sidebar tree, network-quality status bar
tests/
├── mocks/vscode.ts         # the slice of the VS Code API the tests need
├── helpers.ts              # fake SecretStorage, JSON/SSE responses
└── *.test.ts
```

</details>

## ⚙️ Configuration

### API keys & SecretStorage

Set keys through the UI — never edit settings files:

- Tree view → 🔑 icon on a provider row, or
- `Copilot Amplify: Manage Providers… → Set API Key`

Keys are stored via [`vscode.SecretStorage`](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
(OS keychain-backed) and never appear in logs, diagnostics, or errors.
Upgrading from 1.x? Plaintext settings entries are migrated automatically on
first activation and then removed.

> 💡 **OmniRoute without a key:** if your server allows anonymous access, you can skip the API key.

### General settings

| Setting | Default | Purpose |
|---|---|---|
| `copilot-amplify.enableReasoning` | `true` | Global reasoning toggle for thinking-capable models |
| `copilot-amplify.customSystemPrompt` | *(empty)* | Injected into every request across providers |
| `copilot-amplify.requestTimeoutMs` | `120000` | Chat request timeout for Xiaomi, Z.ai, Groq and NVIDIA |
| `copilot-amplify.loadModelsOnStartup` | `false` | Load the Xiaomi, Z.ai, Groq and NVIDIA model lists when VS Code starts |
| `copilot-amplify.modelListTimeoutMs` | `8000` | Timeout for loading those model lists and for connection tests |
| `copilot-amplify.debugLogging` | `false` | Debug-level logs in the output channel |
| `copilot-amplify.circuitBreaker.enabled` | `true` | Fail-fast after repeated failures — **every** provider |
| `copilot-amplify.circuitBreaker.failureThreshold` | `5` | Consecutive failures before a circuit opens |
| `copilot-amplify.circuitBreaker.resetTimeoutSeconds` | `30` | Cooldown before a half-open probe |

### OmniRoute settings

| Setting | Default | Purpose |
|---|---|---|
| `copilot-amplify.CA-omniroute.baseUrl` | `http://localhost:20128/v1` | Server base URL. **Must include the `/v1` path** (e.g. `http://localhost:20128/v1` or `https://omniroute.example.com/v1`). The chat-completions endpoint is fixed at `{baseUrl}/chat/completions`. |
| `copilot-amplify.CA-omniroute.noCache` | `false` | Bypass the server-side semantic cache |
| `copilot-amplify.CA-omniroute.noMemory` | `true` | Skip server-side memory/skills injection |
| `copilot-amplify.CA-omniroute.compression` | *(empty)* | Compression override (`off`, `default`, `engine:<id>`) |
| `copilot-amplify.CA-omniroute.sessionId` | *(empty)* | Explicit session tag for cost attribution/memory |
| `copilot-amplify.CA-omniroute.progress` | `false` | Opt into server progress events |
| `copilot-amplify.CA-omniroute.modelCacheTtlSeconds` | `300` | Model discovery cache TTL |
| `copilot-amplify.CA-omniroute.requestTimeoutMs` | `120000` | Chat request timeout |
| `copilot-amplify.CA-omniroute.discoveryTimeoutMs` | `8000` | Discovery / connection-test timeout |
| `copilot-amplify.CA-omniroute.warmupOnStartup` | `false` | Load models when VS Code starts, instead of waiting for **Load Models** |

### AgentRouter settings

| Setting | Default | Purpose |
|---|---|---|
| `copilot-amplify.CA-agentrouter.baseUrl` | `https://agentrouter.org/v1` | OpenAI-compatible base URL. **Must include the `/v1` path**. The Anthropic base URL is derived by stripping `/v1` (so `https://agentrouter.org`). |
| `copilot-amplify.CA-agentrouter.cacheTtlSeconds` | `300` | How long the discovered model list stays cached before refetching `GET {baseUrl}/api/pricing`. |
| `copilot-amplify.CA-agentrouter.requestTimeoutMs` | `120000` | Chat request timeout (covers connection + full stream) for both transports. |
| `copilot-amplify.CA-agentrouter.discoveryTimeoutMs` | `8000` | Catalog discovery / connection-test timeout. |
| `copilot-amplify.CA-agentrouter.warmupOnStartup` | `false` | Load models when VS Code starts, instead of waiting for **Load Models** |
| `copilot-amplify.CA-omniroute.logTelemetry` | `true` | Log routing/cost telemetry per request |

Base URLs are normalized — these are all equivalent, no `//v1` accidents:

```text
https://example.com        https://example.com/
https://example.com/v1     https://example.com/v1/
```

## 🎮 Commands

All commands are in the Command Palette under **Copilot Amplify**. The sidebar
offers the same actions: click a provider to set it up or test it, and
right-click it for everything else.

| Command | What it does |
|---|---|
| `Manage Providers…` | One menu for keys, tests, OmniRoute setup and troubleshooting |
| `Set API Key…` / `Remove API Key` | Save or delete a provider's key (stored in your system keychain) |
| `Test Connection` | Check that a provider is reachable and accepts your key |
| `Refresh Providers and Models` | Reload model lists from Groq, NVIDIA, OmniRoute and AgentRouter |
| `Show Diagnostics` | Status, key presence and recent errors for every provider (never shows keys) |
| `Show Network Quality` | Response time and error rate per provider |
| `OmniRoute: Set Up…` | Server URL, optional key, then a connection test |
| `OmniRoute: Change Server URL…` | Point the extension at another OmniRoute server (the URL must include `/v1`) |
| `OmniRoute: Set API Key…` / `Remove API Key` | Manage the optional OmniRoute key |
| `OmniRoute: Test Connection` / `Reload Models` | Check the server, reload its model list |
| `OmniRoute: Show Diagnostics` / `Show Request Log` | Configuration report; route, latency and cost of each request |
| `OmniRoute: Reset Settings…` | Restore OmniRoute defaults and remove its key |

## 🛡️ Reliability

- **Retries** — exponential backoff with full jitter on `408/429/5xx` and network errors; honors `Retry-After` on every transport path; never retries `400/401/403/404`, cancellations, or open circuits.
- **Circuit breaker** — per-provider, settings-driven; open circuits reject *instantly* instead of burning backoff time; automatic half-open recovery probe.
- **Timeouts** — separate request/discovery budgets; nothing hangs indefinitely.
- **Saturation awareness** — `503/529` bodies are inspected to distinguish *queue saturation* from *maintenance*; errors tell you which and what it means.
- **Live health**: each provider shows *Ready*, *Connected*, *API key needed*, *Rate limited* or *Connection problem* in the sidebar.
- **Streaming** — hardened SSE parser: fragmented chunks, multi-event frames, CRLF, comments, `[DONE]`, malformed-frame tolerance, trailing flushes. Reasoning deltas stream as native thinking parts.
- **Cancellation** — every request wires VS Code tokens into abort signals; cancelled streams release resources immediately.

## 🔒 Security

- 🔑 Credentials **only** in SecretStorage; legacy plaintext settings migrated away automatically and never logged.
- 🙈 Central logger redacts `Authorization` headers, bearer tokens, and sensitive keys; diagnostics expose only a boolean *configured* flag.
- 🌐 Base URLs validated before any network call: http/https only, embedded credentials rejected (SSRF guard).
- 🧰 Tool-call arguments parsed with prototype-pollution-safe JSON.
- 📋 Telemetry logging uses a strict header allowlist — nothing arbitrary is dumped.

## 🩺 Troubleshooting

| You see | What to do |
|---|---|
| *"… didn't accept your API key"* | Run `Set API Key…` for that provider. Keys are never deleted automatically. HTTP 403 usually means the key lacks access to that model or region. |
| OmniRoute shows no models | Run `OmniRoute: Test Connection`. The URL must end in `/v1`; `Show Diagnostics` shows the last error. |
| *"paused after repeated failures"* | The provider failed several times in a row and is paused for a short cooldown. Adjust it under **Settings › Copilot Amplify › Reliability**. |
| A new server model is missing | Run `Refresh Providers and Models`. Non-chat models (embeddings, rerank, speech) are hidden on purpose. |
| Replies seem stuck | Lower the request timeout in settings, turn on debug logging and check the **Copilot Amplify** output channel. |

## 💻 Development

```bash
npm install
npm run compile     # tsc → out/
npm run watch       # incremental build
npm run typecheck   # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm run lint        # eslint over src/ and tests/
npm test            # vitest; the VS Code API is mocked, no real keys needed
npm run package     # vsce → .vsix
```

Press <kbd>F5</kbd> in VS Code to try your build in an Extension Development Host.

Tests stub `fetch` and check what the extension actually sends and shows
(request URL and body, health states, tree labels) rather than which
internal methods were called. Copy the closest existing test when you add one.

### Publishing

Push a version tag — CI publishes to both registries and attaches the `.vsix` to the GitHub Release automatically. See `PUBLISHING.md` (not committed) for the full release checklist and secret setup.

## 🤝 Contributing

Contributions are welcome. Before opening a PR, `npm run typecheck && npm run lint && npm test`
must pass. Commits follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:` …).

### Adding a provider

Any provider with an OpenAI-compatible API needs only a descriptor. Using Groq as the template:

1. Optionally add details for well-known models to `src/core/models/catalog.ts`
   (limits, vision, tools). Models without details still work, with safe defaults.
2. Create `src/providers/<name>/index.ts`:

   ```ts
   export function createAcmeDescriptor(): AmplifyProviderDescriptor {
     return {
       id: 'acme',                                   // also add to ProviderId in core/provider/registry.ts
       vendor: 'LuneCode.CA-acme',                   // must match package.json
       displayName: 'Acme',
       treeIcon: 'rocket',                           // a codicon name
       createAuth: (secrets) => new BaseAuthManager(secrets, 'copilot-amplify.CA-acme.apiKey', 'Acme'),
       createProvider: (auth, state) =>
         new OpenAiCompatibleProvider(auth, state, {
           id: 'acme',
           displayName: 'Acme',
           baseURL: 'https://api.acme.example/v1',   // serves /models and /chat/completions
           knownModels: ACME_MODELS,                 // may be []
           notChat: /embed|whisper|tts/i,            // list entries that are not chat models
           newModelDefaults: { maxInputTokens: 32_768, maxOutputTokens: 8_192, toolCalling: true },
           // optional: supportsThinking, defaultTemperature, errorMessages, baseUrlForKey
         }),
     };
   }
   ```

3. Register it in `src/providers/index.ts` (`registry.register(createAcmeDescriptor())`).
4. Add the vendor to `contributes.languageModelChatProviders` in `package.json`.
5. Add a case to `tests/openAiCompatible.test.ts` that checks the model list and a chat request.

A provider with a different API extends `DynamicCatalogProvider` and implements
`fetchModels`, `canLoadModels`, `modelSupportsReasoning` and `testConnection`
(see `providers/agentrouter`).

### Ground rules

- API keys live only in SecretStorage: never in settings, logs, error messages or test fixtures.
- No network I/O during activation or in `provideLanguageModelChatInformation`.
- A 401 from a provider must never delete the stored key (gateways return spurious 401s).
- No new runtime dependencies without discussion; the VSIX ships only `openai`, `secure-json-parse` and `ts-pattern`.

## 📄 License

[ISC](LICENSE) © [Md Mojahid](https://github.com/mojahid2021)

<div align="center">

**⭐ Found this useful? Star the repo — it helps others discover it!**

</div>
