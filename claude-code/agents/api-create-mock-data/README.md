# api-create-mock-data — three variants

This folder holds **three versions of the same agent**. The real agent is the
single source of truth; each eval variant is intentionally identical to it
**except for exactly one thing** — the thing that variant's eval measures.

| File | `name:` | Differs from the real agent by | Used by |
|------|---------|-------------------------------|---------|
| `api-create-mock-data.md` | `api-create-mock-data` | — (the **real** agent) | The scaffold chain |
| `api-create-mock-data.norules.md` | `api-create-mock-data-norules` | The `## Rules` no-invent section is **removed** | Hallucination eval only (A/B baseline). Never use for real scaffolding. |
| `api-create-mock-data.old-rules.md` | `api-create-mock-data-old-rules` | The single path-rule line under `## Steps` is **removed** | Rooted-paths eval only (A/B baseline). Never use for real scaffolding. |

One variant = one experiment = one difference. If a variant ever differs from
the real agent in more than its one designated thing, its A/B comparison
measures two variables at once and the eval result is invalid.

## ⚠️ KEEP THEM IN SYNC — read before editing

**When you edit the real agent (`api-create-mock-data.md`):**

1. Make your change in `api-create-mock-data.md`.
2. Copy the whole file over `api-create-mock-data.norules.md`; in the copy,
   restore its `name:`/`description:` frontmatter, then **delete the entire
   `## Rules` section** (heading + paragraph).
3. Copy the whole file over `api-create-mock-data.old-rules.md`; in the copy,
   restore its `name:`/`description:` frontmatter, then **delete the single
   path-rule line** (the `Use the file paths exactly as listed…` line right
   under `## Steps`).
4. Nothing else. Do not touch `## Steps`, `## Boundaries`, etc.

Yes — a variant is re-derived from the real agent on every edit, including
edits unrelated to its own eval. That is what keeps "differs by exactly one
thing" true over time; a frozen snapshot would silently accumulate a second
difference the moment the real agent changes.

**Enforcement — one drift guard per eval**, run at eval startup; on drift the
eval refuses to run with a clear error, so a silent mismatch can never corrupt
a measurement:

- Hallucination eval (`.claude/ai-engineering/reliability/mock-data/eval-hallucination.js`):
  strips the `## Rules` section from the real agent and asserts the remainder
  is identical to `norules`.
- Rooted-paths eval (`.claude/ai-engineering/reliability/mock-data/eval-rooted-paths.js`):
  strips the path-rule line from the real agent and asserts the remainder is
  identical to `old-rules`.

The path-rule line is kept on **one physical line** on purpose: it makes the
rooted-paths drift guard a trivial single-line removal instead of a fragile
multi-line match.
