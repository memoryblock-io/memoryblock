<div align="center">

  <!-- PROJECT TITLE -->
  <h3>
    <img width="240" alt="memoryblock logo" src="https://github.com/user-attachments/assets/0de43158-86ab-4b8d-be3e-5c75a74617a2" />
  </h3>
  
  <!-- ONE LINE SUMMARY -->
  <p>
    <b>The lightweight agent OS. Isolated AI workspaces that remember, think, and run — on your machine.</b>
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
    <img width="720" alt="memoryblock preview" src="https://github.com/user-attachments/assets/39fa464b-9cda-498c-a04c-b817b0af826c" />
    <br/>
    <sup><i>memoryblock web client dashboard preview</i></sup>
  </p>

</div>

`memoryblock` is a lightweight framework for running isolated AI workspaces as local background workers. Instead of spinning up monolithic chatbots, you provision dedicated workspaces called **blocks** — each with its own monitor, memory, tools, and execution loop.

A devops block watches your servers. A research block scrapes and summarizes data. A home block coordinates everything. They run independently — no shared state, no crossed wires.

## Terminology

Memoryblock uses specific terms that mean different things than the typical AI landscape. Understanding these will help you navigate the system:

| Term | What it is | Has its own |
|:---|:---|:---|
| **Founder** | You — the human user. Your profile lives in `founder.md` and is shared across all blocks so every monitor knows who it's working for. | Profile, preferences |
| **Block** | An isolated workspace. Think of it as a container for an AI personality — its own directory with config, memory, logs, and tools. | Memory, config, permissions, logs, cron jobs |
| **Monitor** | The intelligence inside a block. This is what other platforms call an "AI agent." Each monitor has a name, emoji, personality, and its own conversation loop. | Identity, personality, tool access, conversation history |
| **Agent** | A sub-process spawned by a monitor for a specific task. Agents are ephemeral — they run, report back, and get terminated. Only monitors can create them. | Isolated workspace, limited tools, inbox |

```
Founder (you)
└── Block: home
    └── Monitor: 👱🏼‍♀️ Nova  ← the AI assistant running inside this block
        ├── Agent: 🤖 "researcher"  ← temporary sub-task worker
        └── Agent: 🤖 "writer"      ← another temporary worker
```

Monitors are persistent — they remember everything across sessions. Agents are disposable — they exist only for the task that spawned them.

## Why Memoryblock?

<table>
<tr>
<td width="50%" valign="top">

### 🏗️ Block Architecture
Each block is an isolated workspace — its own memory, config, tools, and logs. Like containers, but for AI. Copy a folder to move a monitor to another machine.

### ⚡ Lightweight & Fast
No Docker. No Python runtime. No heavy dependencies. Ships as a single npm package, boots instantly on Bun or Node.js. Runs on a $5 VPS as comfortably as a MacBook Pro.

### 🧠 Persistent Memory
Monitors remember context across sessions via smart memory summarization. No repeated prompts, no lost context. Sessions auto-resume on crash recovery.

</td>
<td width="50%" valign="top">

### 📡 Multi-Channel Sync
Start a conversation on CLI, continue it on the web dashboard, pick it up on Telegram — the same monitor, the same context, seamlessly.

### 🛡️ Safe by Default
Blocks are sandboxed. Dangerous commands pause for human approval. Safe commands auto-execute. Elevate to Superblock only when needed.

### 🔌 Model Agnostic
Native adapters for OpenAI, Anthropic, Google Gemini, and AWS Bedrock. Connect the model that fits your task.

</td>
</tr>
</table>

## Get Started in 60 Seconds

```bash
npm install -g memoryblock   # or: bun install -g memoryblock
mblk init                    # guided setup — pick your LLM provider
mblk start home              # your first monitor is running
```

That's it. You have a running monitor with persistent memory, file access, and a web dashboard.

> **Bun users:** When available, `mblk` automatically uses Bun for ~2x faster startup. Works perfectly on Node.js too.

## Talk to Your Monitor

Blocks are decoupled from the interface. Use whatever channel fits your workflow:

```bash
mblk start home                     # interactive CLI chat
mblk start home -d                  # background daemon mode
mblk start home --channel telegram  # route to Telegram
mblk web                            # web dashboard at localhost:8420
```

## Built-In Tools

Every block ships with **30+ built-in tools** — no plugins required:

