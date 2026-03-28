# @memoryblock/adapters

LLM adapters interface for **memoryblock**.

This package handles:
- OpenAI integration
- Anthropic integration
- AWS Bedrock integration
- Google Gemini integration
- Local model support via Ollama

## The `memoryblock` Ecosystem

**memoryblock** is a highly modular system. Here are the official packages:

**The Core**
*   [**memoryblock**](https://www.npmjs.com/package/memoryblock) - CLI orchestrator and command routing.
*   [**@memoryblock/core**](https://www.npmjs.com/package/@memoryblock/core) - Engine runtime, memory manager, gatekeeper.
*   [**@memoryblock/types**](https://www.npmjs.com/package/@memoryblock/types) - Shared TypeScript definitions and schemas.
*   [**@memoryblock/locale**](https://www.npmjs.com/package/@memoryblock/locale) - Localization strings and utilities.

**Integrations & Tooling**
*   [**@memoryblock/adapters**](https://www.npmjs.com/package/@memoryblock/adapters) - LLM provider adapters (OpenAI, Anthropic, Bedrock, etc).
*   [**@memoryblock/channels**](https://www.npmjs.com/package/@memoryblock/channels) - Communication channels (CLI, Telegram, Web).
*   [**@memoryblock/tools**](https://www.npmjs.com/package/@memoryblock/tools) - Tool registry and built-in definitions.
*   [**@memoryblock/daemon**](https://www.npmjs.com/package/@memoryblock/daemon) - Background process spawner and manager.
*   [**@memoryblock/api**](https://www.npmjs.com/package/@memoryblock/api) - HTTP/WebSocket API server.
*   [**@memoryblock/web**](https://www.npmjs.com/package/@memoryblock/web) - Front-end dashboard static files.

**Plugins**
*   [**@memoryblock/plugin-installer**](https://www.npmjs.com/package/@memoryblock/plugin-installer) - Plugin installer and registry manager.
*   [**@memoryblock/plugin-agents**](https://www.npmjs.com/package/@memoryblock/plugin-agents) - Secondary AI agents orchestrator.
*   [**@memoryblock/plugin-aws**](https://www.npmjs.com/package/@memoryblock/plugin-aws) - AWS integrations.
*   [**@memoryblock/plugin-fetch-webpage**](https://www.npmjs.com/package/@memoryblock/plugin-fetch-webpage) - Web content fetching and parsing.
*   [**@memoryblock/plugin-web-search**](https://www.npmjs.com/package/@memoryblock/plugin-web-search) - Web search capabilities.

## License

Distributed under the MIT License. See `LICENSE` for more information.