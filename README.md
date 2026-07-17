# ai-cookbook

A personal cookbook of reusable AI tooling, organized **one folder per AI tool**.
Each top-level folder targets a specific AI coding assistant and holds drop-in
configuration, agents, and workflows for it.

## Contents

| Folder | Tool | What's inside |
|---|---|---|
| [`claude-code/`](claude-code/) | [Claude Code](https://claude.com/claude-code) (Anthropic) | A backend-module scaffolding toolkit — single-job subagents, a skill, file templates, and a Workflow that together build a full module for a modular Node.js/Express + Mongoose ERP backend. |

## Using `claude-code/`

Claude Code discovers project tooling from a **`.claude/`** directory at the
project root. This repo keeps the folder **visible** as `claude-code/` so it is
easy to browse on GitHub. To use it in a project, copy it in and **rename it to
`.claude`**:

```sh
cp -r claude-code /path/to/your-project/.claude
```

### What's inside `claude-code/`

- **`agents/`** — single-responsibility subagents that each scaffold one layer of
  a backend module (model → service → controller → route → app mount →
  permissions → tests), plus read-only *verify* agents (ESLint / integration
  tests / a live smoke test). See
  [`claude-code/agents/README.md`](claude-code/agents/README.md) for the full
  catalog and design philosophy.
- **`skills/`** — a `run-erp-demo` skill that boots the real backend against a
  throwaway in-memory MongoDB and drives login + CRUD over HTTP.
- **`templates/`** — the checked-in file templates the scaffold agents fill in
  (placeholder substitution only — no invented domain content).
- **`workflows/`** — `scaffold-module.js`, a Workflow that composes the agents
  end-to-end: derive naming variants → scaffold every layer in parallel →
  verify by running.

> These agents encode one specific ERP backend's conventions. Treat them as a
> worked example of composable, single-purpose Claude Code tooling rather than a
> general-purpose scaffolder.
