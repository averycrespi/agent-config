---
name: agent-engineering
description: Use when designing, building, debugging, or reviewing AI coding agent harnesses — single-agent shape (tools, prompts, context, hooks, model selection) or multi-phase workflows (orchestration, subagents, verifiers, ticket-to-PR pipelines). Covers model-specific guidance for GPT-6 Astra and GPT-5.6, and platform-specific patterns for Pi and Codex. Invoke when the user asks about harness design, scaffold patterns, agent loops, subagent orchestration, verification strategy, context compaction, plan/implement/verify pipelines, or how a particular model changes harness choices.
---

# Agent Engineering

This skill teaches the engineering discipline of _building_ AI coding agents — the harness, the workflow, the model choices — not the discipline of _using_ one. Most of the literature came together in 2025–2026 under names like "harness engineering," "context engineering," and "agentic workflow design." Model-specific guidance is scoped to GPT-5.6 and GPT-6 Astra. Platform guidance focuses on Pi and Codex, alongside model-independent research from multiple sources. For other platforms and models, use these principles but re-check their primary docs. This is the distilled core; deep references live in `references/`.

## Mental model

```
agent = model + harness
harness = (what the model sees)  +  (what it can do)  +  (the loop around it)
```

There are two design scopes, and they interleave:

- **Single-agent harness.** One model, one loop. Decisions: tool surface, context strategy, system prompt, hooks, model+effort selection, retry behavior. Examples: Pi's main loop, Codex CLI, a one-shot SDK script.
- **Workflow.** Multi-phase orchestration where deterministic code drives a sequence of LLM calls (often as fresh subagents). Decisions: phase boundaries, what crosses each boundary, verification shape, termination. Examples: `roach-pi`'s `agentic-harness`, OpenAI's internal Codex pipeline.

A workflow is built out of harnesses. So the harness-level principles always apply; workflow-level principles add to them.

## Consensus principles

Fourteen principles that show up repeatedly across 2025–2026 literature, vendor writeups, and open-source harnesses. Sources and caveats live in `references/bibliography.md`; evidence strength varies from primary docs to production anecdotes, so treat version-specific claims as revalidation targets.

