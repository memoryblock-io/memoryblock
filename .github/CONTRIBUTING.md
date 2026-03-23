# Contributing to memoryblock

First off, thank you for considering contributing to `memoryblock`! It's people like you that make the open-source community such an amazing place to learn, inspire, and create.

We welcome contributions of all kinds: bug fixes, new features, documentation improvements, or even just typo fixes.

## ⚡ Quick Links

*   [**Website / Docs**](https://memoryblock.io) - Read the site to understand how memoryblock works.
*   [**GitHub Issues**](https://github.com/memoryblock-io/memoryblock/issues) - Browse existing bugs or feature requests.
*   [**Sponsors**](https://github.com/sponsors/mgks) - Consider supporting the project.

## 🛠️ Development Setup

The `memoryblock` workspace is organized as a **monorepo** and utilizes **Bun** for running directly from source and **pnpm** for package management.

### Prerequisites
*   **Node.js**: Version 18.x or higher.
*   **pnpm**: Version 10.x or higher.
*   **Bun**: Version 1.0.0 or higher (needed for script execution).

### 1. Fork and Clone
1.  Fork the repository to your GitHub account.
2.  Then clone your fork locally:
    ```bash
    git clone https://github.com/YOUR_USERNAME/memoryblock.git
    cd memoryblock
    ```

### 2. Initialize and Prep Environment
We provide a setup script that cleans previous builds, installs dependencies, lints, and verifies the build integrity for you:

```bash
pnpm dev:prep
```

### 3. Using the Local CLI (`mblk`)
During development, you don't need to link the package. You can execute the local dev build directly using the monorepo-bound script:

```bash
# General CLI Command structure
pnpm mblk <command>

# Examples:
pnpm mblk start
pnpm mblk create
pnpm mblk create agent
```

This runs the script using **Bun** referencing your local edits in real time!

## 📂 Project Structure

`memoryblock` is structured for modularity to keep resources separated and lightweight:

```text
packages/
  ├── core/             # Core Engine, Memory, and CLI (`mblk`)
  ├── daemon/           # Background daemon process hosting
  ├── adapters/         # LLM models (OpenAI, Gemini, Anthropic)
  ├── channels/         # Communication channels (Telegram, Web)
  ├── plugins/          # Built-in plugins (e.g., AWS, agents)
  ├── tools/            # Tool registry and sandbox executions
  └── web/              # User Interface / Dashboard
scripts/                # Clean setup, verification and maintaince logic
```

## 🚀 Submitting a Pull Request

1.  **Create a Branch:** Always create a new branch for your changes.
    *   `feat/my-new-feature`
    *   `fix/bug-description`
2.  **Make Changes:** Write clear, concise code.
3.  **Validate locally:** 
    *   Run `pnpm dev:verify` to run failsafe checks.
    *   Run `pnpm dev:lint` to ensure consistency.
4.  **Commit:** We prefer [Conventional Commits](https://www.conventionalcommits.org/).
    *   `feat: add webhooks dashboard`
    *   `fix: resolve api token sync error`
5.  **Push & Open PR:** Push your branch and open a Pull Request against the `main` branch.

## 🎨 Style Guidelines

*   **Linting:** Please ensure your code follows the workspace standard. Run `pnpm dev:lint:fix` to fix any issues.
*   **Compatibility:** MemoryBlock aims to be highly resource-efficient. Avoid adding bulky dependencies.

## 🤝 Community

Please note that this project is released with a Contributor Code of Conduct. By participating you agree to abide by its terms.