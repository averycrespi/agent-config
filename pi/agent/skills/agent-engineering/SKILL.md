---
name: agent-engineering
description: Use when designing, building, debugging, or reviewing AI coding agent harnesses — single-agent shape (tools, prompts, context, hooks, model selection) or multi-phase workflows (orchestration, subagents, verifiers, ticket-to-PR pipelines). Covers model-specific guidance for Claude 4.x and GPT-5.x families, and platform-specific patterns for Claude Code, the Claude Agent SDK, and Pi. Invoke when the user asks about harness design, scaffold patterns, agent loops, subagent orchestration, verification strategy, context compaction, plan/implement/verify pipelines, or how a particular model changes harness choices.
---

# Agent Engineering

This skill teaches the engineering discipline of _building_ AI coding agents — the harness, the workflow, the model choices — not the discipline of _using_ one. Most of the literature came together in 2025–2026 under names like "harness engineering," "context engineering," and "agentic workflow design." This skill is intentionally optimized for Claude/OpenAI/Pi coding harnesses because those are the platforms covered by the repo and references; for Gemini, Copilot/Cursor/Windsurf, SWE-agent variants, or local models, use these principles but re-check the platform's primary docs. This is the distilled core; deep references live in `references/`.

## Mental model

```
agent = model + harness
harness = (what the model sees)  +  (what it can do)  +  (the loop around it)
```

There are two design scopes, and they interleave:

- **Single-agent harness.** One model, one loop. Decisions: tool surface, context strategy, system prompt, hooks, model+effort selection, retry behavior. Examples: Claude Code's main loop, Codex CLI, a one-shot SDK script.
- **Workflow.** Multi-phase orchestration where deterministic code drives a sequence of LLM calls (often as fresh subagents). Decisions: phase boundaries, what crosses each boundary, verification shape, termination. Examples: `roach-pi`'s `agentic-harness`, OpenAI's internal Codex pipeline.

A workflow is built out of harnesses. So the harness-level principles always apply; workflow-level principles add to them.

## Consensus principles

Fourteen principles that show up repeatedly across 2025–2026 literature, vendor writeups, and open-source harnesses. Sources and caveats live in `references/bibliography.md`; evidence strength varies from primary docs to production anecdotes, so treat version-specific claims as revalidation targets.

1. **Code orchestrator, not LLM orchestrator.** A Claude Code retrospective estimated that ~98.4% of Claude Code is deterministic infra. Cognition's [Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) formalized the same lesson. LLM-as-router is fragile; deterministic code holding context and dispatching subagents is robust.

2. **Subagents are read-mostly context firewalls.** Use them for exploration, retrieval, review, verification — read-only fan-out. Avoid parallel writes to the same code. Claude Code's official guidance is to use subagents to _answer questions, not write code_. ([Anthropic on context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents); [HumanLayer on context firewalls](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents))

3. **Validated machine-readable output, not free text.** JSON schemas (TypeBox / Pydantic / Zod) are preferred for phase boundaries when the API supports strict structured output. Parsed tagged outputs (`<status>done</status>`) are an acceptable fallback in CLI/Pi-style harnesses where JSON is brittle. Free-text completion markers like `<promise>COMPLETE</promise>` are fragile. GPT-5.5 explicitly recommends moving output schemas out of prompt prose into the Structured Outputs API. ([GPT-5.5 Prompt Guidance](https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5.5))

4. **Per-phase reasoning effort.** Don't set `reasoning_effort` (OpenAI) or effort/thinking configuration (Claude) globally. Execution-heavy phases want low/minimal; planning, verification, and review want medium/high. GPT-5.5 ships with `medium` default; Claude Opus 4.8 ships with `high` default and adaptive thinking as the only thinking-on mode. ([What's new in Claude Opus 4.8](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-8))

