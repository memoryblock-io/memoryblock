<div align="center">

  <!-- PROJECT TITLE -->
  <h3>
    <img width="240" alt="memoryblock logo" src="https://github.com/user-attachments/assets/0de43158-86ab-4b8d-be3e-5c75a74617a2" />
  </h3>
  
  <!-- ONE LINE SUMMARY -->
  <p>
    <b>Run AI agents that remember, think, and work - without burning through your budget.</b>
  </p>
  
  <!-- BADGES -->
  <p>
    <a href="https://www.npmjs.com/package/memoryblock"><img src="https://img.shields.io/npm/v/memoryblock.svg?style=flat-square&color=CB3837" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/memoryblock?activeTab=versions"><img src="https://img.shields.io/npm/dt/memoryblock.svg?style=flat-square&color=38bd24" alt="downloads"></a>
    <a href="https://github.com/memoryblock-io/memoryblock/stargazers"><img src="https://img.shields.io/github/stars/memoryblock-io/memoryblock?style=flat-square&logo=github" alt="stars"></a>
    <a href="https://github.com/memoryblock-io/memoryblock/blob/main/LICENSE"><img src="https://img.shields.io/github/license/memoryblock-io/memoryblock.svg?style=flat-square&color=A31F34" alt="license"></a>
  </p>

  <!-- MENU -->
  <p>
    <h4>
      <a href="https://memoryblock.io">Website</a> • 
      <a href="https://docs.memoryblock.io/getting-started/installation/">Documentation</a> • 
      <a href="https://github.com/memoryblock-io/memoryblock/issues">Report Bug</a>
    </h4>
  </p>

  <!-- PREVIEW -->
  <p>
    <br/>
    <img width="800" alt="memoryblock preview" src="https://github.com/user-attachments/assets/39fa464b-9cda-498c-a04c-b817b0af826c" />
    <br/>
    <sup><i>memoryblock web client dashboard preview</i></sup>
  </p>

</div>

`memoryblock` is a lightweight framework for orchestrating isolated AI background workers. Instead of building monolithic chatbots, we provision local workspaces called **blocks**. Each block acts as a dedicated environment equipped with its own continuous memory, toolset, and execution loop.

Spawn a devops block to watch your infrastructure, a research block to scrape web data, and your primary home block to coordinate tasks. No state pollution, no crossed context boundaries.

