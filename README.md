<div align="center">
  <h1>⬡ memoryblock</h1>
  <p><strong>Run AI agents that remember, think, and work — without burning through your budget.</strong></p>
  <br>
  <a href="#-quick-start">Quick Start</a> · <a href="#-what-makes-this-different">Why Memoryblock</a> · <a href="#-adapters">Adapters</a> · <a href="#-channels">Channels</a> · <a href="#-documentation">Docs</a>
</div>

<br>

## What is Memoryblock?

Memoryblock lets you deploy AI agents as isolated **blocks** — independent workspaces, each with their own memory, tools, and personality. Think of a block as a private office for an AI. Give it a job, point it at a channel, and let it run.

One block can be your personal assistant. Another can monitor your infrastructure. A third can research topics and write summaries. They don't interfere with each other, they don't share memory, and they don't waste tokens re-learning what they already know.

Need them to collaborate? A block can spawn sub-agents — temporary workers in sandboxed environments — to handle specific tasks and report back. No shared state pollution, no context confusion.

```
you ─── terminal ──── block "home"       (your daily assistant)
    ├── channel ───── block "devops"     (monitors + alerts)
    └── web ui ────── block "research"   (deep dives + summaries)
```

## ✨ What Makes This Different

### It's cheap to run. Seriously.

Most AI tools send the entire tool schema — thousands of tokens — on *every single message*. For a background agent running all day, that's money on fire.

Memoryblock was engineered around this problem:

- **On-demand schema loading** — tool definitions are injected only when needed, then dropped. Payload sizes go from ~2,600 tokens to ~1,200 tokens per turn.
- **History trimming** — large tool outputs (log dumps, file contents) are read once, then truncated in memory to 500 characters. The LLM already saw it. No need to pay for it again.
- **Smart context recovery** — when context fills up, the engine summarizes everything into clean, actionable notes and starts fresh. No crash, no data loss, no compact context error loops.

> In testing, these optimizations reduce token growth between turns from 4.2× to under 2×, resulting in over 50% cost reduction on sustained sessions.

### It runs on Bun. Nothing else.

No Node.js. No Electron. No heavy frameworks. The entire core — HTTP server, WebSocket streaming, static file serving — is built on native APIs. Cold starts are fast. Memory usage is small.

### Every block is its own world.

Each block gets its own `config.json`, `memory.md`, `monitor.md`, `costs.json`, and log directory. Move a block between machines by copying its folder. Back it up by zipping it. There's no shared database, no centralized state, no magic.

### Talk to it from anywhere.

Your blocks are accessible through the **CLI** (a simple interactive terminal), different **Channels** (including Telegram, Discord, Slack, and more), and a **Web Dashboard** (with live WebSocket updates). Same block, same memory - different surfaces.

### Use any model you want.

Memoryblock doesn't lock you into one provider. Swap models per-block, per-task, or per-agent:

| Adapter | Auth |
|:---|:---|
| **AWS Bedrock** | AWS credentials |
| **OpenAI** | API key |
| **Google Gemini** | API key |
| **Anthropic** | API key |

Adding a new adapter is one file. See [`_documentation/adapters/`](_documentation/adapters/) for examples.

## 🚀 Quick Start

**Requirements:** [Bun](https://bun.sh) ≥ 1.0 and an API key from any supported provider.

```bash
# clone and set up
git clone https://github.com/memoryblock-io/memoryblock.git
cd memoryblock
pnpm dev:onboard -gl

# run the setup wizard
mblk init

# start your first block
mblk start home
```

That's it. The wizard handles credentials, verification, and creating your first block.

### Web Dashboard

```bash
mblk web
```

Opens a live dashboard at `localhost:8420` with real-time block monitoring, cost tracking, and memory inspection.

### Channels

```bash
mblk start home --channel telegram
```

Your block is now live on the channel you chose. Same memory, same tools — accessible from anywhere.

## 📖 Commands

Everything you can do from the terminal, you can do from chat (and soon, the web UI too):

| CLI | In-Chat | What it does |
|:---|:---|:---|
| `mblk create <name>` | `/create-block <name>` | Create a new block |
| `mblk start <block>` | — | Start a block's monitor |
| `mblk stop <block>` | — | Stop a running monitor |
| `mblk status` | `/status` | Show all blocks and their state |
| `mblk delete <block>` | — | Archive a block safely |
| `mblk restore <archive>` | — | Restore from archive |
| `mblk reset <block>` | — | Reset memory and costs |
| `mblk add <plugin>` | — | Install a plugin |

Full reference: [`_documentation/development/commands.md`](_documentation/development/commands.md)

## 🔌 Plugins

Blocks come with a core set of tools. Need more? Add them:

```bash
mblk add web-search    # search the web
mblk add fetch-webpage # extract text from any URL
mblk add agents        # multi-agent orchestration
```

Plugins are just npm packages. The installer resolves, downloads, and wires them in automatically.

| Plugin | What it does |
|:---|:---|
| `web-search` | Search the web with your configured provider |
| `fetch-webpage` | Extract clean text from URLs |
| `agents` | Spawn sub-agents for delegated tasks |
| `aws` | Cloud SDK code generation tools |

## 🔗 Adapters

Each adapter is a single file that maps Memoryblock's internal message format to a provider's API. They handle authentication, request formatting, and response parsing. Writing a new adapter is straightforward — the interface is small and well-documented.

See all supported adapters and how to write your own: [`_documentation/adapters/`](_documentation/adapters/)

## 📡 Channels

Channels are how your blocks talk to the outside world. The CLI, messaging platforms, and the web dashboard are all channels — equal citizens, not afterthoughts. Adding a new channel is a single file implementation.

Supported and upcoming channels are documented in [`_documentation/`](_documentation/).

## 📚 Documentation

All documentation lives in `_documentation/`:

| Area | What's there |
|:---|:---|
| **Getting Started** | `getting-started.md`, `architecture.md`, `configuration.md` |
| **Adapters** | Per-provider setup guides with code examples |
| **Plugins** | How each plugin works and how to configure it |
| **Cost Efficiency** | Token optimization strategies and real-world benchmarks |
| **Development** | Contributing guide, CLI/command reference, build scripts |

## 🏗️ Architecture

```
packages/
├── core/          # engine, CLI, schemas, monitor loop
├── adapters/      # LLM provider adapters
├── channels/      # messaging channel transports
├── api/           # HTTP + WebSocket server
├── web/           # static web dashboard
├── tools/         # base tool registry and schema helpers
├── daemon/        # background process management
└── plugins/       # extensible capability modules
```

It's a pnpm monorepo. Every package builds independently with `tsc`. No bundlers, no magic.

## 🤝 Contributing

Memoryblock is structured as a pnpm workspace monorepo. To get started:

```bash
git clone https://github.com/memoryblock-io/memoryblock.git
cd memoryblock
pnpm install
pnpm dev:build
```

Read [`_documentation/development/contributing.md`](_documentation/development/contributing.md) for coding standards, how to write adapters, channels, and plugins.

## 📜 License

MIT