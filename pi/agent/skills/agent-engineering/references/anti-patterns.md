# Anti-patterns

Documented failure modes from production agent deployments and from the agent-engineering literature. Each entry: what it is, why it fails, what to do instead, and a citation.

This document is for _debugging an existing harness_. If a harness is misbehaving, scan this list first — most weird behavior maps to one of these.

## Architecture-level

### Multi-agent debate / agent-to-agent negotiation

**What**: Two or more LLM agents converse with each other to refine an answer. Variants: "critic and proposer," "red team / blue team," "panel of experts."

**Why it fails**: Agents lack the shared grounding that makes human debate productive. They drift, agree spuriously, or argue past each other. It does not appear in the mainstream production harnesses surveyed for this skill.

**Instead**: Code orchestrator coordinating fresh subagents with validated machine-readable outputs. Reviewer reads spec + code, returns rubric verdict; orchestrator decides what to do.

**Citation**: [Cognition — Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) (2025). Reinforced by Claude Code's own architecture: subagents are used almost exclusively for read-only work.

### Parallel implementations of the same subtask + merge

**What**: N implementer agents work on the same task in parallel; orchestrator picks the best or merges.

**Why it fails**: Hidden coupling. Each implementation makes micro-decisions (variable naming, error handling style, where to put a helper) that diverge. Merging produces inconsistent code or requires a third agent to reconcile, which loses the benefit. Worktree-per-implementer is fine for _different_ tasks but not for racing the same task.

**Instead**: Sequential implement. One implementer per task. If you want diversity, change task decomposition or use multiple reviewers, not multiple implementers.

**Citation**: [Cognition — Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents), principle 2.

### LLM-driven mid-task replanning

**What**: While an implementer is executing, a coach/planner agent monitors and injects new guidance.

**Why it fails**: Devin's data — "performs worse when you keep telling it more after it starts." Iterative coaching mid-task is _negative-EV_ for current-gen agents. The implementer treats new guidance as additional constraints, leading to over-cautious or self-contradictory output.

**Instead**: Take the spec as immutable once implementation begins. If the plan needs to change, halt, replan from scratch with full context, then restart implementation.

