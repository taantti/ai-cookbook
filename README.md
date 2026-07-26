# ai-cookbook

A personal cookbook of reusable AI tooling and methodology. Two kinds of top-level
folder: **tool-specific** configuration for a particular AI coding assistant, and
**tool-agnostic** engineering methodology for building and evaluating LLM features.

## Contents

| Folder | Kind | What's inside |
|---|---|---|
| [`claude-code/`](claude-code/) | Claude Code (Anthropic) config | A backend-module scaffolding toolkit — single-job subagents, a skill, file templates, and a Workflow that together build a full module for a modular Node.js/Express + Mongoose ERP backend. |
| [`ai-engineering/`](ai-engineering/) | Methodology (tool-agnostic) | Reliability and security engineering for LLM features: a runnable hallucination eval pipeline with an honest reporting layer, plus reference cheat sheets. |

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

## `ai-engineering/`

Tool-agnostic methodology for building and evaluating LLM features — worked
examples from a specific ERP backend, written to be reused as method rather than
as a drop-in library.

### What's inside `ai-engineering/`

- **`reliability/`** — how to measure a probabilistic component's reliability as a
  *rate*, not a pass/fail. Includes a **runnable A/B hallucination eval** for a
  scaffold agent (deterministic harness, JSONL logger, and an aggregating report
  tool with an underpowered-run gate), an example log and generated report, the
  eval spec, and an **eval cheat sheet** (verdicts, the rule of three, point
  estimate vs upper bound, glossary).
- **`ai-security/`** — a **security cheat sheet** for LLM features: prompt injection
  (direct/indirect), defense-in-depth layers, runtime controls, and the OWASP LLM
  Top 10 (2025).
