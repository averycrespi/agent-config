# Verification

How to know if the agent's output is correct. A strong emerging 2026 pattern is a three-layer stack: deterministic gates first, agentic rubrics second, multiple reviewers third. This document covers each layer, the biases that plague LLM-as-judge, and how to mitigate them.

## The three-layer stack

Apply in order. Skipping the cheap layer to argue with an LLM is a tax.

### Layer 1: Deterministic gates

Type checks, linters, unit tests, build success. Cheap, fast, **infallible-on-true-pass**: if `pytest` exits 0, the tests passed.

What to wire up by default:

- Compiler / type checker (`tsc --noEmit`, `mypy`, `cargo check`).
- Linter (`eslint`, `ruff`, `clippy`).
- Existing test suite (run only what's affected if the suite is large).
- Build (cheap signal that the project still assembles).

Reference: [VeriGuard: Verified Code Generation for LLM Agents](https://arxiv.org/html/2510.05156v1) — formal-method gates as canonical deterministic-first paper.

This layer catches type errors, syntax errors, broken imports, missing tests, regressions in covered behavior. It does NOT catch:

- Behavior the existing tests don't cover.
- Architectural fit / readability / convention adherence.
- Spec compliance for new behavior.

Layer 2 and 3 fill those gaps.

### Layer 2: Agentic rubrics

Per-issue rubrics built from the ticket and repo at runtime. Reference: [Agentic Rubrics as Contextual Verifiers](https://arxiv.org/pdf/2601.04171) (April 2026) — verifier reads the ticket and repo at runtime, builds a problem-specific rubric, scores the patch against it. Beats both generic LLM-as-judge and pure test execution on issues where tests are sparse.

Implementation:

- Build the rubric from acceptance criteria (see `workflow-patterns.md` on AC threading).
- Each criterion gets a verdict (✅ / ❌ / N/A) with evidence (file:line where the criterion is satisfied or violated).
- Verifier prompt is built by _orchestrator code_ from the AC artifact on disk — not from the implementer's narrative (validator information barrier; see `workflow-patterns.md`).

Why this works: contextual rubrics are grounded in the specific change. Generic "is this code good?" prompts produce generic "yes the code is good" responses with no falsifiable claims.

### Layer 3: Multiple reviewers, diverse lenses

Strong emerging practice: use 3–5 reviewers for high-stakes changes, each with a distinct lens and a _short_ rubric. Smaller or lower-risk workflows often collapse this to one or two reviewers.

Standard lens set:

| Lens              | Looks for                                                             |
| ----------------- | --------------------------------------------------------------------- |
| Plan-completeness | Each plan task did what it claimed; AC are met                        |
| Integration       | Code fits the codebase (imports, naming, conventions, file placement) |
| Security          | OWASP top 10 issues, credential leakage, untrusted input handling     |
| Test quality      | Coverage of new behavior; no flaky / brittle / mock-heavy tests       |
| Performance       | Hot paths, N+1 queries, unbounded loops, complexity regressions       |

Calibrate against a golden dataset to 75–90% human agreement before deployment. A reviewer that disagrees with humans is a reviewer that injects noise.

`roach-pi` runs 5 lenses × 2 seeds = 10 reviewers. Most pipelines run 3 lenses × 1 seed = 3 reviewers. SOTA SWE-bench scaffolds use ≥3.

## The four LLM-judge biases

Untreated judges commonly exhibit these. Listed in rough order of severity for verify-loops:

### Self-preference bias (most dangerous)

Judges are ~50% more likely to pass output from their own model family on objective rubrics. On subjective rubrics, the skew is worse. Reference: [Self-Preference Bias in Rubric-Based Evaluation](https://arxiv.org/abs/2604.06996) — quantifies SPB on objective IFEval rubrics and subjective HealthBench (10-point skew).

Mitigation: separate implementation from verification context. Give a fresh read-only reviewer the authoritative AC, actual diff, repository context, and deterministic results rather than the implementer's persuasive narrative. Require per-criterion evidence and calibrate the reviewer on known defects. Choose between GPT-5.6 and Astra based on evaluation results; neither changing models within one family nor running fresh instances eliminates family-level self-preference.

Caveat: the cited measurements are not a GPT-5.6/Astra coding-review benchmark. Rubric biases can also transfer across judge families; see [Rubrics as an Attack Surface: Stealthy Preference Drift](https://arxiv.org/abs/2602.13576). Model diversity is an optional mitigation, not a substitute for evidence.

### Verbosity bias

Longer responses score higher even when they're not better. The implementer learns to pad output with rationale to nudge the verdict.

Mitigation:

- Reviewer prompt explicitly says "verbosity is not a quality signal."
- Score on per-criterion verdicts, not on overall narrative.
- Cap reviewer's own response length so the reviewer can't argue itself into agreement through verbosity.

### Position bias

When comparing two responses, the first or last one scores higher independent of content. Affects A/B comparisons more than absolute scoring.

Mitigation: when running comparison reviews (rare for agentic harnesses; common for evals), randomize order across runs, or score absolutely against rubric instead of comparatively.

### Authority bias

Responses that cite prior work, name experts, or use technical jargon score higher even when the citations are wrong. Particularly damaging when the implementer agent invokes "as recommended in [paper]" framing.

Mitigation: reviewer prompt says "do not give credit for citations or appeals to authority; verify each factual claim against the code."

## Independent verification with available models

Independence is a workflow property: fresh context, read-only access, authoritative AC, and findings grounded in artifacts the reviewer inspects. A different model name alone does not establish it.

For GPT-5.6/Astra deployments, select reviewer profiles by task-level quality, cost, and latency evaluations. A fresh instance of the implementing model is acceptable; use another available model or a second distinct review lens when it demonstrably adds value. Do not require an unused provider solely to satisfy a cross-family rule.

Use repeated independent reviews only when risk or measured recall justifies their cost. Different prompts or stochastic runs can expose missed paths, but correlated errors remain; do not assume a second run halves variance. Check whether the provider actually supports a seed parameter before adopting a literal two-seed implementation.

For higher-stakes evaluation, consider **jury-on-demand** — dynamic jury selection per input with member-weighting. Reference: [Who Judges the Judge? LLM Jury-on-Demand](https://arxiv.org/pdf/2512.01786). Production-overkill for most harnesses; useful for evaluation infra.

## Self-preference is not the only failure mode

[Are We on the Right Way to Assessing LLM-as-a-Judge?](https://arxiv.org/html/2512.16041v1) reframes judge reliability as item-response-theory measurement — different rubrics measure different things, and aggregate "agreement with human" hides which kinds of items the judge is unreliable on.

Implication: a verifier that hits 85% agreement on golden dataset A may hit 60% on dataset B. If you change what your harness produces (new feature areas, new task types), recalibrate.

## Calibration against a golden dataset

The single under-used technique. Pattern:

1. Collect 50–200 examples of output your harness has produced.
2. Have humans label each as pass/fail (with rubric scores ideally).
3. Run your verifier on the same examples.
4. Compare. Aim for ≥75–90% agreement.
5. If agreement is low, look at false positives and false negatives separately — they have different fixes.
6. Iterate on the rubric until agreement crosses threshold.

Without calibration, treat the verifier as a useful triage signal rather than an authority.

Reference: [Adnan Masood — Rubric-Based Evals: LLM-as-a-Judge Methodologies](https://medium.com/@adnanmasood/rubric-based-evals-llm-as-a-judge-methodologies-and-empirical-validation-in-domain-context-71936b989e80) — practical methodology.

## Reviewer prompt anatomy

A well-constructed reviewer prompt has these sections:

```markdown
# Role

You are a [lens-specific] reviewer for [project type].

# Rubric

For each acceptance criterion below, return a verdict (PASS / FAIL / N/A) with
evidence (file:line).

[AC list, populated by orchestrator from disk]

# Instructions

- Score per-criterion. Do not give an overall narrative score.
- Verbosity is not a quality signal.
- Do not give credit for citations or appeals to authority; verify each
  factual claim against the code.
- Halt if you encounter conflicting AC; surface them rather than picking one.

# Output schema

[strict JSON schema for {criterion_id, verdict, evidence, notes}]

# What you're reviewing

[diff or commit list, populated by orchestrator]
```

Notes:

- AC come from disk via orchestrator code, not from the implementer's prose.
- Output schema is strict (JSON Schema, TypeBox, or Pydantic). Reviewer cannot escape with free text.
- Specific anti-bias instructions go inline. They cost a few hundred tokens and pay for themselves in lower noise.

## When to skip the LLM verifier entirely

Sometimes the cheapest right answer is "no LLM in the verifier."

- **All AC are testable with code.** Just run the tests. The verifier is the test runner.
- **Output is structured data.** JSON schema validation is the verifier.
- **Output is a refactor with no behavior change.** Test pass + diff size + LSP diagnostics may be sufficient.
- **You're already paying for human review.** Don't add an LLM verifier that the human now has to second-guess.

The presence of an LLM verifier in the pipeline is itself a design decision, not a default.

## Reliability, not pass@1

[Beyond pass@1: A Reliability Science Framework](https://arxiv.org/html/2603.29231v1) introduces RDC, VAF, GDS, MOP metrics over 23,392 episodes. Most rigorous quantitative framework for reliability decay you'll find. If you're publishing harness benchmarks, use these — pass@1 is misleading for long-horizon agents.

[SlopCodeBench](https://arxiv.org/abs/2603.24755) is the coding-domain answer to the Long-Horizon Task Mirage paper. Iterative coding tasks where agents extend their own prior solutions. No agent solves any problem end-to-end across 11 models. Useful when you want evidence that long-horizon coding _as a problem class_ is unsolved.

## Practical defaults

If you're starting a new harness today and want defaults that work:

1. Wire deterministic gates first. Don't add an LLM verifier until tests/types/lints are passing.
2. Size review to risk and required workflow gates. A single fresh reviewer can cover completeness and integration; add distinct security or performance lenses when relevant.
3. Use available GPT-5.6/Astra profiles with independent context and artifact-based evidence. Add model diversity or repeated runs only when evaluations justify them; acknowledge same-family blind spots.
4. Per-criterion verdicts in strict JSON where supported, otherwise parsed tags. No free-text "looks good" outputs.
5. Calibrate on 50+ examples before declaring the verifier authoritative; otherwise label it as triage.
6. Inline anti-bias instructions in the reviewer prompt.
7. 2-round fix-loop cap with sticky completion.

The goal is a verifier whose verdict you'd actually act on without checking the diff yourself.
