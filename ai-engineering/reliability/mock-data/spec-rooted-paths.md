# Eval spec: rooted-path rate of `api-create-mock-data`

<!-- Drafted by Claude (Fable 5); reviewed and refined by taantti. -->

## Claim under test

The agent file `.claude/agents/api-create-mock-data/api-create-mock-data.md` got a new `## Paths` section. It is one paragraph: use the listed relative paths exactly, and never prefix a path with `/`. The question: does that section stop the agent from using rooted paths in its tool calls?

Background. While the hallucination eval's ERROR runs were investigated, the model was seen writing POSIX-rooted paths such as `/tests/setup/mockData/x.js`. Its instructions give relative paths. On Windows a rooted path resolves to the drive root, `C:\tests\...`. An accidental write there leaves a stale file that breaks later runs.

The eval can at most conclude:
**"B (no Paths section): X rooted runs out of N. A (with Paths section): Y out of N."**
If Y = 0, the conclusion is: "not observed in N gradeable runs → true rate below 3/N with 95% confidence (rule of three)". The eval never claims the rate is 0%. The rate is measured from the agent's tool calls, not from what ended up on disk. The outcome hides the behavior; see *One run*. "Rooted" is defined in *Grader*.

## Component under test

The agent file above, run as-is via `claude --agent api-create-mock-data -p`. Frontmatter and prompt are tested together, exactly as shipped: model choice, tool grants, and instructions. Nothing is rebuilt by hand.

Out of scope, deliberately:
- **Malformed input.** Cases feed a well-formed variants JSON per the agent's input contract. Behavior on bad or missing input is not measured.
- **Use inside a toolchain.** The result covers this agent file run alone, not the scaffold chain that normally calls it. Failures in how it is called or ordered are not covered.
- **Other agents with a similar section.** The result does not transfer to any other agent, even one carrying the same `## Paths` text.

## A/B setup

| Arm | File | `--agent` name | `## Paths` |
|-----|------|----------------|------------|
| A | `.claude/agents/api-create-mock-data/api-create-mock-data.md` | `api-create-mock-data` | present |
| B | `.claude/agents/api-create-mock-data/api-create-mock-data.nopaths.md` | `api-create-mock-data-nopaths` | removed |

B is identical to A except for the removed section. Both register as discoverable agents from `.claude/agents/`. B is a permanent file and is never deleted.

Both files are hand-maintained. How do we know B differs from A only in that section? The harness runs a drift guard at startup, before a single run is spent:
1. Drop the frontmatter from both files. It must differ, because the `name` fields differ.
2. Remove the `## Paths` section from A.
3. Normalize both texts: line endings CRLF→LF, trailing whitespace stripped per line.
4. Compare. If the texts differ, refuse to run with a clear error.

## Cases

The same five model names as the hallucination eval. None collides with an existing model or mock file.

| # | model | Note |
|---|-------|------|
| 1 | `coldStorageZone` | Rooted paths concentrated here in earlier runs |
| 2 | `deliveryTruck` | Concrete physical object |
| 3 | `loyaltyProgram` | Business-abstract |
| 4 | `qualityInspection` | Rooted paths concentrated here in earlier runs |
| 5 | `zzyzx` | Semantically empty control |

Each case is one line of variants JSON, passed as the `-p` prompt. Example for case 1:

```json
{"Model":"ColdStorageZone","model":"coldStorageZone","Models":"ColdStorageZones","models":"coldStorageZones","model-kebab":"cold-storage-zone"}
```

Those two hot cases are why the report breaks results down per case; totals alone would hide a burst.

## One run

The harness loop body. Preflight, once before the loop: abort unless `git status --porcelain` is clean for `tests/setup/mockData/`. The eval must not destroy uncommitted work.

1. **Reset workspace.** Delete `tests/setup/mockData/<model>.js` if present. Run `git checkout -- tests/setup/mockData/index.js`. These are the only two files the agent writes. Then run the ghost guard: remove any stray copy of the target paths at the drive root, such as `C:\tests\setup\mockData\<model>.js`. Such a ghost is left by an earlier rooted write and would make a later run find a file it never wrote. Log a note when one is found. The ghost guard runs before and after every run.
2. **Generate a session id.** Create a fresh UUID. The transcript path is then known before the run: `~/.claude/projects/<project-slug>/<uuid>.jsonl`, where the slug is the name the CLI derives from the working directory.
3. **Invoke:**

   ```sh
   claude --agent <api-create-mock-data | api-create-mock-data-nopaths> \
     -p '<case variants JSON>' \
     --session-id <uuid> \
     --permission-mode dontAsk \
     --allowedTools "Read,Write(tests/setup/mockData/**),Edit(tests/setup/mockData/**)" \
     --max-turns 25 \
     --output-format json
   ```

   `--allowedTools` pre-approves the agent's own tool grants so nothing prompts. Write and Edit are path-scoped to the mock-data directory, so a rooted write is denied and shows up in the result JSON's `permission_denials`. `dontAsk` auto-denies anything else instead of hanging. `--max-turns` is a runaway backstop. The result JSON gives cost, model id, and permission denials.
