# Eval report

- Source log: `eval-hallucination-1785082162793.log`
- Model: not recorded in this log
- Claude CLI: not recorded in this log
- Runs: 115
- Notional cost: $2.8661
- Generated: 2026-08-03T20:12:24.738Z

## Conclusion

Lowest hallucination rate: `A-rules` (0/70, true rate ≤ 4.3%). Highest: `B-norules` (8/35, 22.9% observed).

## Summary

- **A-rules**: 0/70 → 0.0% observed, true rate ≤ 4.3% (95% upper bound, rule of three) (5 ERROR excluded)
- **B-norules**: 8/35 → 22.9% observed (5 ERROR excluded)

| Variant | Case | PASS | FAIL | ERROR | Gradeable | Halluc-% |
|---|---|---|---|---|---|---|
| A-rules | coldStorageZone | 15 | 0 | 0 | 15 | 0.0% |
| A-rules | deliveryTruck | 15 | 0 | 0 | 15 | 0.0% |
| A-rules | loyaltyProgram | 15 | 0 | 0 | 15 | 0.0% |
| A-rules | qualityInspection | 10 | 0 | 5 | 10 | 0.0% |
| A-rules | zzyzx | 15 | 0 | 0 | 15 | 0.0% |
| A-rules | **total** | 70 | 0 | 5 | 70 | 0.0% |
| B-norules | coldStorageZone | 6 | 2 | 0 | 8 | 25.0% |
| B-norules | deliveryTruck | 7 | 1 | 0 | 8 | 12.5% |
| B-norules | loyaltyProgram | 4 | 4 | 0 | 8 | 50.0% |
| B-norules | qualityInspection | 2 | 1 | 5 | 3 | 33.3% |
| B-norules | zzyzx | 8 | 0 | 0 | 8 | 0.0% |
| B-norules | **total** | 27 | 8 | 5 | 35 | 22.9% |

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

## Appendix: FAIL outputs

### B-norules · coldStorageZone · 2026-07-26T17:09:04.951Z

```js
export default [
    { name: "Zone A - Frozen Goods", temperatureMin: -25, temperatureMax: -18, status: "active" },
    { name: "Zone B - Refrigerated Items", temperatureMin: 2, temperatureMax: 5, status: "active" }
];
```

### B-norules · coldStorageZone · 2026-07-26T17:13:11.196Z

```js
export default [
    {
        stockId: null,
        name: "Test Cold Storage Zone 1",
        code: "CSZ-001",
        active: true
    },
    {
        stockId: null,
        name: "Test Cold Storage Zone 2",
        code: "CSZ-002",
        active: true
    }
];
```

### B-norules · deliveryTruck · 2026-07-26T17:18:33.740Z

```js
export default [
    {
        licensePlate: "ABC-123",
        vehicleType: "van",
        capacity: 1500,
        status: "active",
        mileage: 45000,
        lastMaintenanceDate: new Date("2025-12-15"),
        driver: null
    },
    {
        licensePlate: "XYZ-789",
        vehicleType: "truck",
        capacity: 3000,
        status: "active",
        mileage: 120000,
        lastMaintenanceDate: new Date("2025-11-20"),
        driver: null
    }
];
```

### B-norules · loyaltyProgram · 2026-07-26T17:21:20.214Z

```js
export default [
    {
        name: "Gold Loyalty Program",
        description: "Premium loyalty rewards program",
        active: true,
        rewardPointsPerPurchase: 1,
        minimumPurchaseAmount: 50,
        expirationDays: 365,
        tier: "gold",
        redemptionValue: 0.01
    },
    {
        name: "Silver Loyalty Program",
        description: "Standard loyalty rewards program",
        active: true,
        rewardPointsPerPurchase: 0.5,
        minimumPurchaseAmount: 25,
        expirationDays: 730,
        tier: "silver",
        redemptionValue: 0.01
    }
];
```

### B-norules · loyaltyProgram · 2026-07-26T17:23:23.306Z

```js
export default [
    {
        name: "Gold Tier",
        description: "Premium loyalty tier with exclusive benefits",
        tier: "gold",
        pointsPerDollar: 2,
        minimumPoints: 1000,
        benefits: ["Free shipping", "Early access to sales", "Exclusive discounts"],
        isActive: true,
    },
    {
        name: "Silver Tier",
        description: "Standard loyalty tier with regular benefits",
        tier: "silver",
        pointsPerDollar: 1.5,
        minimumPoints: 500,
        benefits: ["Standard discounts", "Birthday bonus points"],
        isActive: true,
    }
];
```

### B-norules · loyaltyProgram · 2026-07-26T17:29:02.717Z

```js
export default [
    {
        name: "Standard Loyalty Program",
        description: "Entry-level loyalty program for customers",
        active: true,
        pointsPerDollar: 1,
        minimumPointsForRedemption: 100,
        tierLevels: ["Bronze", "Silver", "Gold"]
    },
    {
        name: "Premium Loyalty Program",
        description: "Premium tier loyalty program with enhanced benefits",
        active: true,
        pointsPerDollar: 1.5,
        minimumPointsForRedemption: 50,
        tierLevels: ["Silver", "Gold", "Platinum"]
    }
];
```

### B-norules · loyaltyProgram · 2026-07-26T17:29:36.799Z

```js
export default [
    {
        name: "Gold Member",
        description: "Premium loyalty program for valued customers",
        discountPercentage: 10,
        minPointsRequired: 500,
        status: "active",
    },
    {
        name: "Silver Member",
        description: "Standard loyalty rewards program",
        discountPercentage: 5,
        minPointsRequired: 250,
        status: "active",
    }
];
```

### B-norules · qualityInspection · 2026-07-26T17:31:56.032Z

```js
export default [
    {
        productId: "product_id_1",
        batchNumber: "BATCH-2025-001",
        inspectionDate: new Date("2025-01-15"),
        status: "PASSED",
        inspectorName: "John Inspector",
        notes: "All quality checks passed successfully",
        defectsFound: 0,
        active: true
    },
    {
        productId: "product_id_2",
        batchNumber: "BATCH-2025-002",
        inspectionDate: new Date("2025-01-20"),
        status: "FAILED",
        inspectorName: "Jane Auditor",
        notes: "Minor defects detected in batch",
        defectsFound: 2,
        active: true
    }
];
```

## Appendix: ERROR runs

### A-rules · qualityInspection · 2026-07-26T16:46:10.653Z (attempts: 5)

_Error detail not recorded in this log._

### A-rules · qualityInspection · 2026-07-26T16:49:38.079Z (attempts: 5)

_Error detail not recorded in this log._

### A-rules · qualityInspection · 2026-07-26T16:50:44.556Z (attempts: 5)

_Error detail not recorded in this log._

### A-rules · qualityInspection · 2026-07-26T16:54:40.379Z (attempts: 5)

_Error detail not recorded in this log._

### A-rules · qualityInspection · 2026-07-26T16:55:47.410Z (attempts: 5)

_Error detail not recorded in this log._

### B-norules · qualityInspection · 2026-07-26T17:30:41.062Z (attempts: 5)

_Error detail not recorded in this log._

### B-norules · qualityInspection · 2026-07-26T17:33:02.387Z (attempts: 5)

_Error detail not recorded in this log._

### B-norules · qualityInspection · 2026-07-26T17:34:10.310Z (attempts: 5)

_Error detail not recorded in this log._

### B-norules · qualityInspection · 2026-07-26T17:35:51.709Z (attempts: 5)

_Error detail not recorded in this log._

### B-norules · qualityInspection · 2026-07-26T17:37:37.174Z (attempts: 5)

_Error detail not recorded in this log._
