# Changelog

## [1.0.0] - 2026-06-13

- Initial release with full feature set:
  - **Xiaomi MiMo**: Integration with MiMo-V2-Pro, MiMo-V2-Flash, MiMo-V2-Omni models
  - **Z.ai (GLM)**: Support for GLM-4 and GLM-5 model families
  - **NVIDIA NIM**: OpenAI-compatible support for NVIDIA API Catalog models
  - **Groq API**: Support for Llama, GPT-OSS, Groq Compound, Qwen3 models
- **Performance**: API client caching to avoid recreating clients on each request
- **Refactoring**: Consolidated provider registration using data-driven approach in extension.ts
- **Refactoring**: Added `createAuthManager()` factory function in baseAuth.ts
- **Type optimization**: Added const assertions to model arrays for better inference
- **Security**: API keys stored via VS Code's built-in Secret Storage
- **Features**: Streaming responses, tool calling, and thinking block rendering support