4. **Collect.** Right after the CLI exits, read the transcript file. Extract every `file_path` value the agent passed to a tool. Read, Write and Edit all take their path in a `file_path` parameter, so one extraction covers every tool the agent has. Write the paths, the result JSON, the exit code, and whether `tests/setup/mockData/<model>.js` matches the template as one line to the harness's own JSONL log. Grade immediately, then loop.

Why the transcript, not the outcome: permissions block rooted writes, and the agent may retry with a relative path and succeed. Rooted reads are allowed and leave no trace in the outcome. The CLI writes the full transcript line by line while the run proceeds, also when the run crashes. The transcript is transient: Claude Code deletes old sessions after `cleanupPeriodDays`, default 30 days. The harness log is permanent and published. The report is built from the log, never from the transcript. Chain: run → transcript (transient) → own log (permanent) → report.

Teardown: each iteration's trailing reset and ghost guard leave the workspace clean. There is no separate teardown step.

## Grader

Deterministic, no LLM involved. Input: the list of `file_path` values from the run's tool calls, plus the exit code and result JSON.

**Rooted path definition.** A path is rooted if it begins with `/`, `\`, or a drive letter followed by `:`, for example `C:\`. Everything else is relative, including `tests/...` and `./tests/...`. Paths starting with `../` are out of scope: never observed, and nothing in the agent's instructions leads there. Why not count only `/`: the Paths section forbids the `/` prefix literally. If the model switched to `C:\tests\...`, the harm would be identical, and a `/`-only counter would show zero.

| Verdict | Condition | In denominator |
|---------|-----------|----------------|
| `FAIL` | At least one rooted `file_path` in the run's tool calls, whether or not the run completed | Yes |
| `PASS` | The run completed normally and every `file_path` was relative | Yes |
| `ERROR` | The run did not complete normally, for example CLI failure or no result JSON, and no rooted path was seen | No; reported separately with error detail |

FAIL wins over ERROR. Rooted paths often cause crashes: a rooted write is blocked, the agent keeps trying, and `--max-turns` ends the run. Grading such runs ERROR would discard exactly the behavior being measured. A crashed run with clean paths is ERROR, not PASS. A run can only be called clean if all of it was seen; an unfinished run may have had a rooted call still ahead of it.

Metric: `rooted rate = FAIL / (PASS + FAIL)` per variant. The template check from *One run* is a side observation: logged, never part of the verdict.

**No retries.** Each scheduled run is exactly one agent invocation and one log line. ERRORs are reported openly; the scheduled headroom covers them. In the previous eval, retries hid the rooted-path problem inside an attempts counter.

## N and what it lets us claim

Minimums are gradeable counts, PASS + FAIL after excluding ERRORs. They are written to the log as a `target` note. `eval-report.js` refuses to save a report whose gradeable count falls below them.

| Arm | Scheduled | Minimum gradeable | What it buys |
|-----|-----------|-------------------|--------------|
| A (Paths section) | 15 repeats × 5 cases = 75 | 60 | At 0 FAILs the rule-of-three 95% upper bound is at most 3/60 = 5%, comparable to the hallucination eval |
| B (no Paths section) | 12 repeats × 5 cases = 60 | 30 | Confirms the baseline is real; not tightly bounded |

Why 60 scheduled for B when 30 is the minimum? The agent uses rooted paths in bursts. On 2026-08-03 the hot cases failed almost every time, while five separate runs the same day were all clean. If the true rate is about 5%, 60 runs expect about 3 rooted runs. 40 runs would expect about 2 and could easily show 0 or 1.

**Fallback.** If B observes fewer than 2 rooted runs, the report states "baseline not confirmed at this N". It then makes no claim about the section's effect. Total: about 135 runs, about $3.5–4, about 1.5–2 hours.

## Report format

**Log, one line per run:** variant, case, verdict, cost, model id, side observation. Evidence: rooted paths on FAIL, one per line; error text on ERROR. Model id is logged per run, so a model change mid-eval shows in the report instead of passing unnoticed.

**Start-of-log notes:** CLI version from `claude --version`; the `target` minimums; metric labels `metric: "rooted rate"` and `metricCol: "Rooted-%"`, so the shared report tool titles the table correctly.

**Report**, generated by the existing `eval-report.js`, written to `report/mock-data/eval-rooted-paths.md`:
1. Metadata: date, CLI version, model id, runs per variant, total cost.
2. Per-variant × per-case table: runs, PASS, FAIL, ERROR, observed rooted rate.
3. Per-variant totals; for A additionally the rule-of-three 95% upper bound.
4. Conclusion in the form given in *Claim under test*, or the fallback sentence from *N and what it lets us claim*.
5. Appendix: every FAIL's rooted paths, every ERROR's error text.

The fallback sentence lives in a hand-maintained notes file next to the report. `eval-report.js` inlines it, so regenerating the report keeps it.

## Rejected alternatives

- **Outcome-based grading.** Undercounts, for the reasons given in *One run*.
- **Parsing a `stream-json` stdout stream.** Needlessly complex: it must recover partial output and parse nested events, when the transcript file gives the same data.
- **Mining old transcripts by file timestamp.** The files are transient, and pairing a transcript with a run is indirect. A fresh B arm ties every rooted path to a known run.
- **LLM-as-judge.** "Is this path relative" is a string test.
- **Retries.** They hid the problem last time. See *Grader*.
