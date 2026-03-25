# @memoryblock/types

Core TypeScript definitions and schemas for **memoryblock**.

This package handles:
- Shared TypeScript interfaces
- Zod schemas for structured data
- Core engine type declarations

## The `memoryblock` Ecosystem

**memoryblock** is a highly modular system. Here are the official packages:

**The Core**
*   [**memoryblock**](https://www.npmjs.com/package/memoryblock) - The core engine interface and types.
*   [**@memoryblock/daemon**](https://www.npmjs.com/package/@memoryblock/daemon) - Background daemon manager.
*   [**@memoryblock/api**](https://www.npmjs.com/package/@memoryblock/api) - Core REST and WebSocket API server.

**Integrations & Tooling**
*   [**@memoryblock/adapters**](https://www.npmjs.com/package/@memoryblock/adapters) - LLM adapters (OpenAI, Anthropic, Bedrock, etc).
*   [**@memoryblock/channels**](https://www.npmjs.com/package/@memoryblock/channels) - Communication channels (CLI, Telegram, Web).
*   [**@memoryblock/tools**](https://www.npmjs.com/package/@memoryblock/tools) - Standard tool definitions and schemas.
*   [**@memoryblock/locale**](https://www.npmjs.com/package/@memoryblock/locale) - Localization strings and formatting.
*   [**@memoryblock/web**](https://www.npmjs.com/package/@memoryblock/web) - Front-end dashboard and Web UI.
*   [**@memoryblock/types**](https://www.npmjs.com/package/@memoryblock/types) - Core TypeScript definitions and schemas.

**Plugins**
*   [**@memoryblock/plugin-installer**](https://www.npmjs.com/package/@memoryblock/plugin-installer) - Plugin installer and registry manager.
*   [**@memoryblock/plugin-agents**](https://www.npmjs.com/package/@memoryblock/plugin-agents) - Secondary AI agents orchestrator.
*   [**@memoryblock/plugin-aws**](https://www.npmjs.com/package/@memoryblock/plugin-aws) - AWS integrations.
*   [**@memoryblock/plugin-fetch-webpage**](https://www.npmjs.com/package/@memoryblock/plugin-fetch-webpage) - Web content fetching and parsing.
*   [**@memoryblock/plugin-web-search**](https://www.npmjs.com/package/@memoryblock/plugin-web-search) - Web search capabilities.

## License

Distributed under the MIT License. See `LICENSE` for more information.