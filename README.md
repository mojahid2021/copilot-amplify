<!-- markdownlint-disable MD033 -->

<h1 align="center">🤖 Copilot Amplify</h1>

<p align="center">
  <strong>Extend GitHub Copilot Chat with additional AI model providers</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=LuneCode.copilot-amplify"><img src="https://vsmarketplacebadges.dev/version/LuneCode.copilot-amplify.png" alt="VS Marketplace Version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=LuneCode.copilot-amplify"><img src="https://vsmarketplacebadges.dev/downloads/LuneCode.copilot-amplify.png" alt="VS Marketplace Downloads"></a>
  <br>
  <a href="https://github.com/mojahid2021/copilot-amplify"><img src="https://img.shields.io/badge/GitHub-Repository-181717?logo=github&logoColor=white" alt="GitHub"></a>
  <a href="https://github.com/mojahid2021/copilot-amplify/stargazers"><img src="https://img.shields.io/github/stars/mojahid2021/copilot-amplify?logo=github" alt="GitHub Stars"></a>
  <a href="https://github.com/mojahid2021/copilot-amplify/blob/main/LICENSE"><img src="https://img.shields.io/github/license/mojahid2021/copilot-amplify?style=flat" alt="License"></a>
  <a href="https://www.paypal.com/donate?hosted_button_id=MZQS5CZ68NGEW"><img src="https://img.shields.io/badge/Donate-PayPal-00457C?logo=paypal&logoColor=white" alt="Donate"></a>
</p>

---

<p align="center">
  <img src="https://raw.githubusercontent.com/mojahid2021/copilot-amplify/main/icon.png" alt="Copilot Amplify Icon" style="width: 128px; border-radius: 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.2);">
</p>

## ✨ Features

- **Xiaomi MiMo**: Integration for Xiaomi's AI models directly in your chat. Automatically supports both Pay-as-you-go (`sk-...`) and Token Plan (`tp-...`) API keys and routes to the correct endpoints.
- **Z.ai (GLM)**: Support for Z.ai GLM-4 and GLM-5 models.
- **NVIDIA NIM**: OpenAI-compatible support for models from the NVIDIA API Catalog.
- **Omniroute**: Local OpenAI-compatible aggregator with dynamic model discovery, routing combos, semantic-cache/memory/compression headers, session tagging and cost telemetry.
- **Native Integration**: Works seamlessly with the VS Code `LanguageModelChat` API.
- **Advanced Capabilities**: Supports streaming responses, tool calling, and thinking block rendering.
- **Secure Key Storage**: No leaked keys! We use VS Code's built-in Secret Storage for your API keys.
- **Connectivity Testing**: Built-in commands to verify your setup works correctly.

## 📖 Available Models

### Xiaomi

| Model | Context Window | Max Output | Image Input | Tool Calling |
|---|---|---|---|---|
| **MiMo-V2-Pro** | 1,048,576 | 131,072 | No | Yes |
| **MiMo-V2-Flash** | 262,144 | 131,072 | No | Yes |
| **MiMo-V2-Omni** | 262,144 | 131,072 | Yes | Yes |

### Z.AI

| Model | Context Window | Max Output | Image Input | Tool Calling |
|---|---|---|---|---|
| **GLM-5.1** | 204,800 | 131,072 | No | Yes |
| **GLM-5V-Turbo** | 204,800 | 131,072 | Yes | Yes |
| **GLM-5 Turbo** | 204,800 | 131,072 | No | Yes |
| **GLM-5** | 204,800 | 131,072 | No | Yes |
| **GLM-4.7** | 204,800 | 131,072 | No | Yes |
| **GLM-4.7 Flash** | 204,800 | 131,072 | No | Yes |
| **GLM-4.6** | 204,800 | 131,072 | No | Yes |
| **GLM-4.5** | 131,072 | 98,304 | No | Yes |
| **GLM-4.5 Air** | 131,072 | 98,304 | No | Yes |

### NVIDIA NIM

| Model | Context Window | Max Output | Image Input | Tool Calling |
|---|---|---|---|---|
| **Gemma 4 31B IT** (`google/gemma-4-31b-it`) | 262,144 | 8,192 | Yes | Yes |
| **Nemotron 3 Ultra 550B** (`nvidia/nemotron-3-ultra-550b-a55b`) | 1,048,576 | 16,384 | No | Yes |
| **Nemotron 3 Super 120B** (`nvidia/nemotron-3-super-120b-a12b`) | 1,048,576 | 16,384 | No | Yes |
| **DeepSeek V4 Flash** (`deepseek-ai/deepseek-v4-flash`) | 1,048,576 | 16,384 | No | Yes |
| **MiniMax M3** (`minimaxai/minimax-m3`) | 1,048,576 | 16,384 | Yes | Yes |
| **Step 3.5 Flash** (`stepfun-ai/step-3.5-flash`) | 262,144 | 16,384 | No | Yes |
| **GLM-5.2** (`z-ai/glm-5.2`) | 1,000,000 | 16,384 | No | Yes |
| **Devstral 2 123B Instruct** (`mistralai/devstral-2-123b-instruct-2512`) | 262,144 | 16,384 | No | Yes |
| **Kimi K2.6** (`moonshotai/kimi-k2.6`) | 262,144 | 16,384 | Yes | Yes |
| **Qwen3 Coder 480B** (`qwen/qwen3-coder-480b-a35b-instruct`) | 262,144 | 16,384 | No | Yes |
| **Magistral Small 2506** (`mistralai/magistral-small-2506`) | 131,072 | 16,384 | No | No |
| **Granite 3.3 8B Instruct** (`ibm/granite-3.3-8b-instruct`) | 131,072 | 8,192 | No | Yes |
| **QwQ 32B** (`qwen/qwq-32b`) | 131,072 | 32,768 | No | No |
| **Falcon 3 7B Instruct** (`tiiuae/falcon3-7b-instruct`) | 32,768 | 8,192 | No | No |

