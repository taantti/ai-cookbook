<!-- Hand-maintained notes for the 2026-07-26 authoritative run.
     eval-report.js inlines this file into the generated report, so
     regeneration never loses it. Authored by Claude (Fable 5); reviewed by taantti. -->

## Notes on the authoritative run (2026-07-26)

### Run parameters vs. spec

The spec's N figures (A ≥ 60, B ≥ 30) are minimum *gradeable* counts
(PASS+FAIL after ERROR exclusion), enforced by `eval-report.js`
(`MIN_GRADEABLE`). This run scheduled 15 repeats × 5 cases (75) for variant A
and 8 × 5 (40) for variant B to leave headroom for ERROR exclusions; after
excluding 5 ERRORs per variant it yielded 70 and 35 gradeable runs. The
rule-of-three upper bound is computed from the gradeable count: 3/70 ≈ 4.3%
for A. The observed A rate is 0/70 — an observation, not a claim that the
true rate is 0%.

### Run metadata

The model id and Claude CLI version were **not recorded** in this run's JSONL
log — at the time the logger captured only verdict, cost, attempts, and FAIL
content. Per-run model-id, CLI-version, and ERROR-detail logging was added to
the harness on 2026-08-03; this run predates it. What is known: the agent's
frontmatter pins `model: haiku` (an alias the CLI resolves at run time), and
the 2026-08-03 investigation run below — same harness, same machine — resolved
it to `claude-haiku-4-5-20251001` on CLI 2.1.216 (Claude Code) for every one
of its 115 runs. The exact model build serving the 2026-07-26 run cannot be
recovered and is not claimed.

### Expected reference for the FAIL appendix

Every case's expected `<model>.js` is the template **verbatim**
(`.claude/templates/mockData.template.tmpl` in the target repo; published copy:
`claude-code/templates/mockData.template.tmpl`):

```js
export default [
    { /* Developer: add this model's domain fields here */ },
    { /* Developer: add this model's domain fields here */ }
];
```

The expected `index.js` is the committed file with the two template lines
(import + object entry, `<model>` substituted) inserted above their markers.
Read each FAIL output in the appendix against this reference: every domain
field, value, and record beyond the template is invented content.

### The qualityInspection ERRORs — root cause (established 2026-08-03)

This run shows 10 ERRORs, all on `qualityInspection`, split evenly across both
variants (verdict ERROR: no `<model>.js` produced; by the grader's definition
not a hallucination, excluded from the denominator). The run-day per-attempt
success rate for that case was ~16% for A (10 graded outcomes across 63
attempts) and ~10% for B (3 across 31), while every other case needed mostly
1–2 attempts. This log predates ERROR-detail logging, so the cause was
investigated on 2026-08-03 with a full re-run (115 runs, $2.71 notional, CLI
2.1.216, `claude-haiku-4-5-20251001`; published as
`eval-hallucination-1785780326106.log`), which reproduced the phenomenon
(A qualityInspection 9/15 ERROR, B 7/8 — and, newly, B coldStorageZone 8/8)
and captured per-run error detail plus full session transcripts.

The proven chain, each link evidenced:

1. **The model occasionally emits POSIX-rooted paths.** Transcripts show
   `Read {"file_path": "/tests/setup/mockData/qualityInspection.js"}` — a
   leading `/` where the agent's instructions give repo-relative paths. On
   Windows, `/tests/...` resolves to the drive root: `C:\tests\...`.
2. **A rooted-path Write had left a real stale file there.**
   `C:\tests\setup\mockData\qualityInspection.js` existed with invented
   domain fields (`product: 'sku-001'`, `qualityScore: 9.5`, …), created
   2026-07-25 12:33 — the day before this run, during pre-eval smoke runs.
   The eval's `--allowedTools "Read,Write,Edit"` was unscoped, so the write
   landed outside the repo unnoticed, and the harness reset only tracked
   repo-relative paths.
3. **The agent then behaved correctly on what it saw.** A rooted-path Read
   really returned that file's content; the agent's idempotency rule ("if
   found, stop and report") fired, and rooted-path template reads
   (`/.claude/templates/...` → `C:\.claude\...`) failed as "not found" —
   matching every captured ERROR report. The reports were faithful; the
   filesystem state was misplaced.
4. **Self-contamination reproduced live.** During the 2026-08-03 run, an
   A-variant attempt wrote the template to `C:\tests\setup\mockData\coldStorageZone.js`
   (21:14 local, mid-run); B's coldStorageZone block, executed afterwards,
   failed 8/8 with "file already exists" — the poisoning observed end-to-end.

The rooted-path tendency is intermittent and temporally bursty (a same-day
5-run diagnostic of the identical case used relative paths every time and
passed 5/5); the cause of the burstiness is not established. The deterministic
part — stale drive-root file → false STOP — is.

**Classification:** a component defect (the `haiku`-class model's path
formatting) amplified by two measurement-infrastructure gaps (unscoped Write
permission; cleanup blind to drive-root twins). Two earlier hypotheses were
tested and rejected on the way: a transient service-side condition (refuted by
reproduction 8 days later) and agent-fabricated tool results (refuted by
transcripts — the Reads really returned that content).

**Metric validity is unaffected:** PASS/FAIL is graded only on the
repo-relative file, and ERRORs never enter the hallucination denominator. The
2026-08-03 run also directionally replicates this run's result — A 0 FAILs in
66 gradeable (≤ 4.5%), B 5/25 = 20% observed vs. 22.9% here — but its B side
is underpowered (25 gradeable < 30 minimum), so it is published as an
investigation run, not as an authoritative result.

**Remediation applied 2026-08-03 (harness only):** stale drive-root files
deleted; Write/Edit path-scoped in the eval invocation so rooted-path writes
surface in `permission_denials`; a ghost-twin guard added around each run;
CLI-version, model-id, and ERROR-detail logging added.

**Implication left open (agent-level):** the agent files themselves still
occasionally emit rooted paths. A prompt-level fix (e.g. an explicit "use the
listed paths exactly as written; never prefix them with `/`") is a candidate
change — but per this project's method it would need its own eval before any
claim is made about it. The `## Rules` no-invent block under test here is
unrelated to this failure mode and neither causes nor prevents it (both
variants were hit equally).
