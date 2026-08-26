# Eval spec: rooted-path rate of `api-create-mock-data`

<!-- Drafted by Claude (Fable 5); reviewed and refined by taantti. -->

## Claim under test

> The single path-rule line under `## Steps` in the agent file reduces the
> rate of rooted-path emissions to a level indistinguishable from zero.

Background: investigation of the hallucination eval's ERROR runs showed the
model intermittently emits POSIX-rooted paths (`/tests/...`) instead of the
relative paths its instructions give; on Windows these resolve to the drive
root (`C:\tests\...`), where a stray write poisons later runs.

The eval can at most conclude: **"B (no path rule): observed X% rooted runs.
A (with path rule): 0 observed in N gradeable runs → true rate below 3/N with
95% confidence (rule of three)."** It never claims the rate *is* 0%.

Definition of a *rooted run*: at least one tool call in the run whose
`file_path` input is not a relative path — it begins with `/`, `\`, or a
drive letter (`X:`). Measured from the CLI's event stream,
**not** from the run's outcome — permissions deny rooted writes and the agent
may recover with a relative retry, so outcomes undercount emissions, and
rooted *reads* are permitted and leave no trace in the outcome at all.

## Component under test

The agent file `.claude/agents/api-create-mock-data/api-create-mock-data.md`,
**run as-is** via `claude --agent api-create-mock-data -p` (frontmatter and
prompt exercised together, no reconstruction). Behavior under malformed
input, composed (toolchain) use, and other agents carrying a similar path
rule are out of scope: the result is a claim about this agent file, on
correct input, run alone.

## A/B setup

- **A** = the real, untouched agent file (`api-create-mock-data`), path-rule
  line present.
- **B** = the permanent baseline variant kept beside A at
  `.claude/agents/api-create-mock-data/api-create-mock-data.old-rules.md`
  (`name: api-create-mock-data-old-rules`): identical to A except the
  path-rule line is removed (sync rules: the folder README). Drift guard at
  startup: drop the `---` frontmatter from both files (it legitimately
  differs), strip the path-rule line from A, normalize line endings and
  trailing whitespace, and assert the remainders are identical; refuse to
  run on drift.

## Cases

The same five model names as the hallucination eval, each passed as a full
variants JSON (single line, the `-p` prompt), e.g.:

```json
{"Model":"ColdStorageZone","model":"coldStorageZone","Models":"ColdStorageZones","models":"coldStorageZones","model-kebab":"cold-storage-zone"}
```

`coldStorageZone`, `deliveryTruck`, `loyaltyProgram`, `qualityInspection`,
`zzyzx`. Prior observation: rooted-path behavior concentrated on
`qualityInspection` and `coldStorageZone`, so per-case reporting matters.

## One run

Preflight (once): abort unless `git status --porcelain` is clean for
`tests/setup/mockData/`.

1. **Reset:** delete `tests/setup/mockData/<model>.js`;
   `git checkout -- tests/setup/mockData/index.js`; remove any drive-root
   ghost twin (`/tests/setup/mockData/...`) before and after the run.
2. **Invoke:**

   ```sh
   claude --agent <api-create-mock-data | api-create-mock-data-old-rules> \
     -p '<case variants JSON>' \
     --permission-mode dontAsk \
     --allowedTools "Read,Write(tests/setup/mockData/**),Edit(tests/setup/mockData/**)" \
     --max-turns 25 \
     --output-format stream-json --verbose
   ```

   `stream-json` makes stdout a JSONL event stream. Tool calls are nested as
   `tool_use` content blocks inside `type: "assistant"` events
   (`message.content[].input.file_path`) — they are **not** top-level
   events; the final `type: "result"` event carries cost and status.
3. **Collect:** all `file_path` values, the rooted subset,
   `permission_denials`, cost — and, as a side observation only, whether the
   scaffold completed (`<model>.js` present and template-identical).

## Grader

Deterministic, from the event stream. Verdict precedence: **FAIL wins over
ERROR** — a partial stream can prove a FAIL, but never a PASS:

- `FAIL` — ≥ 1 rooted `file_path` among the run's tool calls, whether or not
  the run completed; the offending values are captured for the report
  appendix. (Rooted emissions plausibly *cause* crashes — a denied rooted
  write can run the agent into `--max-turns` — so grading such runs ERROR
  would discard exactly the phenomenon under measurement.)
- `ERROR` — the stream is unusable (no parseable `result` event) **and**
  contains no rooted `file_path`. Excluded from the denominator, reported
  alongside with error detail. A crashed run with clean paths is ERROR, not
  PASS: cleanliness requires observing the whole run.
- `PASS` — the run completed and every `file_path` is relative.

Metric: `rooted rate = FAIL / (PASS + FAIL)` per variant.

Implementation note: the shared `runAgent` helper discards stdout when the
CLI exits non-zero; the stream-capturing variant used here must also read
the error object's stdout (`error.stdout` on `execSync` failures), or
crashed runs lose exactly the partial streams this grader needs.

## N and the claim it buys

Minimum gradeable counts (PASS+FAIL after ERROR exclusion, enforced by the
report tool via a `target` log note): **A ≥ 60, B ≥ 30**. Scheduled repeats
run above the minimums as ERROR headroom: **15 × 5 = 75 (A)** and
**12 × 5 = 60 (B)**. B runs well above its minimum because the baseline is
bursty and possibly small: at a true ~5% rate, 60 runs expect ~3
observations where 40 would expect ~2 and could plausibly show 0–1. At 0
observed FAILs for A, rule of three bounds the true rate at 3/gradeable —
at most 3/60 = 5%. B confirms the baseline is real; it is not tightly
bounded. **Fallback:** if B observes fewer than 2 rooted runs, the report
states "baseline not confirmed at this N" instead of forcing the conclusion
template. Total cost is summed from the result events and printed in the
report.

## Report format

Written to `report/mock-data/eval-rooted-paths.md`:

1. Metadata: date, `claude --version` (a `meta` log note), model id (from the
   result events, logged per run), N per variant, total cost.
2. Per-variant × per-case table (rooted behavior clusters by case), totals,
   observed rates; for A the rule-of-three upper bound.
3. Conclusion in the form given in *Claim under test*.
4. Appendix: every FAIL's rooted `file_path` values; every ERROR's detail.
5. Optional hand-maintained notes file (`eval-rooted-paths.notes.md`),
   inlined by the report tool so regeneration preserves commentary.

The runner's `meta` log note declares the metric labels (`metric`,
`metricCol`) so the shared report tool renders this eval's column header and
conclusion wording instead of its default hallucination labels.

## Rejected alternatives

- **Outcome-based grading** (permission denials / ghost-guard hits as the
  metric) — undercounts: rooted reads are permitted, and a denied rooted
  write may be retried relatively and succeed. The event stream sees every
  emission.
- **Mining past-run session transcripts as the B baseline** — prior runs of
  the old agent exist under `~/.claude/projects`, but pairing session files
  to runs rests on mtime correlation; a fresh B arm is directly
  attributable. Mining may cross-check the result, not replace it.
- **LLM-as-judge grader** — unnecessary: "does any `file_path` start with
  `/`" is a string test.