5. **Cross-family verification beats same-model verification.** Self-preference bias is the most damaging of the four canonical judge biases (position, verbosity, self-preference, authority); judges are ~50% more likely to pass output from their own family on objective rubrics. Route implementer through one family, reviewer through another. ([Self-Preference Bias in Rubric-Based Evaluation](https://arxiv.org/abs/2604.06996))

6. **Deterministic gates first, agentic rubrics second, multi-reviewer third.** Tests, types, lints, and builds catch the cheap failures for free. Agentic rubrics built from the ticket+repo at runtime catch what tests miss. Multi-reviewer with diverse lenses catches what rubrics miss. Skipping the cheap layer to argue with an LLM is a tax. ([Agentic Rubrics as Contextual Verifiers](https://arxiv.org/pdf/2601.04171))

7. **Acceptance criteria are the load-bearing artifact.** Every production ticket-to-PR pipeline (Bitmovin, Kinde, the 70-Jira-tickets writeup, OpenAI's internal Codex pipeline) extracts AC up front and threads them through _every_ downstream phase as the canonical rubric. Plans reference AC; implementer reads AC; verifier scores against AC. Without this, "done" is a vibe.

8. **Plan = intent, not diff.** The plan describes _what_ and _why_; the implementer decides _how_. Hard-coded line-by-line diffs in the plan rob the implementer of the local context that makes the diff right. This appears verbatim across `roach-pi`, `ralph-meets-rex`, `agent-pi`.

9. **Sticky completion + bounded fix loops.** Allow a small, explicit number of verifier-driven fix rounds when the workflow has a `fix` phase. After the cap, or once a task/phase reaches `done`, there is no edge back to implementation: remaining findings become known issues. Without this, models perpetually nitpick on style. The `pi-supervisor` "5-strike lenient mode" is a useful reference point.

10. **Compaction-aware design.** Long pipelines lose information mid-run; the question is whether you control how. Anthropic's [context engineering post](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) and OpenAI's [compaction guide](https://developers.openai.com/api/docs/guides/compaction) name the same three techniques: (a) compaction, (b) structured note-taking artifacts on disk, (c) just-in-time retrieval. The 5-min Anthropic prompt-cache TTL is a hard pacing constraint. (See `references/context-engineering.md`.)

11. **Diff budgets and idle-iteration kill switches.** Mechanical brakes catch the "implementer wandered off" failure mode before fix-loops kick in. Hard cap on per-task diff size; abort if no file delta in N iterations. Cheap and load-bearing.

12. **Termination beats unbounded correctness loops.** No open-ended `verify → implement` loopback. Bounded fix phases are fine; after the cap, always emit a final report — pass, fail-with-known-issues, or canceled — and exit. The orchestrator's job is to terminate; the user's job is to decide what to do with a partial result.

13. **Safety and permissions are part of the harness, not prompt polish.** Least-privilege tools, sandboxing, approval gates, secret isolation, prompt-injection handling, and network/file-system boundaries must be enforced by code wherever possible. Instructions are advisory; permissions and hooks are control surfaces.

14. **Observe, replay, and resume.** Production harnesses need phase-level traces, token/cost accounting, tool latency, durable checkpoints, rollback/cleanup paths, and golden traces for regression testing. If a run fails and cannot be explained or resumed, the harness is not debuggable.

## Decision framework

When someone asks "should I use a subagent here?" — these are the questions that resolve it.

| Question                                                              | If yes, lean toward...                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is the work read-only (search, Q&A, review)?                          | Subagent (context firewall, parallelizable)                                                                                                                                            |
| Will this output be verbose (>2K tokens) and you only need a summary? | Subagent (its raw output stays out of your context)                                                                                                                                    |
| Are you spawning >2 parallel writes to overlapping files?             | **Don't.** Cognition principle 2 — actions carry implicit decisions; parallel writes fork micro-decisions that conflict at merge. Sequence them, or worktree-per-task with no overlap. |
| Does the work require knowing what the user said earlier?             | Main thread (subagents start cold)                                                                                                                                                     |
| Can a deterministic check (test, type, lint, regex) replace the LLM?  | Use the deterministic check                                                                                                                                                            |
| Is the LLM call cheap and the orchestrator decision is hard?          | Inline; use orchestrator code                                                                                                                                                          |

For workflow phase design, the canonical sequence (from the SOTA design doc and `references/workflow-patterns.md`) is:

```
extract-AC → localize → plan → plan-repair → implement → validate → review → fix → emit-report
```

Most production pipelines collapse some of these. Don't add a phase unless the cost of missing it is clear.

## Anti-patterns

Documented failure modes — short list. Full annotated catalog in `references/anti-patterns.md`.

- **Multi-agent debate / agent-to-agent negotiation.** Cognition called this in 2025; it does not appear in the mainstream production harnesses surveyed for this skill.
- **Parallel implementations of the same subtask + merge.** Hidden coupling kills it.
- **LLM-driven mid-task replanning.** Devin's data: "performs worse when you keep telling it more after it starts." Take the spec as immutable once implementation begins.
- **Generic LLM-as-judge without rubrics.** Beaten consistently by rubric-based + cross-family.
- **Free-text completion markers.** `<promise>COMPLETE</promise>` is fragile; validated machine-readable output is robust.
- **Unbounded verify → implement loopback.** The exact open-ended loop GPT-5/Claude-4-class models thrash in. Use bounded fix rounds, then report known issues.
- **Massive context windows as a substitute for retrieval.** Two 2026 vendor reports argue that context drift causes more enterprise failures than raw context exhaustion ([Zylos](https://zylos.ai/research/2026-02-28-ai-agent-context-compression-strategies), [Harness](https://www.harness.io/blog/defeating-context-rot-mastering-the-flow-of-ai-sessions)). Big windows make compaction _more_ important, not less.
- **Self-improving agents that rewrite their own scaffold mid-run.** Cool research, not production-ready. ([Live-SWE-Agent](https://arxiv.org/pdf/2511.13646))
- **Context anxiety.** Sonnet 4.5 documented to take shortcuts when it _believes_ it's near context exhaustion ([Inkeep on Context Anxiety](https://inkeep.com/blog/context-anxiety)). Don't expose the agent to its own context-pressure signal unless you've thought about it.

## Model-specific cheat sheet

Quick orientation; deep guidance in `references/models.md`.

- **Claude 4.x** is the better default when you want long-running, high-reasoning agent loops.
- **GPT-5.x / Codex** is the better default when you want strong execution, explicit structured outputs, and OpenAI's codex-style harness guidance.
- **Model-specific prompting advice changes quickly.** Read the current migration/prompting guide for the exact model version before reusing an older harness prompt.

Cross-family rule: **never use the same model for implement and verify if you can avoid it.**

## Platform cheat sheet

Quick orientation; deep guidance in `references/platforms.md`.

- **Claude Code**: best when you want an interactive coding harness with first-class hooks, skills, subagents, routines, and settings.
- **Claude Agent SDK**: best when you want the Claude Code loop but need to drive it programmatically in TypeScript or Python.
- **Pi (`@earendil-works/pi-coding-agent`)**: best when you want a smaller TypeScript extension surface and a lightweight base for custom harness experiments.

For exact platform behavior, current gotchas, and repo-specific conventions, read `references/platforms.md`.

## How to use this skill

1. **For broad orientation** ("how should I shape this harness?"): read this `SKILL.md` end-to-end. The principles section is the load-bearing part.
2. **For model-specific design questions** ("how does Opus 4.8 change my prompt?"): read `references/models.md`.
3. **For platform-specific implementation** ("how do I wire up a Claude Code hook?"): read `references/platforms.md`.
4. **For workflow design** ("what phases should my pipeline have?"): read `references/workflow-patterns.md`.
5. **For verification design** ("how should my reviewer be structured?"): read `references/verification.md`.
6. **For context-budget problems** ("the agent is forgetting the constraints"): read `references/context-engineering.md`.
7. **For safety, tool contracts, observability, and resume/rollback**: read `references/operations-safety.md`.
8. **For debugging a misbehaving harness** ("the agent is doing weird things"): read `references/anti-patterns.md`.
9. **For finding the source for a claim**: read `references/bibliography.md`.

References cite primary sources where possible. When a claim has a known caveat (sample size, single anecdote, vendor self-report) the citation flags it. Trust but verify — material from before mid-2025 has often been superseded.

## Local context

In this repo, `pi/agent/extensions/goal/` is the live example of durable objective steering and conservative completion evidence, and `pi/agent/extensions/subagents/` is the live example of read-only delegation.