1. **Keep a deterministic outer control plane.** Cognition's [Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) argues for coherent control rather than loosely coordinated agents. GPT-5.6's [Multi-agent beta](https://developers.openai.com/api/docs/guides/tools-multi-agent) makes bounded model-managed delegation useful inside a phase, but code should still own permissions, budgets, validation, durable state, and termination.

2. **Delegate for a clear benefit.** Use subagents for self-contained questions when parallelism, isolation of substantial intermediate context, or independent judgment outweighs startup, handoff, and verification costs. Keep implementation and fixes in the owning session by default. Permit writable delegation only when explicitly requested by the user through an explicit execution workflow with bounded scope, one writer, orchestrator-owned state and evidence, a structured handoff, and independent verification. Never overlap parent or child writes in one checkout; retain stricter active workflow boundaries. GPT-5.6 permits broader delegation but warns against ordered chains and shared mutable resources. ([Anthropic on context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents); [GPT-5.6 Multi-agent](https://developers.openai.com/api/docs/guides/tools-multi-agent); [HumanLayer on context firewalls](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents))

3. **Validated machine-readable output, not free text.** JSON schemas (TypeBox / Pydantic / Zod) are preferred for phase boundaries when the API supports strict structured output. Parsed tagged outputs (`<status>done</status>`) are an acceptable fallback in CLI/Pi-style harnesses where JSON is brittle. Free-text completion markers like `<promise>COMPLETE</promise>` are fragile. Keep output schemas out of prompt prose when the API can enforce them. ([Using GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6))

4. **Tune reasoning per phase with evaluations.** Don't assume one reasoning effort fits every phase. Execution often benefits from lower effort, while planning, debugging, verification, and review may justify more. GPT-5.6 defaults to `medium`, adds `max`, and recommends preserving the previous model's effort as a migration baseline before testing one level lower. Its `pro` mode is independent of effort and should be enabled in the API, not prompted. Astra does not support `none`; use `low` as the initial replacement. ([Using GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6); [Using GPT-6 Astra](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra))

5. **Verify independently against evidence.** Use fresh read-only reviewer contexts, authoritative acceptance criteria, and concrete file/line or command evidence. Choose GPT-5.6 or Astra reviewers by task-level evaluations; a different model is optional diversity, not proof of independence. Same-family reviews retain correlated-error and self-preference risks. ([Self-Preference Bias in Rubric-Based Evaluation](https://arxiv.org/abs/2604.06996))

6. **Deterministic gates first, agentic rubrics second, multi-reviewer third.** Tests, types, lints, and builds catch the cheap failures for free. Agentic rubrics built from the ticket+repo at runtime catch what tests miss. Multi-reviewer with diverse lenses catches what rubrics miss. Skipping the cheap layer to argue with an LLM is a tax. ([Agentic Rubrics as Contextual Verifiers](https://arxiv.org/pdf/2601.04171))

7. **Acceptance criteria are the load-bearing artifact.** Every production ticket-to-PR pipeline (Bitmovin, Kinde, the 70-Jira-tickets writeup, OpenAI's internal Codex pipeline) extracts AC up front and threads them through _every_ downstream phase as the canonical rubric. Plans reference AC; implementer reads AC; verifier scores against AC. Without this, "done" is a vibe.

8. **Plan = intent, not diff.** The plan describes _what_ and _why_; the implementer decides _how_. Hard-coded line-by-line diffs in the plan rob the implementer of the local context that makes the diff right. This appears verbatim across `roach-pi`, `ralph-meets-rex`, `agent-pi`.

9. **Sticky completion + bounded fix loops.** Allow a small, explicit number of verifier-driven fix rounds when the workflow has a `fix` phase. After the cap, or once a task/phase reaches `done`, there is no automatic edge back to implementation: remaining findings become known issues. Explicitly user-authorized follow-ups and scoped policy exceptions should preserve history, adverse evidence, and consumed repairs. Additional repair allowance requires explicit additive authorization, never an automatic reset. Do not let a local terminal-state convention block otherwise authorized work; reconcile live identity, ownership, and applicable evidence first. Without this, models perpetually nitpick on style. The `pi-supervisor` "5-strike lenient mode" is a useful reference point.

10. **Compaction-aware design.** Long pipelines lose information mid-run; the question is whether you control how. Anthropic's [context engineering post](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) and OpenAI's [compaction guide](https://developers.openai.com/api/docs/guides/compaction) name the same three techniques: (a) compaction, (b) structured note-taking artifacts on disk, (c) just-in-time retrieval. Measure cache reuse and write costs rather than treating caching as free. (See `references/context-engineering.md`.)

11. **Evaluate workflow-specific progress guards.** Diff caps and idle-iteration limits are optional controls for unattended workflows with demonstrated scope drift or thrash, not universal requirements. Calibrate them against representative tasks; reading, diagnosis, and verification can make meaningful progress without file changes. Preserve configured execution limits and bounded repair even when these additional guards are unnecessary.

12. **Termination beats unbounded correctness loops.** No open-ended `verify → implement` loopback. Bounded fix phases are fine; after the cap, always emit a final report — pass, fail-with-known-issues, or canceled — and exit. The orchestrator's job is to terminate; the user's job is to decide what to do with a partial result.

13. **Safety and permissions are part of the harness, not prompt polish.** Least-privilege tools, sandboxing, approval gates, secret isolation, prompt-injection handling, and network/file-system boundaries must be enforced by code wherever possible. Instructions are advisory; permissions and hooks are control surfaces.

14. **Observe, replay, and resume.** Production harnesses need phase-level traces, token/cost accounting, tool latency, durable checkpoints, rollback/cleanup paths, and golden traces for regression testing. If a run fails and cannot be explained or resumed, the harness is not debuggable.

## Decision framework

When someone asks "should I use a subagent here?" — these are the questions that resolve it.

| Question                                                                                                             | If yes, lean toward...                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Would parallelism, substantial context isolation, or independent judgment clearly benefit a self-contained question? | Consider a subagent after accounting for startup, handoff, and verification costs.                                                                                                                         |
| Is delegation justified only by file count, task category, or read-only status?                                      | Keep it inline; these are not sufficient triggers.                                                                                                                                                         |
| Would parent or child writes overlap in the same checkout?                                                           | **Don't.** Keep one writer.                                                                                                                                                                                |
| Did the user explicitly request writable delegation under a compliant execution workflow?                            | One bounded writer with orchestrator-owned state and evidence, structured handoff, and independent verification; preserve stricter workflow boundaries. Otherwise implement and fix in the owning session. |
| Does the work require knowing what the user said earlier?                                                            | Main thread (subagents start cold)                                                                                                                                                                         |
| Can a deterministic check (test, type, lint, regex) replace the LLM?                                                 | Use the deterministic check                                                                                                                                                                                |
| Is the LLM call cheap and the orchestrator decision is hard?                                                         | Inline; use orchestrator code                                                                                                                                                                              |

Brief each child with one question or task, scope boundaries, relevant context and decisions, authoritative source paths, explicit capabilities and profile, an evidence-bearing deliverable with uncertainties, and a stop condition. Supply necessary context rather than the entire conversation. Use structured output when automation needs it. Retain synthesis in the parent and check consequential claims against evidence; schema validity is not factual verification.

Treat owning-session implementation as a continuity-preserving default, not proof that every sequential implementation child performs worse. Serialization removes simultaneous-write conflicts but not handoff loss. Compare the two architectures under matched model, effort, tools, starting revision, and acceptance checks before claiming an advantage.

Start workflow design with **plan → implement → verify → handoff**, preserving acceptance criteria, authority boundaries, required checks, and bounded repair. These are working activities, not mandatory separate agents or phase transitions.

Load [workflow patterns](references/workflow-patterns.md) when a demonstrated need calls for additional localization, plan repair, independent review, or orchestration stages. Evaluate each added stage against the cost of omitting it; an elaborate reference architecture is not a default execution checklist.

## Anti-patterns

Documented failure modes — short list. Full annotated catalog in `references/anti-patterns.md`.

- **Unstructured multi-agent debate / negotiation.** GPT-5.6's beta supports bounded coordinator-worker delegation, but open-ended agents arguing or negotiating without a fixed decomposition, budget, and synthesis contract remains fragile.
- **Parallel implementations of the same subtask + merge.** Hidden coupling kills it.
- **Uncontrolled mid-task replanning.** Keep acceptance criteria stable during execution; treat user-requested changes as explicit scope revisions with updated durable state. Astra's mid-turn steering can deliver corrections, but does not replace orchestrator-owned scope and evidence.
- **Generic LLM-as-judge without rubrics.** Prefer independent AC-grounded review with concrete evidence.
- **Free-text completion markers.** `<promise>COMPLETE</promise>` is fragile; validated machine-readable output is robust.
- **Unbounded verify → implement loopback.** Repeated review can keep finding new issues without converging. Use bounded fix rounds, then report known issues.
- **Massive context windows as a substitute for retrieval.** Two 2026 vendor reports argue that context drift causes more enterprise failures than raw context exhaustion ([Zylos](https://zylos.ai/research/2026-02-28-ai-agent-context-compression-strategies), [Harness](https://www.harness.io/blog/defeating-context-rot-mastering-the-flow-of-ai-sessions)). Big windows make compaction _more_ important, not less.
- **Self-improving agents that rewrite their own scaffold mid-run.** Cool research, not production-ready. ([Live-SWE-Agent](https://arxiv.org/pdf/2511.13646))
- **Uncalibrated context-pressure cues.** Evaluate whether turn/token warnings encourage premature completion. Keep hard budgets in the harness and preserve completion criteria across compaction.

## Model-specific cheat sheet

Quick orientation; deep guidance in `references/models.md`.

- **GPT-6 Astra**: define authorized follow-through, audit skills and `AGENTS.md` for conflicting instructions, specify delegation triggers, and bound verification to required checks and unresolved risks. Expect more clarification and detailed formatting unless prompted otherwise. Read the [Astra migration guidance](references/models.md#gpt-6-astra) before carrying over GPT-5.6 settings; tool calling requires Responses and `none` reasoning is unsupported.
- **GPT-5.6**: retain as an execution and migration baseline. For GPT-5.6, use Sol for flagship capability, Terra for a capability/cost balance, and Luna for efficient high-volume work.
- **Model-specific prompting advice changes quickly.** Read the current migration/prompting guide for the exact model version before reusing an older harness prompt.

Verification rule: **independent context and concrete evidence matter more than a model-name change.**

## Platform cheat sheet

Quick orientation; deep guidance in `references/platforms.md`.

- **Codex CLI**: use for OpenAI's coding harness, layered repository instructions, and documented subagent and automation patterns.
- **Pi (`@earendil-works/pi-coding-agent`)**: best when you want a smaller TypeScript extension surface and a lightweight base for custom harness experiments.

For exact platform behavior, current gotchas, and repo-specific conventions, read `references/platforms.md`.

## How to use this skill

1. **For broad orientation** ("how should I shape this harness?"): read this `SKILL.md` end-to-end. The principles section is the load-bearing part.
2. **For model-specific design questions** ("how does Astra change my GPT-5.6 prompt?"): read `references/models.md`.
3. **For platform-specific implementation** ("how do I wire up a Pi extension?"): read `references/platforms.md`.
4. **For workflow design** ("what phases should my pipeline have?"): read `references/workflow-patterns.md`.
5. **For verification design** ("how should my reviewer be structured?"): read `references/verification.md`.
6. **For context-budget problems** ("the agent is forgetting the constraints"): read `references/context-engineering.md`.
7. **For safety, tool contracts, observability, and resume/rollback**: read `references/operations-safety.md`.
8. **For debugging a misbehaving harness** ("the agent is doing weird things"): read `references/anti-patterns.md`.
9. **For finding the source for a claim**: read `references/bibliography.md`.

References cite primary sources where possible. When a claim has a known caveat (sample size, single anecdote, vendor self-report) the citation flags it. Trust but verify — material from before mid-2025 has often been superseded.

## Local context

The shipped subagent profiles are Luna/medium (`fast`), Sol/medium (`balanced`), and Astra/high (`strong`). Use fast for narrow lookups, extraction, and straightforward summaries; balanced for substantial bounded exploration and synthesis; strong for difficult analysis, ambiguous or consequential judgment, and demanding review. Treat this routing as policy rather than a demonstrated performance improvement; observe verified results, rework, latency, and total usage before tuning further.

In this repo, `pi/agent/extensions/goal/` is the live example of durable objective steering and conservative completion evidence, while `pi/agent/extensions/subagents/` provides profile-routed delegation with explicit read, write, shell, broker, and web capabilities. `work-ticket` keeps implementation in its owning session, with compact recovery checkpoints under `<git-common-dir>/pi-ticket-checkpoints/`, artifact references, and explicit authority. It reviews before publication and uses session-bound Loop polling for bounded CI monitoring/repair. The helper protects ownership and retained allowances, not delivery-state gates; scoped user exceptions preserve failed/incomplete evidence, and new delivery labels alone do not require duplicate review. Goal remains a separate general-purpose objective primitive; it is not the ticket workflow's scheduler.