| Category | Tools |
|:---|:---|
| **Files** | `read_file` · `write_file` · `replace_in_file` · `append_to_file` · `copy_file` · `move_file` · `delete_file` · `create_directory` · `list_directory` · `search_files` · `find_files` · `file_info` |
| **Shell** | `execute_command` · `run_lint` · `run_build` · `run_test` |
| **Agents** | `create_agent` · `query_agent` · `message_agent` · `list_agents` · `terminate_agent` |
| **Scheduling** | `schedule_cron_job` · `list_cron_jobs` · `remove_cron_job` |
| **Identity** | `update_monitor_identity` · `update_founder_info` · `send_channel_message` |
| **System** | `system_info` · `get_current_time` · `list_blocks` · `get_token_usage` |
| **Config** | `auth_read` · `auth_write` · `list_auth_providers` · `update_block_config` |

### Extend with Plugins

```bash
mblk add web-search     # SERP querying via Brave Search
mblk add fetch-webpage  # Extract and chunk web page content
mblk add agents         # Sub-agent orchestration
mblk add aws            # AWS service tools
```

Plugins auto-install if missing — when you create a block and select capabilities, memoryblock installs what's needed.

## Token Efficiency

Memoryblock is designed from the ground up to minimize token consumption:

| Optimization | How it works |
|:---|:---|
| **Lazy tool loading** | Tools are only sent to the LLM after the monitor discovers them — saves ~2,500 tokens per turn |
| **Tool result trimming** | Large outputs (file contents, command results) are automatically truncated in conversation history |
| **Smart memory compaction** | When context grows large, the monitor summarizes key info and resets — no redundant history |
| **Session state recovery** | Conversations persist to disk so you never re-explain context after a restart |
| **Discovery → Use → Compact cycle** | Full tool schemas sent once, then compacted to a reminder for all subsequent turns |

## Monitor → Agent Orchestration

Monitors can spawn agents for parallel work:

```
Monitor: 👱🏼‍♀️ Nova (home block)
├── create_agent("researcher", "Find pricing for competitor X")
├── create_agent("writer", "Draft the comparison doc")
├── query_agent("researcher")  → gets results
├── message_agent("writer", "Here's the data from research...")
└── terminate_agent("researcher")  → cleanup
```

Agents run in the block's `agents/` directory with their own isolated context. The monitor can message them asynchronously without blocking its own conversation. Agents are ephemeral — they can't create other agents, and they have a limited tool set compared to the monitor.

## Background & Scheduling

Run blocks as background daemons with built-in cron scheduling:

```bash
mblk start ops-monitor -d          # daemon mode
mblk service install               # auto-start on boot (launchd / systemd)
```

Your monitor can schedule its own tasks:

```
"Schedule a cron job: check server health every hour"
→ schedule_cron_job("health-check", "0 * * * *", "Run uptime check on production servers")
```

The Monitor's background tick loop automatically triggers scheduled jobs.

## Permissions & Security

Blocks are sandboxed by default. Elevate only when needed.

| | Block *(default)* | Superblock |
|:---|:---:|:---:|
| Read/write own files | ✅ | ✅ |
| Identity & communication tools | ✅ | ✅ |
| Shell commands | ❌ | ✅ |
| Files outside block directory | ❌ | ✅ |
| Cross-block visibility | ❌ | ✅ |

```bash
mblk superblock ops-monitor        # grant full access
mblk superblock ops-monitor --off  # revoke
```

**Interactive tool approval:** When a monitor tries to run a command, you see exactly what it wants to execute and approve or deny — in the CLI, web dashboard, or Telegram.

## Commands

| Command | What it does |
|:---|:---|
| `mblk init` | Guided setup wizard |
| `mblk create <name>` | Create a new block |
| `mblk start [block]` | Start block(s) — interactive or `-d` for daemon |
| `mblk stop [block]` | Stop a block (or all blocks) |
| `mblk status` | See all blocks and their state |
| `mblk config [target]` | Edit config: `auth`, `<block>`, or global |
| `mblk superblock <block>` | Grant/revoke full system access |
| `mblk update` | Update and restart all services |
| `mblk web` | Open the web dashboard |
| `mblk add / remove <plugin>` | Manage plugins |
| `mblk delete <block>` | Archive (or `--hard` delete) a block |
| `mblk reset <block>` | Clear memory and session |
| `mblk service install` | Auto-start on boot |
| `mblk shutdown` | Stop everything |

<details>
<summary><b>Server & Advanced Commands</b></summary>

| Command | What it does |
|:---|:---|
| `mblk server start` | Start API & web UI server |
| `mblk server stop` | Stop the server |
| `mblk server status` | Show server PID and URL |
| `mblk server token` | View or regenerate auth token |
| `mblk restart` | Full restart of blocks + server |
| `mblk restore <name>` | Restore an archived block |
| `mblk permissions <block>` | View/edit block permissions |
| `mblk settings [plugin]` | View/edit plugin settings |

</details>

## How It Works