* **Absolute Isolation**: Every agent lives inside a dedicated filesystem directory (`config.json`, `memory.md`, `logs/`). To move an agent to a new server, you just copy its folder. No centralized databases to manage.
* **Token Pruning**: Running background agents is historically expensive. `memoryblock` mitigates this by lazy-loading tool schemas only when invoked, and proactively truncating long tool outputs once analyzed. This typically halves the cost of sustained sessions.
* **Native & Lean**: Zero dependency on heavy Node.js runtimes or Electron ecosystems. The core engine, HTTP server, and WebSocket router rely purely on [Bun's](https://bun.sh) native primitives for maximal I/O speed and minimal RAM overhead.
* **Model Agnostic**: Provision blocks dynamically utilizing native definitions for OpenAI, Anthropic, AWS Bedrock, or Google Gemini.

## Quick Start

`memoryblock` leverages Bun under the hood for native execution speed. If you use npm, we automatically manage the local Bun environment for you.

**Install the framework globally:**
```bash
bun install -g memoryblock     # Option A: Fastest
npm install -g memoryblock     # Option B: Managed internally
```

**Initialize your environment:**
```bash
mblk init
```
*This interactive wizard verifies your local environment and configures your initial LLM provider credentials.*

**Start your default block:**
```bash
mblk start [block-name]
```
*Your autonomous assistant is now running in the background.*

## Working with Channels

Your blocks are decoupled from the UI. Communicate with them via the terminal, secure web dashboard, or standard chat clients. 

**Launch the Web Dashboard:**
```bash
mblk web
```
*Access real-time stream logs, cost tracking, and memory management at `localhost:8420`.*

**Route a block to social channels:**
```bash
mblk start home --channel telegram
```
*Securely interact with your existing agent state from anywhere without losing active history.*

## Command Reference

| Command | Description |
|:---|:---|
| `mblk init` | Interactive setup - configure credentials and create your first block |
| `mblk create <name>` | Create a new block (isolated AI workspace) |
| `mblk start [block]` | Start a block's monitor loop (or all blocks) |
| `mblk stop [block]` | Stop a running block monitor (or all blocks) |
| `mblk status` | Show all blocks and their state |
| `mblk delete <block>` | Archive a block safely (use `--hard` to permanently delete) |
| `mblk restore <name>` | Restore an archived block |
| `mblk reset <block>` | Reset memory, costs, and session (use `--hard` to wipe identity) |
| `mblk permissions <block>` | View or update block permissions |
| `mblk settings [plugin]` | View or edit plugin settings |
| `mblk add [plugin]` | Install a plugin (no args lists available) |
| `mblk remove <plugin>` | Remove an installed plugin |
| `mblk server start` | Start the web UI and API server |
| `mblk server stop` | Stop the running server |
| `mblk server status` | Show server status |
| `mblk server token` | View or regenerate the API auth token |
| `mblk service install` | Register memoryblock to start on boot/login |
| `mblk shutdown` | Stop all blocks and the server |
| `mblk restart` | Full restart — shutdown then start everything as daemons |

Full reference: [command docs](https://docs.memoryblock.io/commands/)

## Plugins

Blocks come with a core set of tools. Need more? Add them:

```bash
mblk add web-search    # Enables high-fidelity SERP querying
mblk add fetch-webpage # Extracts and chunks text from structured URLs
mblk add agents        # Allows blocks to spawn ephemeral sub-agents
```

Adapters for **OpenAI, Anthropic, Google Gemini, and AWS Bedrock** are natively supported out-of-the-box. Adding a custom provider adapter requires implementing a single unified payload interface.

## Monorepo Architecture

`memoryblock` is built as a highly modular TypeScript monorepo utilizing a strict one-way Directed Acyclic Graph (DAG) for dependency management. All sub-packages are independently publishable.

| Package | Responsibility |
|:---|:---|
| `memoryblock` | Global executable wrapper, setup tooling, and CLI orchestration. |
| `@memoryblock/core` | Extracted engine runtime (Gatekeeper, Memory Manager, Monitor loops). |
| `@memoryblock/types` | Centralized Zod validation schemas and TypeScript interfaces. |
| `@memoryblock/daemon` | Low-level OS process spawner and background lifecycle manager. |
| `@memoryblock/adapters` | Unified REST/SDK implementations for LLM providers. |
| `@memoryblock/channels` | Transport layer for CLI, WebSockets, and messaging platforms. |
| `@memoryblock/tools` | Core functional schemas (File I/O, OS interactions). |
| `@memoryblock/api` | Fast, dependency-injected HTTP web server integration. |
| `@memoryblock/locale` | Formatting tools and centralized translation strings. |
| `@memoryblock/web` | Standalone UI distribution package. |

## Community & Support

- **Contributing**: We welcome PRs! See [CONTRIBUTING.md](.github/CONTRIBUTING.md).
- **Support**: If you find `memoryblock` useful, please consider [sponsoring the project](https://github.com/sponsors/mgks) or giving it a star ⭐.

## License

Distributed under the MIT License. See `LICENSE` for more information.

![Website Badge](https://img.shields.io/badge/.*%20mgks.dev-blue?style=flat&link=https%3A%2F%2Fmgks.dev) ![Sponsor Badge](https://img.shields.io/badge/%20%20Become%20a%20Sponsor%20%20-red?style=flat&logo=github&link=https%3A%2F%2Fgithub.com%2Fsponsors%2Fmgks)