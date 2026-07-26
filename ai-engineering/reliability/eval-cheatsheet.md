<!-- Authored by Claude. -->

# Evaluating a probabilistic component — cheat sheet

Reference for measuring the reliability of an AI/LLM component whose output varies
run to run. Matches the hallucination eval in this folder.

## Measurement, not a pass/fail test

An LLM component returns a *distribution* of outputs, not one fixed output. One run
is one sample, not proof. So the question is not "does it work?" (yes/no) but
"how often does it work?" (a rate).

- Unit test: same input → same output. One run proves behaviour.
- Eval: same input → a distribution. Many runs, reported as a rate plus its uncertainty.

## Verdicts

Each run resolves to one of three:

- **PASS** — output matches the expected reference.
- **FAIL** — output differs from the reference (a real defect, e.g. a hallucination).
- **ERROR** — no gradeable output produced (crash, refusal, tool failure, timeout).
  Not a defect of the thing being measured.

Keep ERROR separate. Folding it into FAIL overstates the defect rate; folding it
into PASS understates it.

## The rate

```
gradeable = PASS + FAIL          (ERRORs excluded)
rate      = FAIL / gradeable
```

ERRORs are excluded from the denominator. They are not gradeable, so they shrink N
and weaken the measurement — they do not change the rate.

## Point estimate vs upper bound

What you report depends on whether any FAIL was observed.

| Observed | Report | Meaning |
|---|---|---|
| FAIL > 0 (e.g. 1/100) | observed rate 1% — a **point estimate** | true rate ≈ 1% |
| FAIL = 0 (e.g. 0/100) | **upper bound** 3/N = 3% | true rate ≤ 3% |

- With ≥1 failure there is an event to estimate from → the observed rate is a
  meaningful best guess of the true rate. It is the center of the estimate, not the
  whole answer — it too has a confidence interval, wide when failures are few
  (1/100 spans roughly 0–5%).
- With 0 failures the observed 0% is not a claim; absence of failures does not prove
  a zero rate. Report the highest rate still consistent with seeing zero failures —
  the upper bound.

These are different quantities; do not compare a point estimate against an upper
bound directly. Within each kind, more failures → a larger number.

## Rule of three

For **0 failures in N gradeable runs**, the true failure rate is at most **3/N**
with 95% confidence.

```
0 failures in N gradeable  →  true rate ≤ 3/N   (95%)
```

| N gradeable | Upper bound |
|---|---|
| 60  | ≤ 5%   |
| 100 | ≤ 3%   |
| 300 | ≤ 1%   |

The constant 3 is ln(20) ≈ 3, from requiring the chance of seeing zero failures to
be 5%: `(1 − p)^N = 0.05` → `p ≈ 3/N`. Applies only when 0 failures are observed.
3/N is a large-sample approximation; at very small N it is conservative (reads high) —
the exact 95% bound at N = 5 is ~45%, not 60%. Safe to use, just loose when N is tiny.

## N does not change the true rate

The component's true failure rate is fixed. More samples do not make it fail less;
they make the measurement more precise, so the upper bound you can honestly claim
gets smaller.

```
0/100  → ≤ 3%
0/1000 → ≤ 0.3%
```

Same component, tighter bound. N controls what you can *claim*, not what is *true*.

## Choosing N from the claim

Pick N backwards from the bound you want:

```
N ≥ 3 / (target bound)
```

- want ≤ 5% → N ≥ 60 gradeable
- want ≤ 1% → N ≥ 300 gradeable

These hold only if you then observe 0 failures; any failure changes the report to a
point estimate, not a 3/N bound.

To reach N gradeable despite an ERROR rate `e`, run about `N / (1 − e)` total.
(N = 60, e = 20% → ≈ 75 total.)

## Retry ERROR, never FAIL

- **ERROR** from a crash, timeout, or tool failure is infrastructure noise → retrying
  is legitimate; it recovers the sample without biasing the measurement.
- **FAIL** is a real signal → never retry. Retrying a FAIL hides defects and biases
  the rate toward PASS.

A model **refusal** is not infrastructure noise — it is model behaviour and may
correlate with case difficulty. Inspect refusals before treating them as retryable
ERRORs; blindly resampling them can bias the rate.

## Attributing an effect (A/B)

To claim a change (e.g. a rule) caused a difference, compare two variants that differ
in exactly one factor, over the same cases, same harness, same grader. The
one-factor difference is what makes the comparison valid; verify it (assert the
variants are identical apart from the factor).

## Before trusting a FAIL or an ERROR

- A **FAIL** may be a grader artifact (e.g. whitespace or newline normalisation),
  not a real defect. Inspect the captured output before concluding.