```
~/.memoryblock/ws/
├── config.json           # global settings
├── auth.json             # provider credentials
├── founder.md            # your profile (shared across blocks)
└── blocks/
    ├── home/
    │   ├── config.json   # block settings, adapter, permissions
    │   ├── monitor.md    # monitor identity and personality
    │   ├── memory.md     # persistent context across sessions
    │   ├── session.json  # crash-recovery session state
    │   ├── crons.json    # scheduled background tasks
    │   ├── agents/       # ephemeral sub-agent workspaces
    │   │   ├── research/
    │   │   │   ├── config.json  # sandboxed config
    │   │   │   ├── memory.md    # agent memory
    │   │   │   ├── inbox.md     # async messages from monitor
    │   │   │   └── logs/
    │   │   └── writer/
    │   │       └── ...
    │   └── logs/         # full conversation history
    └── ops-monitor/
        └── ...
```

Each block is fully self-contained. Back up a monitor by copying its folder. Move it to another server by pasting it. No databases, no migrations.

## Architecture

Modular TypeScript monorepo with strict dependency boundaries:

| Package | Role |
|:---|:---|
| `memoryblock` | CLI entry point and setup wizards |
| `@memoryblock/core` | Engine — Monitor, Gatekeeper, Memory Manager |
| `@memoryblock/tools` | 30+ built-in tools (files, shell, system, auth, cron) |
| `@memoryblock/api` | REST & WebSocket server |
| `@memoryblock/adapters` | LLM providers (OpenAI, Anthropic, Gemini, Bedrock) |
| `@memoryblock/channels` | CLI, Web, Telegram + MultiChannelManager |
| `@memoryblock/daemon` | Background process lifecycle |
| `@memoryblock/web` | Web dashboard UI |
| `@memoryblock/types` | Shared TypeScript interfaces |
| `@memoryblock/locale` | i18n and formatting |

## How We Compare

<table>
<tr>
<th></th>
<th>Memoryblock</th>
<th>OpenClaw</th>
<th>Goose</th>
<th>Claude Code</th>
</tr>
<tr>
<td><b>Runtime</b></td>
<td>Node.js / Bun</td>
<td>Node / Python</td>
<td>Rust</td>
<td>Node.js</td>
</tr>
<tr>
<td><b>Docker required</b></td>
<td>No</td>
<td>No</td>
<td>No</td>
<td>No</td>
</tr>
<tr>
<td><b>Isolated workspaces</b></td>
<td>✅ Blocks</td>
<td>❌</td>
<td>❌</td>
<td>❌</td>
</tr>
<tr>
<td><b>Multi-channel sync</b></td>
<td>✅ CLI + Web + Telegram</td>
<td>Multi-channel (separate)</td>
<td>CLI + Desktop</td>
<td>CLI only</td>
</tr>
<tr>
<td><b>Background daemon</b></td>
<td>✅ + OS service</td>
<td>✅</td>
<td>❌</td>
<td>Cloud only</td>
</tr>
<tr>
<td><b>Cron scheduling</b></td>
<td>✅ Native</td>
<td>✅</td>
<td>❌</td>
<td>Cloud only</td>
</tr>
<tr>
<td><b>Sub-agent orchestration</b></td>
<td>✅ Full lifecycle</td>
<td>Sessions</td>
<td>Swarm</td>
<td>Subagents</td>
</tr>
<tr>
<td><b>Token optimization</b></td>
<td>✅ Lazy + compact</td>
<td>Standard</td>
<td>Standard</td>
<td>Compaction</td>
</tr>
<tr>
<td><b>MCP support</b></td>
<td>🔜 Planned</td>
<td>❌</td>
<td>✅ Native</td>
<td>✅</td>
</tr>
<tr>
<td><b>Browser control</b></td>
<td>🔜 Planned</td>
<td>✅</td>
<td>❌</td>
<td>✅</td>
</tr>
</table>

## What's Coming

We ship 2-3 features per release. Here's what's next:

- Add Adapters : Ollama adapter (local models), OpenRouter, DeepSeek, and Groq
- Add Tools : Vision/Image tools, Process management
- Add Plugins : Broswer plugin
- Add Channels : Discord, Slack, and WhatsApp
- MCP protocol support

## Contributing & Support

We welcome PRs! See [CONTRIBUTING.md](.github/CONTRIBUTING.md).

If memoryblock is useful to you, consider [sponsoring the project](https://github.com/sponsors/mgks) or giving it a ⭐.

## License

Distributed under the MIT License. See `LICENSE` for more information.

![Website Badge](https://img.shields.io/badge/.*%20mgks.dev-blue?style=flat&link=https%3A%2F%2Fmgks.dev) ![Sponsor Badge](https://img.shields.io/badge/%20%20Become%20a%20Sponsor%20%20-red?style=flat&logo=github&link=https%3A%2F%2Fgithub.com%2Fsponsors%2Fmgks)