**Citation**: [Cognition — Devin Annual Performance Review 2025](https://cognition.ai/blog/devin-annual-performance-review-2025).

### Self-improving agents that rewrite their own scaffold mid-run

**What**: Agent modifies its own tool definitions, prompts, or orchestration logic during a single run.

**Why it fails**: Cool research direction; not production-ready. The harness's stability is what makes the agent's behavior debuggable. Agents that rewrite their harness are agents you can't reason about.

**Instead**: Iterate on the scaffold offline. Ship a stable harness; learn from runs; ship a new stable harness.

**Citation**: [Live-SWE-Agent — Self-Evolving Scaffolds](https://arxiv.org/pdf/2511.13646). The paper itself is honest about the early-stage nature of the work.

## Prompt and instruction-level

### Generic LLM-as-judge without rubrics

**What**: "Is this code good? Yes/No." Free-text reviewer with no scoring rubric.

**Why it fails**: Beaten consistently by rubric-based + cross-family verifiers in every benchmark since 2025. Generic judges produce generic verdicts; they don't catch specific bugs.

**Instead**: Per-criterion rubric grounded in acceptance criteria. Validated machine-readable output (`{criterion_id, verdict, evidence}` where JSON is supported). Cross-family if available. See `verification.md`.

**Citation**: [Agentic Rubrics as Contextual Verifiers](https://arxiv.org/pdf/2601.04171).

### Free-text completion markers

**What**: Termination signals like `<promise>COMPLETE</promise>` parsed by string match.

**Why it fails**: Models sometimes emit the marker conversationally ("I'll signal `<promise>COMPLETE</promise>` when done"). Models sometimes don't emit it when actually done. Models sometimes emit it followed by more work.

**Instead**: Validated machine-readable output (JSON schema where supported, or a tagged-output protocol like `<rmr:next_state>done</rmr:next_state>` parsed structurally).

**Citation**: `klaudworks/ralph-meets-rex` documents this in its design notes.

### Verify → implement loopback

**What**: Verifier finds an issue; orchestrator routes back to implementer; implementer fixes; verifier re-runs with no hard cap or termination policy.

**Why it fails**: The exact open-ended loop GPT-5/Claude-4-class models thrash in. Verifier finds new issues with each iteration; perfectionism prevents termination.

**Instead**: Use an explicit fix phase with a hard cap (2 rounds by default). After cap, surface remaining issues as known issues in the report. Always emit a final report. Sticky completion: once a phase reaches `done`, no edge out.

**Citation**: `klaudworks/ralph-meets-rex` ships the loopback design with explicit warnings and a `HUMAN_INTERVENTION_REQUIRED` escape hatch.

### Contradictory instructions in composed system prompts

**What**: Orchestrator composes the system prompt from multiple skill files, plus per-phase prompts, plus user `AGENTS.md`, plus repo `CLAUDE.md`. One says "never X," another says "always X."

**Why it fails**: GPT-5.x's tighter instruction-following means conflicting directives cause the model to burn reasoning tokens reconciling rather than resolving. Quality drops.

**Instead**: Run a contradiction-lint pass on composed prompts. Cheap pre-flight check; large quality win.

**Citation**: GPT-5 prompting guides note this; documented in the OpenAI cookbook.

### Step-by-step prose where outcome+success-criteria would do

**What**: System prompt micro-specifies the procedure: "First do X, then Y, then Z."

**Why it fails on GPT-5.5**: OpenAI's [GPT-5.5 prompt guidance](https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5.5) explicitly says replace step-by-step prose with outcome + success criteria. Tighter instruction-following means the model now over-literally follows the procedure even when a better path exists. Old prompts "narrow the model's search space."

**Instead**: "Achieve X with these criteria for done: ..."

**Citation**: [GPT-5.5 Prompt Guidance](https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5.5); [the-decoder summary](https://the-decoder.com/openai-says-old-prompts-are-holding-gpt-5-5-back-and-developers-need-a-fresh-baseline/).

### Tool guidance in the system prompt

**What**: System prompt explains when to use each tool, side effects, error handling, retry semantics.

**Why it fails on GPT-5.5**: That guidance belongs in tool _descriptions_. Putting it in the system prompt means the model has to mentally re-route every tool decision through prose; it also bloats the system prompt.

**Instead**: Move per-tool guidance into the tool description: when to use, side effects, retry safety, error modes. System prompt describes the agent's _role_.

**Citation**: [GPT-5.5 Prompt Guidance](https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5.5).

### Old "double-check" / "be careful" scaffolding on Claude Opus 4.x

**What**: Prompt says "double-check your work," "be careful with X," "verify before responding."

**Why it fails**: Current Opus 4.x models follow instructions more literally. "Double-check" produces extra verification turns instead of being interpreted as polite emphasis. Wastes tokens, slows the loop.

**Instead**: State the constraint once, clearly. Trust the model. Use structured verification at phase boundaries instead of asking the implementer to self-verify.

**Citation**: [Best practices for using Claude Opus 4.7 with Claude Code](https://claude.com/blog/best-practices-for-using-claude-opus-4-7-with-claude-code); [What's new in Claude Opus 4.8](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-8).

## Context and memory

### Massive context windows as a substitute for retrieval

**What**: "We have 1M context, just put everything in."

**Why it fails**: Vendor reports from Zylos and Harness argue that context drift may cause more enterprise failures than raw context exhaustion ([Zylos](https://zylos.ai/research/2026-02-28-ai-agent-context-compression-strategies), [Harness](https://www.harness.io/blog/defeating-context-rot-mastering-the-flow-of-ai-sessions)). Treat this as a production signal, not controlled evidence. Bigger windows make compaction _more_ important, not less. Models get worse at finding the relevant signal in a large window, not better.

**Instead**: Just-in-time retrieval. Lightweight identifiers (paths, function names) resolved on demand via tools. Big windows are a _capacity_ lever, not a _correctness_ lever.

**Citation**: Zylos, Harness, [Anthropic on context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

### Context anxiety

**What**: Surfacing context-pressure signals to the agent ("you have N tokens remaining," "you're at 80% of your context limit").

**Why it fails**: Sonnet 4.5 documented to take shortcuts when it _believes_ it's near context exhaustion — even when it isn't. The model sees the cue and switches into "ship something now" mode.

**Instead**: Don't expose the agent to its own context-pressure signal unless eagerness-to-finish is what you want. Use structured effort/task-budget controls deliberately, not as generic "be quick" hints.

**Citation**: [Inkeep on Context Anxiety](https://inkeep.com/blog/context-anxiety) — documents Cognition's discovery.

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

**Why it matters**: It's not just mid-task replanning. Any pattern where the harness keeps adding to the prompt during execution is suspect. "Helpful" reminders, status nudges, mid-stream feedback — all degrade performance.

**Instead**: Take the spec as immutable. If something needs to change, halt and restart with the new spec.

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

### Same model for implement and verify

**What**: GPT-5.5 implements, GPT-5.5 verifies.

**Why it fails**: Self-preference bias. Judges are ~50% more likely to pass output from their own family on objective rubrics, with worse skews on subjective rubrics.

**Instead**: Cross-family routing. Implementer through one provider, verifier through another. Cheapest single-action mitigation. Two-seed reviewers as fallback.

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

**Citation**: Claude Code hooks/settings docs; Pi extension docs warn that extensions run with full system permissions.

### No observability or replay

**What**: A run fails, but the only record is the final chat transcript.

**Why it fails**: Long-running harness bugs are phase/state bugs. Without tool-call traces, artifact versions, model versions, token usage, and state transitions, failures cannot be debugged or regression-tested.

**Instead**: Record phase-level traces, redacted tool arguments/results, state transitions, artifact hashes, and final structured reports. Keep golden traces for replay with side effects stubbed.

**Citation**: Datadog's observability-driven harness framing; this skill's `operations-safety.md` checklist.

### No idle-iteration kill switch

**What**: Pipeline loops until success or context exhaustion. No "if no file delta in N turns, abort" check.

**Why it fails**: Catches the "implementer wandered off into discussion" failure mode. Without a kill switch, the loop burns tokens producing reasoning without producing changes.

**Instead**: Idle-iteration counter. Abort if no file modification in N turns (3–5 typical). Pair with a diff budget for orthogonal coverage.

**Citation**: [Tests-First Agent Loop](https://medium.com/@Micheal-Lanham/stop-burning-tokens-the-tests-first-agent-loop-that-cuts-thrash-by-50-d66bd62a948e).

## Platform-specific gotchas

### Claude Code: hooks exit code 1 doesn't block

**What**: Hook returns exit code 1 expecting to block; orchestrator continues anyway.

**Why it fails**: Exit 1 is observability only. Exit 2 blocks.

**Citation**: [Hooks reference](https://docs.claude.com/en/docs/claude-code/hooks); [dev.to "5 Hook Mistakes"](https://dev.to/yurukusa/5-claude-code-hook-mistakes-that-silently-break-your-safety-net-58l3).

### Claude Code: settings.json silently broken on JSON syntax error

**What**: A trailing comma or stray quote in `settings.json` disables the entire file. Hooks don't fire. No warning.

**Instead**: Validate `settings.json` as part of CI. The `update-config` skill in this repo handles this.

**Citation**: [Claude Lab — Hooks Not Firing troubleshooting](https://claudelab.net/en/articles/claude-code/claude-code-hooks-not-firing-troubleshooting).

### Claude Code: subagent worktrees branch from `origin/main`

**What**: At the time of writing, issue reports say `isolation: worktree` subagents run against `origin/main`, not the parent's HEAD.

**Why it fails**: Workflows that assume the subagent inherits parent's branch state break.

**Citation**: [Issue #50850](https://github.com/anthropics/claude-code/issues/50850).

### Pi: ESM module exports can't be `mock.method`'d

**What**: Test does `mock.method(child_process, "spawn", stub)`; throws because ESM exports are non-configurable bindings.

**Instead**: Wrap in an exported holder: `export const _spawn = { fn: _nodeSpawn }`. Call through `_spawn.fn(...)`. Tests then `mock.method(_spawn, "fn", stub)`. Reference: `pi/agent/extensions/subagents/spawn.ts:19-22`.

**Citation**: This repo's `CLAUDE.md`.

### Pi: snake_case schemas vs camelCase fields

**What**: Tool schema exposed to the agent is snake_case (`failure_reason`); internal state field is camelCase (`failureReason`). Forgetting to map one to the other breaks validation.

**Instead**: Map in the tool's `execute` body. This is the in-repo convention.

**Citation**: This repo's `CLAUDE.md`.
