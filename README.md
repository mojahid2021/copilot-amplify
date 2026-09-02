<div align="center">

<img src="icon.png" alt="Copilot Amplify logo" width="128" />

# Copilot Amplify

**Extend GitHub Copilot Chat with the AI providers *you* choose.**

CA-Xiaomi MiMo · CA-Z.ai GLM · CA-Groq · CA-NVIDIA NIM · CA-Omniroute · CA-AgentRouter — all first-class,
equal siblings inside the VS Code Language Model API.

[![Version](https://img.shields.io/badge/version-2.2.0-blue)](CHANGELOG.md)
[![VS Code Marketplace](https://img.shields.io/badge/VS_Code_Marketplace-installed-0098FF?logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=mojahid2021.copilot-amplify)
[![Open VSX](https://img.shields.io/badge/Open_VSX-2.2.0-8A2BE2)](https://open-vsx.org/extension/mojahid2021/copilot-amplify)
[![Tests](https://img.shields.io/badge/tests-223%20passing-brightgreen)](#-development)
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
| 🔌 **Bring your own provider** | CA-Xiaomi MiMo, CA-Z.ai GLM, CA-Groq, CA-NVIDIA NIM, CA-Omniroute, and CA-AgentRouter work out of the box |
| ⚖️ **No privileged provider** | Every provider is an equal sibling — no hidden routing, no forced hierarchy |
| 🔐 **Secrets done right** | API keys live in VS Code SecretStorage (OS keychain), never in `settings.json` or logs |
| 🧠 **Full AI capability surface** | Streaming, tool calling, reasoning/thinking output, vision input, system prompts |
| 🛡️ **Production-grade reliability** | Retries with `Retry-After`, per-provider circuit breakers, timeouts everywhere, saturation-aware errors |
| 🌊 **Live model catalogs** | CA-Omniroute and CA-AgentRouter discover models from your server at runtime — new models appear without updating the extension |
| 👁️ **Observable** | Unified diagnostics, per-request telemetry logs, live health states in the tree view |

> **CA-Omniroute is a provider, not a middleman.** Its internal multi-provider
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
- [Documentation](#-documentation)
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

1. **Open the panel** — click the Copilot Amplify icon in the activity bar.
2. **Add a key** — click the 🔑 icon on any provider row and paste your API key. It goes straight into your OS keychain.
3. **Pick a model** — open Copilot Chat's model picker and choose e.g. *Z.ai · Glm 5.2*.
4. **Chat.** That's it.

No `settings.json` edits required. Full walkthrough with copy-paste recipes:
**[`docs/usage-examples.md`](docs/usage-examples.md)**

## 🔌 Supported Providers

| Provider | Catalog | Highlights |
|---|---|---|
| **Xiaomi MiMo** | Static (2 models) | Auto-routes token-plan (`tp-`) keys to the dedicated gateway; up to 1M-token context |
| **Z.ai GLM** | Static (10 models) | Reasoning-effort control on GLM-5.x; vision on `glm-5v-turbo` |
| **Groq** | Static (7 models) | Ultra-fast Llama & GPT-OSS serving |
| **CA-Xiaomi MiMo** | Static (2 models) | Auto-routes token-plan (`tp-`) keys to the dedicated gateway; up to 1M-token context |
| **CA-Z.ai GLM** | Static (10 models) | Reasoning-effort control on GLM-5.x; vision on `glm-5v-turbo` |
| **CA-Groq** | Static (7 models) | Ultra-fast Llama & GPT-OSS serving |
| **CA-NVIDIA NIM** | Static (17 models) | Broad open-model catalog with transparent ID mapping |
| **CA-Omniroute** | 🔄 Dynamic | Discovers models live from `GET /models`; custom chat endpoints supported; anonymous local operation |
| **CA-AgentRouter** | 🔄 Dynamic | Discovers models from `GET /api/pricing`; routes Claude models to the native Anthropic `messages` API and everything else to the OpenAI-compatible endpoint; single API key covers both transports |

Capabilities shown in the picker are **truthful by design** — a model is only
advertised with vision/tools/reasoning if it actually supports them.

## 🏗️ Architecture

```text
VS Code
    │
    ▼
VS Code Language Model API
    │
    ▼
┌─────────────────────────────────────────┐
│          Copilot Amplify Core           │
│                                         │
│  Provider Registry   Model Catalogs     │
│  Authentication      HTTP Transport     │
│  Streaming / SSE     Retry / Timeout    │
│  Circuit Breaker     Error Taxonomy     │
│  Context / Converter Thinking / Tools   │
│  Logging / Redaction Diagnostics        │
└────────────────────┬────────────────────┘
                     │
 CA-Xiaomi  CA-Z.ai  CA-Groq  CA-NVIDIA  CA-Omni
                     │┬─────────────┐
   ▼        ▼        ▼        ▼           ▼             ▼
 Xiaomi    Z.ai     Groq     NVIDIA    OmniRoute    CA-AgentRouter
 Provider  Provider Provider Provider  Provider       Provider
   │         │        │         │           │             │
   ▼         ▼        ▼         ▼           ▼             ▼
 MiMo API  Z.ai API Groq API NVIDIA NIM OmniRoute    Anthropic `/v1/messages`
                                                 Server     + OpenAI `/v1/chat/completions`Server
                                                 │
                                     ┌───────────┼───────────┐
                                     ▼           ▼           ▼
                                 Provider A  Provider B  Provider C
```

Adding a provider means adding one descriptor module + tests — no core changes.
See **[docs/adding-a-provider.md](docs/adding-a-provider.md)** for the full guide.

<details>
<summary><strong>Project layout</strong></summary>

```text
src/
├── core/
│   ├── api/            # GenericApiClient (OpenAI SDK), shared SSE parser
│   ├── auth/           # SecretStorage-backed BaseAuthManager
│   ├── context/        # LM↔wire converters, token estimation & truncation
│   ├── errors/         # Normalized error taxonomy + HTTP mapping
│   ├── logging/        # OutputChannel logger with secret redaction
│   ├── models/         # Static model catalogs per fixed-catalog provider
│   ├── provider/       # BaseChatProvider + ProviderRegistry
│   ├── resilience/     # TTLCache (coalescing), CircuitBreaker, saturation classifier
│   ├── retry/          # Backoff, jitter, Retry-After, cancellation
│   ├── thinking/       # <think>/<thought> stream extraction
│   ├── diagnostics.ts  # Unified credential-free report across providers
│   └── url.ts          # Base URL validation / normalization / joining
├── providers/
│   ├── xiaomi/  zai/  groq/  nvidia/   # Fixed-catalog descriptors
│   ├── omniroute/                      # Full dynamic provider module
│   └── index.ts                        # Registry assembly
├── commands/           # Command registrations
├── ui/                 # Providers & Models tree view
├── extension.ts        # Activation (lightweight, zero network I/O)
└── secretsMigration.ts # One-time plaintext→SecretStorage migration
tests/
├── mocks/vscode.ts     # Minimal vscode API mock for unit tests
├── helpers/sse.ts      # SSE stream builders
└── unit/               # 21 files, 220+ cases incl. cross-provider contract tests
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

> 💡 **CA-Omniroute anonymous mode:** no key needed for local servers — they work out of the box.

### General settings

| Setting | Default | Purpose |
|---|---|---|
| `copilot-amplify.enableReasoning` | `true` | Global reasoning toggle for thinking-capable models |
| `copilot-amplify.customSystemPrompt` | *(empty)* | Injected into every request across providers |
| `copilot-amplify.requestTimeoutMs` | `120000` | Chat request timeout for fixed-catalog providers |
| `copilot-amplify.debugLogging` | `false` | Debug-level logs in the output channel |
| `copilot-amplify.circuitBreaker.enabled` | `true` | Fail-fast after repeated failures — **every** provider |
| `copilot-amplify.circuitBreaker.failureThreshold` | `5` | Consecutive failures before a circuit opens |
| `copilot-amplify.circuitBreaker.resetTimeoutSeconds` | `30` | Cooldown before a half-open probe |

### CA-Omniroute settings

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
| `copilot-amplify.CA-omniroute.warmupOnStartup` | `false` | Discover models at activation instea

### CA-AgentRouter settings

| Setting | Default | Purpose |
|---|---|---|
| `copilot-amplify.CA-agentrouter.baseUrl` | `https://agentrouter.org/v1` | OpenAI-compatible base URL. **Must include the `/v1` path**. The Anthropic base URL is derived by stripping `/v1` (so `https://agentrouter.org`). |
| `copilot-amplify.CA-agentrouter.cacheTtlSeconds` | `300` | How long the discovered model list stays cached before refetching `GET {baseUrl}/api/pricing`. |
| `copilot-amplify.CA-agentrouter.requestTimeoutMs` | `120000` | Chat request timeout (covers connection + full stream) for both transports. |
| `copilot-amplify.CA-agentrouter.discoveryTimeoutMs` | `8000` | Catalog discovery / connection-test timeout. |
| `copilot-amplify.CA-agentrouter.warmupOnStartup` | `false` | Discover models at activation instead of first use. |d of first use |
| `copilot-amplify.CA-omniroute.logTelemetry` | `true` | Log routing/cost telemetry per request |

Base URLs are normalized — these are all equivalent, no `//v1` accidents:

```text
https://example.com        https://example.com/
https://example.com/v1     https://example.com/v1/
```

## 🎮 Commands

**General**

| Command | Description |
|---|---|
| `Copilot Amplify: Manage Providers…` | QuickPick hub: keys, tests, refresh, diagnostics |
| `Copilot Amplify: Refresh Providers & Models` | Invalidate caches + re-discover |
| `Copilot Amplify: Show Diagnostics` | Credential-free report for **all** providers |
| `Copilot Amplify: Set / Clear API Key` | Credential management (context-aware in the tree) |
| `Copilot Amplify: Test Connection` | Lightweight reachability + auth probe |
| `Copilot Amplify: Pin / Unpin / Select Model` | Favorites and active model |

**OmniRoute-specific**

| Command | Description |
|---|---|
| `OmniRoute: Configure…` | Guided: base URL → optional key → test (chat endpoint is now fixed at `{baseUrl}/chat/completions`) |
| `OmniRoute: Edit Base URL` | Quick base-URL override from the tree ACTIONS panel or the Manage QuickPick; busts the model cache and re-tests the connection. The base URL **must include the `/v1` path**. |
| `OmniRoute: Set / Remove API Key` | SecretStorage credential management |
| `OmniRoute: Test Connection` | Latency + chat-model count report |
| `OmniRoute: Refresh Models` | Force re-discovery of `/models` |
| `OmniRoute: Show Diagnostics` | Full configuration & health report |
| `OmniRoute: Reset Configuration` | Restore defaults + clear stored key |
| `Show Omniroute Telemetry` | Open the per-request telemetry log channel |

## 🛡️ Reliability

- **Retries** — exponential backoff with full jitter on `408/429/5xx` and network errors; honors `Retry-After` on every transport path; never retries `400/401/403/404`, cancellations, or open circuits.
- **Circuit breaker** — per-provider, settings-driven; open circuits reject *instantly* instead of burning backoff time; automatic half-open recovery probe.
- **Timeouts** — separate request/discovery budgets; nothing hangs indefinitely.
- **Saturation awareness** — `503/529` bodies are inspected to distinguish *queue saturation* from *maintenance*; errors tell you which and what it means.
- **Live health** — `connected` · `not-configured` · `error` · `rate-limited` · `auth-failed`, reflected in the tree in real time.
- **Streaming** — hardened SSE parser: fragmented chunks, multi-event frames, CRLF, comments, `[DONE]`, malformed-frame tolerance, trailing flushes. Reasoning deltas stream as native thinking parts.
- **Cancellation** — every request wires VS Code tokens into abort signals; cancelled streams release resources immediately.

## 🔒 Security

- 🔑 Credentials **only** in SecretStorage; legacy plaintext settings migrated away automatically and never logged.
- 🙈 Central logger redacts `Authorization` headers, bearer tokens, and sensitive keys; diagnostics expose only a boolean *configured* flag.
- 🌐 Base URLs validated before any network call: http/https only, embedded credentials rejected (SSRF guard).
- 🧰 Tool-call arguments parsed with prototype-pollution-safe JSON.
- 📋 Telemetry logging uses a strict header allowlist — nothing arbitrary is dumped.

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| *"Authentication failed (401)"* | Re-set the key (tree 🔑). Keys are **never** deleted automatically. `403` usually means region/access restrictions. |
| OmniRoute shows no models | Run `OmniRoute: Test Connection`. Check diagnostics for the last discovery error; missing `/v1` in the Base URL is the usual culprit. |
| *"circuit open"* errors | The breaker tripped after repeated failures. Wait out the cooldown or lower `failureThreshold`; disable entirely via `circuitBreaker.enabled`. |
| New server model not in picker | `Refresh Providers & Models`. Non-chat entries (embeddings/rerank/TTS) are filtered by design. |
| Requests feel stuck | Lower `requestTimeoutMs` / `omniroute.requestTimeoutMs`; enable `debugLogging` and check the output channel. |

More walkthroughs: see the in-repo `docs/` guides.

## 💻 Development

```bash
npm install
npm run compile     # tsc build → out/
npm run watch       # incremental build
npm run lint        # eslint (src + tests, typed)
npm run typecheck   # tsc --noEmit (strict + noUncheckedIndexedAccess)
npm test            # vitest — 223 tests, fully mocked, no real keys needed
npm run package     # vsce → .vsix
```

The test suite covers URL normalization, SSE robustness, retry semantics,
circuit-breaker transitions, cache coalescing, error taxonomy, secret
redaction, tool-call parsing, context-truncation integrity, OmniRoute
discovery/filtering, connection testing, session handling, telemetry
normalization, secrets migration, and a cross-provider contract suite.

### Publishing

Releases go to both registries:

```bash
npm run package                          # build copilot-amplify-<version>.vsix

# VS Code Marketplace (publisher: mojahid2021)
npx vsce publish

# Open VSX (VSCodium, Gitpod, and other VS Code forks)
npx ovsx publish --pat <OPEN_VSX_PAT>
```

## 🤝 Contributing

Contributions are welcome! Good first steps:

1. 📖 Read **[docs/adding-a-provider.md](docs/adding-a-provider.md)** — adding a provider requires exactly one descriptor module, registration wiring, and tests. No core changes.
2. 🐛 Check [open issues](https://github.com/mojahid2021/copilot-amplify/issues) or file a bug with reproduction steps.
3. ✅ Before opening a PR: `npm run typecheck && npm run lint && npm test` must pass.
4. 📝 Follow Conventional Commits (`feat:`, `fix:`, `docs:` …).

Design decisions are documented as ADRs in [`docs/adr/`](docs/adr/).

## 📚 Documentation

| Doc | Contents |
|---|---|
| [`docs/usage-examples.md`](docs/usage-examples.md) | Copy-paste setup recipes, endpoint examples, tuning, troubleshooting |
| [`docs/adding-a-provider.md`](docs/adding-a-provider.md) | Step-by-step guide to contributing a new provider |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |

## 📄 License

[ISC](LICENSE) © [Md Mojahid](https://github.com/mojahid2021)

<div align="center">

**⭐ Found this useful? Star the repo — it helps others discover it!**

</div>
