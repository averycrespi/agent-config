# Anti-patterns

Documented failure modes from production agent deployments and from the agent-engineering literature. Each entry: what it is, why it fails, what to do instead, and a citation.

This document is for _debugging an existing harness_. If a harness is misbehaving, scan this list first — most weird behavior maps to one of these.

## Architecture-level

### Unstructured multi-agent debate / agent-to-agent negotiation

**What**: Two or more LLM agents converse without a fixed decomposition, budget, or synthesis contract. Variants: open-ended "critic and proposer," "red team / blue team," or "panel of experts."

**Why it fails**: Agents can drift, agree spuriously, argue past each other, or expand work without a deterministic stop condition. GPT-5.6's Multi-agent beta makes bounded coordinator-worker delegation a supported primitive; it does not make open-ended negotiation reliable.

**Instead**: Keep permissions, budgets, validation, and termination in a deterministic outer control plane. Delegate self-contained questions only when parallelism, substantial context isolation, or independent judgment offers a clear benefit, then validate the synthesized result. Keep implementation and fixes in the owning session unless the user explicitly requests a compliant writable execution workflow.

**Citation**: [Cognition — Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) (2025); [OpenAI — Multi-agent](https://developers.openai.com/api/docs/guides/tools-multi-agent) (GPT-5.6 beta).

### Parallel implementations of the same subtask + merge

**What**: N implementer agents work on the same task in parallel; orchestrator picks the best or merges.

**Why it fails**: Hidden coupling. Each implementation makes micro-decisions (variable naming, error handling style, where to put a helper) that diverge. Merging produces inconsistent code or requires a third agent to reconcile, which loses the benefit. Different tasks or isolated worktrees do not by themselves remove logical coupling or justify delegation.

**Instead**: Preserve owning-session implementation by default. A writable exception requires an explicit user request, an explicit execution workflow with bounded scope, one writer, orchestrator-owned state and evidence, a structured handoff, and independent verification. For independent judgment, prefer risk-justified read-only review.

**Citation**: [Cognition — Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents), principle 2.

### LLM-driven mid-task replanning

**What**: While an implementer is executing, a coach/planner agent monitors and injects new guidance.

**Why it fails**: Devin's production report warns that repeated coaching can hurt performance. Treat this as evidence against uncontrolled prompt accumulation, not a universal prohibition on user corrections.

**Instead**: Keep acceptance criteria stable during execution. For an authorized scope revision, update durable requirements, reconcile completed work, and revalidate affected evidence. Astra steering can deliver the correction without making the model the owner of scope.

**Citation**: [Cognition — Devin Annual Performance Review 2025](https://cognition.ai/blog/devin-annual-performance-review-2025).

### Self-improving agents that rewrite their own scaffold mid-run

**What**: Agent modifies its own tool definitions, prompts, or orchestration logic during a single run.

**Why it fails**: Cool research direction; not production-ready. The harness's stability is what makes the agent's behavior debuggable. Agents that rewrite their harness are agents you can't reason about.

**Instead**: Iterate on the scaffold offline. Ship a stable harness; learn from runs; ship a new stable harness.

**Citation**: [Live-SWE-Agent — Self-Evolving Scaffolds](https://arxiv.org/pdf/2511.13646). The paper itself is honest about the early-stage nature of the work.

## Prompt and instruction-level

### Generic LLM-as-judge without rubrics

**What**: "Is this code good? Yes/No." Free-text reviewer with no scoring rubric.

**Why it fails**: Generic judges produce verdicts without a task-specific basis. AC-grounded rubrics make claims falsifiable and direct the reviewer toward concrete defects.

**Instead**: Per-criterion rubric grounded in acceptance criteria. Validated machine-readable output (`{criterion_id, verdict, evidence}` where JSON is supported). Use fresh reviewer context and inspect actual artifacts. See `verification.md`.

**Citation**: [Agentic Rubrics as Contextual Verifiers](https://arxiv.org/pdf/2601.04171).

### Free-text completion markers

**What**: Termination signals like `<promise>COMPLETE</promise>` parsed by string match.

**Why it fails**: Models sometimes emit the marker conversationally ("I'll signal `<promise>COMPLETE</promise>` when done"). Models sometimes don't emit it when actually done. Models sometimes emit it followed by more work.

**Instead**: Validated machine-readable output (JSON schema where supported, or a tagged-output protocol like `<rmr:next_state>done</rmr:next_state>` parsed structurally).

**Citation**: `klaudworks/ralph-meets-rex` documents this in its design notes.

### Verify → implement loopback

**What**: Verifier finds an issue; orchestrator routes back to implementer; implementer fixes; verifier re-runs with no hard cap or termination policy.

**Why it fails**: Verifier finds new issues with each iteration; perfectionism prevents termination.

**Instead**: Use an explicit fix phase with a hard cap (2 rounds by default). After cap, surface remaining issues as known issues in the report. Always emit a final report. Sticky completion: once a phase reaches `done`, no edge out.

**Citation**: `klaudworks/ralph-meets-rex` ships the loopback design with explicit warnings and a `HUMAN_INTERVENTION_REQUIRED` escape hatch.

### Contradictory instructions in composed system prompts

**What**: Orchestrator composes the system prompt from multiple skill files, plus per-phase prompts, plus user and repository `AGENTS.md` files. One says "never X," another says "always X."

**Why it fails**: Astra's stronger instruction following makes conflicting skill and repository guidance consequential; unclear rules can cause unnecessary pauses or scope drift.

**Instead**: Run a contradiction-lint pass on composed prompts. Cheap pre-flight check; large quality win.

**Citation**: [Using GPT-6 Astra — Instruction following](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra).

### Step-by-step prose where outcome+success-criteria would do

**What**: System prompt micro-specifies the procedure: "First do X, then Y, then Z."

**Why it fails on GPT-5.6**: Excessive procedural detail can constrain the model to a worse path. OpenAI recommends shorter prompts that state outcomes, constraints, and success criteria.

**Instead**: "Achieve X with these criteria for done: ..."

**Citation**: [Using GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6).

### Generic brevity instructions on GPT-5.6

**What**: A global prompt says "be concise," "keep it short," or "use minimal text" without saying what content must remain.

**Why it fails**: GPT-5.6 is already biased toward compression. Generic brevity can change task prioritization, causing the model to substitute a shorter response for a complete artifact or omit required evidence and caveats.

**Instead**: Lead with the conclusion and preserve required facts, decisions, evidence, caveats, and next actions. Trim introductions, repetition, generic reassurance, and optional background first.

**Citation**: [Using GPT-5.6 — Personality and style](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6).

### Tool guidance in the system prompt

**What**: System prompt explains when to use each tool, side effects, error handling, retry semantics.

**Why it fails on GPT-5.6**: That guidance belongs in tool _descriptions_. Putting it in the system prompt means the model has to mentally re-route every tool decision through prose; it also bloats the system prompt.

**Instead**: Move per-tool guidance into the tool description: when to use, side effects, retry safety, error modes. System prompt describes the agent's _role_.

**Citation**: [Using GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6).

## Context and memory

### Massive context windows as a substitute for retrieval

**What**: "We have 1M context, just put everything in."

**Why it fails**: Vendor reports from Zylos and Harness argue that context drift may cause more enterprise failures than raw context exhaustion ([Zylos](https://zylos.ai/research/2026-02-28-ai-agent-context-compression-strategies), [Harness](https://www.harness.io/blog/defeating-context-rot-mastering-the-flow-of-ai-sessions)). Treat this as a production signal, not controlled evidence. Bigger windows make compaction _more_ important, not less. Models get worse at finding the relevant signal in a large window, not better.

**Instead**: Just-in-time retrieval. Lightweight identifiers (paths, function names) resolved on demand via tools. Big windows are a _capacity_ lever, not a _correctness_ lever.

**Citation**: Zylos, Harness, [Anthropic on context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

### Uncalibrated context-pressure cues

**What**: Surfacing turn/token warnings without measuring their effect on completion quality.

**Risk to evaluate**: Warnings may encourage premature completion rather than useful prioritization. Treat this as a harness design hypothesis, not a documented GPT-5.6/Astra behavior.

**Instead**: Keep hard budgets in the harness, preserve acceptance criteria across compaction, and require honest partial-result reporting. See `context-engineering.md`.

### Inlining workflow state into every subagent prompt

**What**: Plan, AC list, prior decisions all copy-pasted into each subagent's prompt.

**Why it fails**: Token cost (N×plan_size). Compaction hostility. Drift between subagents if the orchestrator's copy of the plan changes mid-run.

**Instead**: Write artifacts to `<workflowDir>/`. Subagent prompts say "read `<workflowDir>/PLAN.md`." Persist phase state separately so the orchestrator can resume without trusting conversation history.

**Citation**: [Anthropic on context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents); roach-pi's shared-diff-artifact pattern.

## Production failure modes

### The Clyro five (production observations)

[Clyro — The 5 AI Agent Failure Modes](https://clyro.dev/blog/the-5-ai-agent-failure-modes-why-they-fail-in-production/) reports observed proportions across production deployments:

| Failure mode       | Share | What it looks like                                                       |
| ------------------ | ----- | ------------------------------------------------------------------------ |
| Context Blindness  | 31.6% | Agent doesn't see relevant prior state (compaction loss, retrieval gap)  |
| Rogue Actions      | 30.3% | Agent does something the user didn't ask for (gold-plating, scope creep) |
| Silent Degradation | 24.9% | Agent's output quality drops over a long session without an error signal |
| Memory Corruption  | 8.1%  | State written to memory is wrong; future turns build on the bad state    |
| Runaway Execution  | 5.1%  | Agent loops or burns tokens without progress                             |

Mitigations map to patterns elsewhere in this skill:

- **Context Blindness** → just-in-time retrieval, structured note-taking, re-state constraints at phase boundaries.
- **Rogue Actions** → scope-discipline blocks in implementer prompt, diff budgets, "don't gold-plate" instruction.
- **Silent Degradation** → sticky completion, capped fix loops, calibrated verifiers.
- **Memory Corruption** → atomic writes, validate before commit, single source of truth on disk.
- **Runaway Execution** → idle-iteration kill switches, task budgets, hard caps.

### "Performs worse when you keep telling it more"

**What**: Devin's documented finding from 18 months of production.

**Why it matters**: Repeated reminders and coaching can accumulate conflicting constraints. This production observation does not establish that every mid-stream update degrades GPT-5.6 or Astra.

**Instead**: Avoid redundant nudges. Handle user corrections as explicit scope revisions with updated durable state and evidence; see the Astra guidance in `models.md`.

**Citation**: [Cognition — Devin Annual Performance Review 2025](https://cognition.ai/blog/devin-annual-performance-review-2025).

## Workflow-level

### Skipping AC extraction on ticket-to-PR

**What**: Pipe ticket text directly into a planner without extracting acceptance criteria.

**Why it fails**: Without AC, "done" is a vibe. Implementer doesn't know what specifically must be true. Verifier can't score against testable criteria. Production ticket-to-PR pipelines that work at scale all start from explicit AC.

**Instead**: Extract AC as a first-class phase. Persist as `ac.json`. Thread into every later phase.

**Citation**: [Bitmovin](https://bitmovin.com/blog/ai-developer-workflows-jira-to-pull-request/), [Kinde](https://www.kinde.com/learn/ai-for-software-engineering/workflows/from-jira-ticket-to-production-code-ai-powered-spec-workflows/), [70 Jira tickets](https://dev.to/taras-lysyi/how-i-completed-70-jira-tickets-using-ai-agents-and-slept-through-it-3knb), [OpenAI harness engineering](https://openai.com/index/harness-engineering/).

### No deterministic gates before LLM verification

**What**: Pipeline goes implement → LLM-reviewer → fix without running tests/types/lints first.

**Why it fails**: You're paying an LLM to find bugs the type checker would have surfaced for free. Wastes tokens. Slower iteration.

**Instead**: Always run deterministic gates first. The LLM verifier picks up where the gates leave off (architectural fit, spec compliance, test quality).

**Citation**: Strong 2026 verification pattern across [Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [Augment](https://www.augmentcode.com/guides/harness-engineering-ai-coding-agents), [Datadog](https://www.datadoghq.com/blog/ai/harness-first-agents/).

### Verification that trusts the implementer's narrative

**What**: A reviewer approves the implementer's explanation without independently inspecting the change.

**Why it fails**: Persuasive prose can hide defects, and shared assumptions or model-family biases can produce correlated errors.

**Instead**: Use fresh read-only reviewer context, AC from authoritative artifacts, deterministic results, and concrete file/line evidence. Select GPT-5.6/Astra reviewers by evaluations; changing models is optional diversity and does not remove same-family blind spots. See `verification.md`.

**Citation**: [Self-Preference Bias in Rubric-Based Evaluation](https://arxiv.org/abs/2604.06996).

### Plans that contain line-by-line diffs

**What**: Plan task says "in `auth.ts:42`, change `if (x)` to `if (x && y)`."

**Why it fails**: The implementing agent has more local context than the planner. The plan's diff is often subtly wrong (off by a line, conflicts with parallel changes, misses a call site). Implementer either copies the diff verbatim and breaks something, or ignores it and the plan was useless.

**Instead**: Plan = intent. "Tighten the auth check in `auth.ts` to require both X and Y conditions; cover the existing test cases plus add one for the new condition."

**Citation**: Universal across [`roach-pi`](https://github.com/tmdgusya/roach-pi), [`ralph-meets-rex`](https://github.com/klaudworks/ralph-meets-rex), [`agent-pi`](https://github.com/ruizrica/agent-pi).

### Prompt-only safety policy

**What**: The system prompt says "do not push," "do not delete," or "do not access secrets," but the tool surface still allows those actions.

**Why it fails**: Instructions are advisory. Tool outputs, repo files, tickets, and web pages can contain prompt-injection text. Even without malicious input, models make mistakes under long-horizon pressure.

**Instead**: Enforce policy in hooks, permission callbacks, tool allow lists, broker scopes, sandboxing, and approval gates. See `operations-safety.md`.

**Citation**: Pi extension docs warn that extensions run with full system permissions; see `platforms.md` and `operations-safety.md`.

### No observability or replay

**What**: A run fails, but the only record is the final chat transcript.

**Why it fails**: Long-running harness bugs are phase/state bugs. Without tool-call traces, artifact versions, model versions, token usage, and state transitions, failures cannot be debugged or regression-tested.

**Instead**: Record phase-level traces, redacted tool arguments/results, state transitions, artifact hashes, and final structured reports. Keep golden traces for replay with side effects stubbed.

**Citation**: Datadog's observability-driven harness framing; this skill's `operations-safety.md` checklist.

### Unbounded work without a progress policy

**What**: An unattended pipeline repeats work without task-relevant progress, bounded repair, or configured execution limits.

**Why it fails**: Repeated unproductive actions consume resources. Conversely, treating every turn without a file modification as idle can stop useful reading, diagnosis, or verification.

**Instead**: Preserve execution budgets and bounded fix loops. Evaluate optional progress guards against actual failure modes and count evidence gathering and completed checks as progress. Restrict file-delta counters or diff caps to workflows where measurements justify them; do not impose a universal number of idle turns.

**Citation**: [Tests-First Agent Loop](https://medium.com/@Micheal-Lanham/stop-burning-tokens-the-tests-first-agent-loop-that-cuts-thrash-by-50-d66bd62a948e).

## Platform-specific gotchas

### Pi: ESM module exports can't be `mock.method`'d

**What**: Test does `mock.method(child_process, "spawn", stub)`; throws because ESM exports are non-configurable bindings.

**Instead**: Wrap in an exported holder: `export const _spawn = { fn: _nodeSpawn }`. Call through `_spawn.fn(...)`. Tests then `mock.method(_spawn, "fn", stub)`. Reference: `pi/agent/extensions/subagents/spawn.ts:19-22`.

**Citation**: This repo's `AGENTS.md`.

### Pi: snake_case schemas vs camelCase fields

**What**: Tool schema exposed to the agent is snake_case (`failure_reason`); internal state field is camelCase (`failureReason`). Forgetting to map one to the other breaks validation.

**Instead**: Map in the tool's `execute` body. This is the in-repo convention.

**Citation**: This repo's `AGENTS.md`.
