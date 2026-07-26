# Eval spec: hallucination rate of `api-create-mock-data`

<!-- Authored by Claude; reviewed and refined by taantti. -->

## Claim under test

> The `## Rules` (no-invent) block in `.claude/agents/api-create-mock-data.md`
> reduces the agent's hallucination rate from a measured baseline of roughly
> 1/3 of runs to a level indistinguishable from zero.

The eval can at most conclude:
**"B (no Rules block): observed X% hallucination. A (with Rules block): 0
observed hallucinations in N runs → true rate below 3/N with 95% confidence
(rule of three)."** The eval never claims the rate *is* 0%.

Definition of *hallucination* here: any content in the agent's output that is
not the template content with the listed placeholder substitutions applied —
extra fields, values, records, imports, comments, or logic.

## Component under test

The agent file `.claude/agents/api-create-mock-data.md`, **run as-is** via
`claude --agent api-create-mock-data -p` so the whole artifact is exercised:
frontmatter (`model: haiku`, `tools: Read, Write, Edit`) and prompt. No
prompt reconstruction.

**Out of scope (deliberate):**
- **Input production.** Cases feed a ready-made, well-formed input JSON per
  the agent's own input contract (a JSON with a `model` key). The result is
  therefore a claim about behavior under *correct* input only; behavior on
  malformed or missing input is not measured, and whatever tool or person
  produces the JSON is outside this eval.
- **Composed use.** The result is a claim about this agent file run on its
  own. If the agent is invoked as part of a larger toolchain, failure modes
  of the composition (wrong input handed over, ordering, orchestration) are
  not covered.
- **Other agents with a similar no-invent rule.** The result does not
  generalize to any other agent, even one carrying the same `## Rules` text;
  each needs its own eval with its own reference computation.

**Known deviation:** the original baseline observation came from runs where
this agent was invoked as a subagent (via the Agent tool); here it runs as
the main loop of a headless session (`--agent`). Same model, same prompt,
same tool grants — accepted as equivalent.

## A/B setup

- **A** = the real, untouched agent file (`api-create-mock-data`), Rules block
  present.
- **B** = a permanent no-Rules variant kept beside A at
  `.claude/agents/api-create-mock-data/api-create-mock-data.norules.md`
  (`name: api-create-mock-data-norules`): byte-identical to A except the
  `## Rules` section is removed. The two files are hand-maintained and must
  stay in sync; the harness runs a drift guard at startup that strips the
  `## Rules` section from both and asserts the remainder is identical,
  refusing to run if they have drifted. Both register as discoverable agents
  (recursive scan of `.claude/agents/`); the eval invokes A via
  `--agent api-create-mock-data` and B via `--agent api-create-mock-data-norules`.

## Cases

Five model names, none colliding with existing models/mock files, each given
as a full variants JSON per the agent's input contract (the agent reads only
the `model` key). Chosen to vary temptation level:

| # | model | Why |
|---|-------|-----|
| 1 | `coldStorageZone` | The original observed-failure case; concrete physical domain invites realistic fields (`temperature`, `capacity`) |
| 2 | `deliveryTruck` | Concrete physical object, high temptation |
| 3 | `loyaltyProgram` | Business-abstract, different field flavor (dates, tiers) |
| 4 | `qualityInspection` | Process-like; invites status/enum invention |
| 5 | `zzyzx` | Semantically empty control — if hallucination needs meaning to feed on, this should never fail |

Example input for case 1 (single line, passed as the `-p` prompt):

```json
{"Model":"ColdStorageZone","model":"coldStorageZone","Models":"ColdStorageZones","models":"coldStorageZones","model-kebab":"cold-storage-zone"}
```

## One run (harness loop body)

Preflight (once, before the loop): abort unless `git status --porcelain` is
clean for `tests/setup/mockData/` — the eval must not run on top of
uncommitted work it would destroy.

1. **Reset workspace:** delete `tests/setup/mockData/<model>.js` if present;
   `git checkout -- tests/setup/mockData/index.js`. (The only two files the
   agent writes; resetting re-arms the agent's idempotency guard.)
2. **Invoke:**

   ```sh
   claude --agent <api-create-mock-data | api-create-mock-data-norules> \
     -p '<case variants JSON>' \
     --permission-mode dontAsk \
     --allowedTools "Read,Write,Edit" \
     --max-turns 25 \
     --output-format json
   ```

   `--allowedTools` pre-approves the agent's own tool grants so nothing
   prompts; `dontAsk` auto-denies anything else instead of hanging;
   `--max-turns` is a runaway backstop; JSON output yields per-run cost.
3. **Collect before cleanup:** the produced `tests/setup/mockData/<model>.js`,
   the modified `tests/setup/mockData/index.js`, the CLI JSON (result text,
   cost), and the exit code. Grade immediately, then loop.

Teardown (`finally`): reset workspace once more; delete the B variant agent
file.

## Grader

Deterministic, no LLM involved. Reference outputs are computed by the harness
itself from the same templates the agent reads:

- expected `<model>.js` = `mockData.template.tmpl` **verbatim** (the body
  template contains no placeholder tokens).
- expected `index.js` = the committed `index.js` with the two template lines
  (`mockDataIndexImport` / `mockDataIndexObject`, `<model>` substituted)
  inserted above their respective markers.

**Normalization (not counted as hallucination):** line endings CRLF→LF,
trailing whitespace stripped per line, exactly one trailing newline. Nothing
else.

**Per-run verdict (three-valued):**
- `ERROR` — the run did not produce `<model>.js` at all (CLI error, refusal,
  guard misfire). Counted and reported separately; **not** a hallucination.
- `FAIL` — produced files differ from reference after normalization. The
  unified diff is saved to the report.
- `PASS` — both files match their references after normalization.

Metric: `hallucination rate = FAIL / (PASS + FAIL)` per variant (ERRORs
excluded from the denominator, reported alongside).

## N and the claim it buys

- **A (Rules block): N = 60** (5 cases × 12 repeats). If 0 FAILs are
  observed, rule of three gives a 95% upper bound of 3/60 = **5%** — the
  claim becomes "true rate below 5%".
- **B (no Rules): N = 30** (5 cases × 6 repeats). B exists to confirm the
  baseline is real and large, not to bound it tightly; at a true ~33% rate,
  30 runs yield ~10 expected FAILs — unambiguous.
- Total cost is summed from the CLI JSON and printed in the report.

## Report format

Written to `report/mock-data/eval-hallucination.md` (mirroring the log structure):

1. Metadata: date, `claude --version`, model id from CLI JSON, N per variant,
   total cost.
2. Per-variant × per-case table: runs, PASS, FAIL, ERROR, observed rate
   (failures clustering on one name would be hidden by totals alone).
3. Totals per variant: observed rate; for A additionally the rule-of-three
   95% upper bound.
4. Conclusion in the form given in *Claim under test*.
5. Appendix: every FAIL's diff (and every ERROR's CLI stderr/result text).

## Rejected alternatives

- **Workflow harness (`.claude/workflows/`)** — the workflow sandbox has no
  filesystem API; reset/collect/diff/report would each have to be delegated
  to agents, injecting nondeterminism into exactly the layer that must stay
  deterministic. Rejected; plain Node script owns all file plumbing.
- **Prompt reconstruction (`--append-system-prompt` from the agent file)** —
  measures a reconstruction, not the shipped artifact; frontmatter (model,
  tools) would be re-implemented by hand and could drift. Rejected on eval
  validity; superseded by `--agent`.
- **LLM-as-judge grader** — unnecessary: the spec's template+placeholder
  contract makes the expected output computable, so a diff is a complete
  grader.
