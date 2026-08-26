# Eval spec: rooted-path rate of `api-create-mock-data`

<!-- Drafted by Claude (Fable 5); reviewed and refined by taantti. -->

## Claim under test

> The single path-rule line under `## Steps` in the agent file cuts the
> agent's use of rooted paths to a rate this eval cannot tell apart from
> zero.

Background: while investigating the hallucination eval's ERROR runs, we
found that the model sometimes writes POSIX-rooted paths (`/tests/...`)
instead of the relative paths its instructions give. On Windows these
resolve to the drive root, where an accidental file write breaks later
runs.

The eval can at most conclude: **"B (no path rule): observed X% rooted
runs. A (with path rule): 0 observed in N gradeable runs → true rate below
3/N with 95% confidence (rule of three)."** It never claims the rate *is*
0%.

A *rooted run* is a run where at least one tool call uses a `file_path`
that is not relative — it begins with `/`, `\`, or a drive letter (`X:`).
We measure this from the CLI's event stream, not from the run's outcome.
Outcomes miss rooted paths in two ways. First, permissions block rooted
writes, and the agent may then retry with a relative path and succeed.
Second, rooted reads are allowed, so they leave no trace in the outcome at
all.

## Component under test

The agent file `.claude/agents/api-create-mock-data/api-create-mock-data.md`,
run as-is via `claude --agent api-create-mock-data -p` — frontmatter and
prompt are tested together, exactly as shipped. Out of scope: malformed
input, use inside a toolchain, and other agents that carry a similar path
rule. The result applies only to this agent file, run alone on correct
input.

## A/B setup

- **A** = the real, untouched agent file (`api-create-mock-data`),
  path-rule line present.
- **B** = the permanent baseline variant kept beside A at
  `.claude/agents/api-create-mock-data/api-create-mock-data.old-rules.md`
  (`name: api-create-mock-data-old-rules`): identical to A except the
  path-rule line is removed.

Drift guard at startup: the eval checks that A and B are identical apart
from the frontmatter (which must differ) and the path-rule line. If they
are not, the eval refuses to run.

## Cases

The same five model names as the hallucination eval, each passed as a full
variants JSON (single line, the `-p` prompt), e.g.:

```json
{"Model":"ColdStorageZone","model":"coldStorageZone","Models":"ColdStorageZones","models":"coldStorageZones","model-kebab":"cold-storage-zone"}
```

`coldStorageZone`, `deliveryTruck`, `loyaltyProgram`, `qualityInspection`,
`zzyzx`. In earlier runs, most rooted paths came from `qualityInspection`
and `coldStorageZone`, so the report must show results per case.

## One run

Preflight, once per eval: stop unless `git status --porcelain` is clean
for `tests/setup/mockData/`.

1. **Reset:** delete `tests/setup/mockData/<model>.js`;
   `git checkout -- tests/setup/mockData/index.js`; remove any stray copy
   of the target paths at the drive root (`/tests/setup/mockData/...` — a
   "ghost" left behind by an earlier rooted write), both before and after
   the run.
2. **Invoke:**

   ```sh
   claude --agent <api-create-mock-data | api-create-mock-data-old-rules> \
     -p '<case variants JSON>' \
     --permission-mode dontAsk \
     --allowedTools "Read,Write(tests/setup/mockData/**),Edit(tests/setup/mockData/**)" \
     --max-turns 25 \
     --output-format stream-json --verbose
   ```

   `stream-json` makes stdout a JSONL event stream. Tool calls appear as
   `tool_use` content blocks nested inside `type: "assistant"` events
   (`message.content[].input.file_path`); the final `type: "result"` event
   carries cost and status.
3. **Collect:** all `file_path` values, the rooted ones among them,
   `permission_denials`, and cost. Also note whether the scaffold itself
   completed (`<model>.js` present and template-identical) — as a side
   observation only, never as the verdict.

## Grader

Deterministic, graded from the event stream. FAIL wins over ERROR: a
partial stream can prove a FAIL, but never a PASS.

| Verdict | Condition | In the denominator? |
|---|---|---|
| `FAIL` | ≥ 1 rooted `file_path` among the run's tool calls, whether or not the run completed | yes |
| `ERROR` | The stream is unusable (no parseable `result` event) and contains no rooted `file_path` | no — reported alongside, with error detail |
| `PASS` | The run completed and every `file_path` is relative | yes |

Why FAIL wins: rooted paths can themselves cause crashes — a blocked
rooted write can drive the agent into `--max-turns`. Grading such runs
ERROR would throw away the very behavior we are trying to measure. The
reverse does not hold: a crashed run with clean paths is ERROR, not PASS,
because we can only call a run clean if we saw all of it.

Metric: `rooted rate = FAIL / (PASS + FAIL)` per variant.

Implementation note: the runner must capture stdout even when the CLI
exits non-zero. Otherwise crashed runs lose the partial streams this
grader needs.

## N and what it lets us claim

Minimum gradeable counts (PASS+FAIL) are enforced by the report tool: it
does not save a report below them.

| Arm | Scheduled runs | Minimum gradeable | What it buys |
|---|---|---|---|
| A | 15 × 5 = 75 | ≥ 60 | at 0 FAILs, rule of three bounds the true rate at 3/gradeable — at most 3/60 = 5% |
| B | 12 × 5 = 60 | ≥ 30 | confirms the baseline is real; not tightly bounded |

We schedule more runs than the minimums as a buffer for ERROR runs. B runs
well above its minimum because the baseline behavior comes in bursts and
may be rare: if the true rate is about 5%, 60 runs should show about 3
rooted runs, while 40 would show about 2 — and could easily show 0–1.
**Fallback:** if B observes fewer than 2 rooted runs, the report states
"baseline not confirmed at this N" instead of forcing the conclusion
template.

## Report format

Written to `report/mock-data/eval-rooted-paths.md`:

1. Metadata: date, `claude --version`, model id (logged per run), N per
   variant, total cost.
2. Per-variant × per-case table (rooted paths cluster by case — see
   *Cases*), totals, observed rates; for A the rule-of-three upper bound.
3. Conclusion in the form given in *Claim under test*.
4. Appendix: every FAIL's rooted `file_path` values; every ERROR's detail.

## Rejected alternatives

- **Outcome-based grading** (permission denials / ghost-guard hits as the
  metric) — outcomes undercount rooted paths, as explained under the
  *rooted run* definition; the event stream sees every one.
- **Mining past-run session transcripts as the B baseline** — old runs of
  the no-rule agent exist under `~/.claude/projects`, but matching session
  files to runs would depend on file timestamps, which is unreliable. With
  a fresh B arm, every run is clearly tied to its variant. Mining can
  double-check the result, but not replace it.
- **LLM-as-judge grader** — unnecessary: "is this `file_path` relative?"
  is a string test.