### Omniroute (local aggregator)

Omniroute is a local OpenAI-compatible aggregator that routes requests to the
best upstream provider for each model (combos like `auto/best-coding`) and adds
semantic caching, memory, compression and cost attribution. Copilot Amplify
discovers the live model list from `GET /v1/models` each time, so every combo
and provider-prefixed model on your server appears in the Copilot Chat picker.

| Feature | Notes |
|---|---|
| Dynamic model discovery | Live list from the server (cached 5 min, configurable) |
| Slash-id encoding | `auto/best-coding` ⇄ `auto__best-coding` so IDs survive the Copilot picker |
| Thinking support | Reasoning models stream reasoning; no-thinking Claude variants resolve to the real model with reasoning suppressed |
| Cache / memory / compression headers | `X-OmniRoute-No-Cache`, `x-omniroute-no-memory`, `x-omniroute-compression` driven by settings |
| Session tagging | `X-OmniRoute-Session-Id` per chat conversation (feeds memory + `call_logs.session_tag`) |
| Cost telemetry | Routing decision, provider, latency, tokens, cost and cache savings logged to the `Omniroute` output channel |

**Setup** — set the Omniroute API key via the Providers panel (or the
`copilot-amplify.omniroute.apiKey` setting). If your server runs elsewhere, set
`copilot-amplify.omniroute.baseUrl` (default `http://localhost:20128/v1`).

**Settings** (`copilot-amplify.omniroute.*`):

- `baseUrl` — server URL including `/v1` (default `http://localhost:20128/v1`).
- `noCache` — send `X-OmniRoute-No-Cache: true` (default `false`, caching on).
- `noMemory` — send `x-omniroute-no-memory: true` to skip memory + skills
  injection (default `true` to avoid per-call token/cost overhead; set `false`
  together with a stable `sessionId` to use OmniRoute memory).
- `compression` — per-request compression override (`off`, `default`,
  `engine:<id>`, or a combo id).
- `sessionId` — fixed session tag sent via `X-OmniRoute-Session-Id` (empty =
  one generated per chat conversation).
- `progress` — send `X-OmniRoute-Progress: true` for progress events.
- `modelCacheTtlSeconds` — model-list cache TTL (default `300`).
- `logTelemetry` — log response cost/routing headers (default `true`).

**Telemetry** — run **Copilot Amplify: Show Omniroute Telemetry** (or check the
`Omniroute` output channel) to see `model`, `provider`, `route`, `latency_ms`,
`tokens_in/out`, `cost_usd`, `cache`/`cache_hit`/`cost_saved_usd` for every
request.

## 🚀 Usage

1. **Install** the extension from the VS Code Marketplace or Open VSX.
2. Open your **Language Models** panel in VS Code.
3. Click **Add Provider** and select **Xiaomi**, **Z.ai**, or **NVIDIA NIM**.
4. Enter your API key when prompted.
5. You can now select models from these providers in GitHub Copilot Chat.

> Note: VS Code currently exposes extension-contributed language model providers to users on individual GitHub Copilot plans.

## ⚙️ Commands

- `copilot-amplify.xiaomi.manage`: Manage Xiaomi provider (set/clear API key, test connection).
- `copilot-amplify.glm.manage`: Manage Z.ai (GLM) provider (set/clear API key, test connection).
- `copilot-amplify.nvidia.manage`: Manage NVIDIA NIM provider (set/clear API key, test connection).
- `copilot-amplify.omniroute.manage`: Manage Omniroute provider (set/clear API key, test connection).
- `copilot-amplify.omniroute.showTelemetry`: Show the Omniroute telemetry output channel (routing, latency, tokens, cost, cache).

## 🔒 Security & Privacy

- **Local Processing**: The extension acts as a bridge between VS Code and the provider APIs.
- **No Mid-man**: Your requests go directly to the provider endpoints.
- **Encrypted Keys**: API keys are stored in the OS-level keychain via VS Code.

---

<p align="center">
  <strong>🙏 Thank you for using Copilot Amplify!</strong>
</p>
