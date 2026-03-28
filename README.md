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

`memoryblock` is a lightweight framework for running isolated AI agents as local background workers. Instead of building monolithic chatbots, you provision dedicated workspaces called **blocks**, each with its own memory, tools, and execution loop.

Spin up a devops block to monitor your servers, a research block to scrape web data, and a home block to coordinate everything. They run independently - no shared state, no crossed wires.

**Why memoryblock?**

- **Persistent Memory** — Agents remember context across sessions. No repeated prompts.
- **Cost-Efficient** — Token pruning and lazy tool loading typically halve inference costs.
- **Portable** — Each block is a folder. Copy it to move an agent to a new machine.
- **Model Agnostic** — Native support for OpenAI, Anthropic, AWS Bedrock, and Google Gemini.
- **Cross-Platform** — Works everywhere - macOS, Linux, or Windows. Runs on Node.js ≥ 20 and Bun.

## Get Started in 60 Seconds

```bash
npm install -g memoryblock   # or: bun install -g memoryblock
mblk init                    # guided setup — pick your LLM provider
mblk start home              # your first agent is now running
```

That's it. You have a running AI agent with persistent memory, file access, and a web dashboard.

> **Bun users:** `mblk` automatically uses Bun when available for ~2x faster startup. Runs perfectly on Node.js too.

## Talk to Your Agent

Blocks are decoupled from the UI. Use whatever interface fits:

```bash
mblk start home                     # interactive CLI chat
mblk start home --channel telegram  # route to Telegram
mblk web                            # web dashboard at localhost:8420
```

The web dashboard gives you real-time streaming, cost tracking, memory inspection, and block management — all in one place.

## What Can Your Agents Do?

Every block ships with **22+ built-in tools** — no plugins required:

| Category | Tools | Available to |
|:---|:---|:---|
| **Files** | `read_file` · `write_file` · `append_to_file` · `replace_in_file` · `copy_file` · `move_file` · `delete_file` · `create_directory` · `file_info` · `list_directory` · `search_files` · `find_files` | All blocks |
| **Shell** | `execute_command` · `run_lint` · `run_build` · `run_test` | Superblocks |
| **Identity** | `update_monitor_identity` · `update_founder_info` · `send_channel_message` | All blocks |
| **System** | `system_info` · `get_current_time` · `list_blocks` | All / Superblocks |

### Need more? Add plugins:

```bash
mblk add web-search     # SERP querying via Brave Search
mblk add fetch-webpage  # Extract and chunk web page content
mblk add agents         # Let blocks spawn ephemeral sub-agents
```

## Permissions

Blocks are sandboxed by default. Each block only accesses its own directory.

| | Block *(default)* | Superblock |
|:---|:---:|:---:|
| Read/write own files | ✅ | ✅ |
| Identity & communication tools | ✅ | ✅ |
| System info & time | ✅ | ✅ |
| Shell commands | ❌ | ✅ |
| Files outside block directory | ❌ | ✅ |
| Cross-block visibility | ❌ | ✅ |

Elevate a block when it needs more power:

```bash
mblk superblock ops-monitor       # unrestricted access
mblk superblock ops-monitor --off  # back to sandboxed
```

**Tool approval:** Dangerous commands pause and ask for your confirmation right in the chat. Safe commands (`ls`, `grep`, `git status`, `npm run build`, etc.) run automatically.

## Commands

| Command | What it does |
|:---|:---|
| `mblk init` | Guided setup wizard |
| `mblk create <name>` | Create a new block |
| `mblk start [block]` | Start a block (or all blocks) |
| `mblk stop [block]` | Stop a block (or all blocks) |
| `mblk status` | See all blocks and their state |
| `mblk config [target]` | Edit config: `auth`, `<block>`, or global |
| `mblk superblock <block>` | Grant/revoke full system access |
| `mblk web` | Open the web dashboard |
| `mblk add / remove <plugin>` | Manage plugins |
| `mblk delete <block>` | Archive (or `--hard` delete) a block |
| `mblk reset <block>` | Clear memory and session |
| `mblk service install` | Auto-start on boot |
| `mblk shutdown` | Stop everything |

<details>
<summary><b>All server commands</b></summary>

| Command | What it does |
|:---|:---|
| `mblk server start` | Start the API & web UI server |
| `mblk server stop` | Stop the server |
| `mblk server status` | Show server PID and URL |
| `mblk server token` | View or regenerate auth token |
| `mblk restart` | Full restart of blocks + server |
| `mblk restore <name>` | Restore an archived block |
| `mblk permissions <block>` | View/edit block permissions |
| `mblk settings [plugin]` | View/edit plugin settings |

</details>

## Configuration

No more hunting for dotfiles:

```bash
mblk config           # global config
mblk config auth      # API keys and credentials
mblk config <block>   # block-specific config
```

Opens in your preferred editor (`$EDITOR` → `nano` → `vi` → `notepad`). Credentials are skippable during setup — add them whenever you're ready.

## How It Works

```
~/.memoryblock/ws/
├── config.json          # global settings
├── auth.json            # provider credentials
├── founder.md           # your profile (shared across blocks)
└── blocks/
    ├── home/
    │   ├── config.json  # block settings, adapter, permissions
    │   ├── monitor.md   # agent identity and personality
    │   ├── memory.md    # persistent context across sessions
    │   ├── session.json # crash-recovery session state
    │   └── logs/        # full conversation history
    └── ops-monitor/
        └── ...
```

Each block is fully self-contained. To back up an agent, copy its folder. To move it to another server, paste it. No databases, no migrations.

## Architecture

Built as a modular TypeScript monorepo with a strict DAG dependency graph:

| Package | Role |
|:---|:---|
| `memoryblock` | CLI entry point and setup tooling |
| `@memoryblock/core` | Engine runtime — Monitor, Gatekeeper, Memory Manager |
| `@memoryblock/tools` | 22+ built-in tools (files, shell, system) |
| `@memoryblock/api` | HTTP & WebSocket server (`node:http` + `ws`) |
| `@memoryblock/adapters` | LLM provider implementations |
| `@memoryblock/channels` | Transport — CLI, WebSocket, Telegram |
| `@memoryblock/types` | Shared TypeScript interfaces |
| `@memoryblock/daemon` | Background process lifecycle |
| `@memoryblock/web` | Web dashboard UI |
| `@memoryblock/locale` | i18n and formatting |

## Contributing & Support

We welcome PRs! See [CONTRIBUTING.md](.github/CONTRIBUTING.md).

If `memoryblock` is useful to you, consider [sponsoring the project](https://github.com/sponsors/mgks) or giving it a ⭐.

## License

Distributed under the MIT License. See `LICENSE` for more information.

![Website Badge](https://img.shields.io/badge/.*%20mgks.dev-blue?style=flat&link=https%3A%2F%2Fmgks.dev) ![Sponsor Badge](https://img.shields.io/badge/%20%20Become%20a%20Sponsor%20%20-red?style=flat&logo=github&link=https%3A%2F%2Fgithub.com%2Fsponsors%2Fmgks)