- An **ERROR** may be an environment failure (full disk, tool flakiness) that the
  model reports as a content problem ("file not found"). Verify ground truth from
  the harness, not from the model's own report.

## Do not publish an underpowered report

A rate from too few gradeable runs is meaningless (0/5 → ≤ 60%). Gate report saving
on a minimum gradeable count tied to the claim the report makes, and state the count
in the report so the reader can judge it.

## Reducing the observed rate

Measuring the rate is separate from lowering it. To lower it:

- **Code computes, the model phrases.** Do critical computation (sums, aggregates,
  filters) in deterministic code; let the model only put a finished value into words.
  The model never touches arithmetic.
- **Structured output + schema validation.** Where the model must return structured
  data, force a fixed shape (e.g. JSON) and validate it against a schema before use;
  reject invented fields. A deterministic gate after the model.
- **Grounding.** Instruct the model to answer only from provided data ("if it is not
  in the data, say you do not know"). Effective combined with validation, not alone.
- **Name the failure mode in the instruction.** Stating the exact way to go wrong
  ("apply only the given placeholders, do not invent domain content") reduces it more
  than a generic instruction.

## Glossary

- **A/B test (variant, control)** — Two runs of the same eval differing in exactly one
  factor, to attribute an effect to that factor. The control lacks the factor.
- **Confidence (95%)** — Procedure-based: if the whole eval were repeated many times,
  about 95% of the computed bounds would contain the true rate. Not a probability that
  the true rate lies outside one specific computed bound (the true rate is fixed; the
  bound is what varies).
- **Confidence interval (CI)** — A range that, at a stated confidence level (e.g. 95%),
  is expected to contain the true value. The rule-of-three upper bound is a one-sided CI.
- **Critical data path** — A path where a wrong output has real consequences (money,
  stock, decisions). The more critical, the less an LLM should decide there.
- **Deterministic component** — Same input → same output. One run proves behaviour.
- **Deterministic gate / layer** — Code after the model that validates or computes,
  turning a probabilistic output into a guaranteed one (schema validation, a grader).
- **ERROR (verdict)** — A run that produced no gradeable output (crash, refusal, tool
  failure, timeout). Excluded from the rate.
- **Eval** — A measurement of how often a probabilistic component produces the correct
  output, reported as a rate with its uncertainty.
- **FAIL (verdict)** — A run whose output differs from the reference; a real defect.
- **False FAIL** — A FAIL caused by the grader (e.g. whitespace/newline handling), not
  by the component. Inspect the output to distinguish.
- **Flakiness / transient** — Intermittent, environment-caused failures unrelated to
  the component (tool errors, resource limits). Surface as ERROR; handle with retry.
- **Gradeable** — Runs that produced a comparable output: PASS + FAIL. The denominator
  of the rate.
- **Grader** — The code that decides a run's verdict by comparing the output to a
  reference.
- **Grounding** — Instructing the model to answer only from provided data. Reduces
  hallucination; not a hard guarantee on its own.
- **Hallucination** — A plausible but wrong output (invented field, wrong number,
  non-existent id). The model predicts the likely continuation, which is not the true one.
- **Harness** — The deterministic code around the component: loop, workspace reset,
  invocation, result collection.
- **JSONL (JSON Lines)** — A file format where each line is one complete JSON object
  (newline-separated), not one array. Records can be appended one at a time and parsed
  line by line; the eval log uses it.
- **Nondeterminism / probabilistic component** — Same input → different output across
  runs. One run is one sample, not proof.
- **PASS (verdict)** — A run whose output matches the reference.
- **Point estimate** — The best single guess of the true rate (the observed rate).
  Meaningful only when at least one failure was observed.
- **Rate** — The fraction of gradeable runs that FAIL: FAIL / (PASS + FAIL).
- **Retry** — Re-running a case. Legitimate for ERROR (infra noise), never for FAIL
  (would hide defects and bias the rate toward PASS).
- **Rule of three** — With 0 failures in N gradeable runs, the true rate is ≤ 3/N
  (95% confidence).
- **Sample size (N)** — The number of gradeable runs. Larger N tightens the bound; it
  does not change the true rate.
- **Schema validation** — Checking a model's structured output against a fixed schema
  before use; rejects invented fields. A deterministic gate.
- **Structured output** — Forcing the model to produce a fixed shape (e.g. JSON) rather
  than free text, so it can be validated.
- **True rate** — The component's fixed, unknown failure probability. The eval bounds
  or estimates it; measuring does not change it.
- **Underpowered** — A result from too few gradeable runs to support the claim
  (e.g. 0/5 → ≤ 60%).
- **Upper bound** — The highest value the true rate could plausibly take (95%
  confidence). For 0 failures, 3/N.
