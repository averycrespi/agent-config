# Context engineering

Long pipelines lose information mid-run. The question is whether the harness controls _how_. Anthropic's [Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) names three load-bearing techniques: **compaction**, **structured note-taking**, **just-in-time retrieval**. OpenAI's [compaction guide](https://developers.openai.com/api/docs/guides/compaction) treats compaction as a first-class API surface. This document covers all three plus the practical issues that show up in production.

A useful directional signal from the Zylos and Harness vendor reports: **context drift / memory loss may drive more enterprise agent failures than raw context exhaustion.** ([Zylos](https://zylos.ai/research/2026-02-28-ai-agent-context-compression-strategies), [Harness](https://www.harness.io/blog/defeating-context-rot-mastering-the-flow-of-ai-sessions)). These are vendor reports, so treat them as production signals rather than controlled evidence. Bigger context windows make compaction _more_ important, not less.

## The three techniques

### 1. Compaction

Replace prior turns with a summary when the conversation grows large. Two flavors:

**Anthropic / Claude Code style**: automatic, opaque to the developer. The Claude Agent SDK loop compacts when nearing context limit. WaveSpeedAI's reverse-engineering identifies five stages: budget reduction → snip → microcompact → context collapse → auto-compact ([Claude Code Agent Harness: Architecture Breakdown](https://wavespeed.ai/blog/posts/claude-code-agent-harness-architecture/)).

**OpenAI Responses API style**: explicit. Two modes:

- **Threshold-driven**: `context_management.compact_threshold` triggers an opaque encrypted compaction item carrying state/reasoning. Chain via `previous_response_id` or by appending the item.
- **Explicit**: call [`/responses/compact`](https://developers.openai.com/api/reference/resources/responses/methods/compact) when _you_ decide. Best for harnesses that want compaction at phase boundaries (e.g. compact at end of `plan` before entering `implement`).

What compaction loses: low-salience details that the summarizer judges unimportant. What that means in practice: constraints embedded in early turns ("don't change the public API"), implementer decisions made several turns ago, and tool-call history (the _fact_ that you tried something and it failed).

**Mitigation**: use compaction in conjunction with structured note-taking — the constraints and decisions belong on disk, not in conversation history.

### 2. Structured note-taking

Write workflow context to known files, referenced _by path_ in subagent prompts. Pair these files with durable orchestrator state for phase, attempts, commits, and cleanup handles (see `operations-safety.md`). This is one of the highest-leverage under-used patterns.

Standard artifacts:

| File                | Contents                                                 | Lifetime                          |
| ------------------- | -------------------------------------------------------- | --------------------------------- |
| `ac.json`           | Acceptance criteria                                      | Whole run                         |
| `localization.json` | Ranked file list + entry points                          | Whole run                         |
| `PLAN.md`           | The plan                                                 | Whole run; revised by plan-repair |
| `DECISIONS.md`      | Implementer decisions worth carrying forward             | Appended during implement         |
| `OPEN_QUESTIONS.md` | Unresolved ambiguity                                     | Appended whenever encountered     |
| `KNOWN_ISSUES.md`   | Validator/reviewer findings that didn't block completion | Written at emit-report            |
| `PR_BODY.md`        | PR description (from plan + AC, not from diff)           | Written at emit-report            |

Why subagent prompts say "read `<workflowDir>/PLAN.md` for the plan" instead of inlining:

- **Token cost.** Inlining a 5K-token plan into N subagent prompts costs N×5K. Reading from disk costs ~50 tokens to mention the path.
- **Compaction-survivability.** A path is a 50-token constant; the plan body that the path resolves to is fresh on every read.
- **Forensic trail.** When something goes wrong, the human has the artifacts to reconstruct what the agent saw. Add phase traces and tool-call logs when the harness needs replay, not just explanation.
- **Cross-subagent consistency.** Every subagent reads the same artifact; no drift from copy-paste.

The Claude Agent SDK [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) is the SDK-blessed surface for this — `BetaAbstractMemoryTool` (Python) / `betaMemoryTool` (TS), client-side `/memories` directory you back with whatever store you want.

`pi-coordination`'s scout output is a worked example: ~85K-token "context document" plus ~15K-token "synthesized meta-prompt" — relevant context as data, generation guidance as instruction. Different files, different sizes, different lifetimes.

### 3. Just-in-time retrieval

Don't load all context up front. Load lightweight identifiers (file paths, function names, ticket IDs); resolve them on demand via tools.

Anthropic's framing: "agents carry lightweight identifiers and resolve them on demand."

Why this beats prefetched context:

- **Repos are bigger than context windows.** Even 1M context isn't enough for serious codebases.
- **The model knows what it needs.** Prefetching everything wastes tokens on irrelevant code.
- **Fresh reads beat cached state.** A file the agent read 20 turns ago may have been edited since.

The retrieval tools that matter:

- `Read` (with line offsets for large files).
- `Grep` / `Glob` for finding things.
- A symbol-graph walker (LSP-backed if you can wire it up).
- BM25 + dense embeddings for natural-language code search.

[Augment Code](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution)'s harness uses hybrid BM25 + dense embeddings + a code-graph layer for symbol dependencies. Live retrieval beats prefetched context.

## Long-horizon failure modes

[The Long-Horizon Task Mirage](https://arxiv.org/html/2604.11978v1) (April 2026) provides the cleanest taxonomy:

- **Process-level (72.5%)**: Environment Error, Instruction Error, **Planning Error (subplanning)**, **History Error Accumulation** — all four categories combined.
- **Design-level (27.5%)**: Catastrophic Forgetting (constraints erode despite remaining in context), Memory Limitation, False Assumption.

Caveats:

- The paper studies Web/OS/Embodied/DB, **NOT coding/SWE**. Treat the taxonomy as suggestive for coding agents, not validated.
- Mitigations in §5 of the paper (hierarchical subplanning, execution-time plan verification and repair, memory mechanisms preserving long-range constraints) are _proposed_, not measured.

For coding-specific evidence, see [Beyond pass@1: A Reliability Science Framework](https://arxiv.org/html/2603.29231v1) and [SlopCodeBench](https://arxiv.org/abs/2603.24755) — iterative coding tasks where no agent solves any problem end-to-end across 11 models.

The harness-relevant takeaways (caveat: high-leverage hypotheses, not measured-on-coding):

- **Catastrophic forgetting is real.** Constraints stated in turn 1 erode by turn 50 even when they remain in the context window. Re-state constraints at phase boundaries.
- **Subplan errors compound.** A small planning error in turn 5 leads to large execution drift by turn 50. Plan-repair gates are cheap insurance.
- **History error accumulation is process-level.** Each turn that builds on a flawed prior turn worsens the situation. Periodic compaction-with-state-preservation (NOT raw history) helps.

## Newer memory research

- [Memory for Autonomous LLM Agents](https://arxiv.org/html/2603.07670v1) — survey covering five mechanism families incl. context-resident compression, retrieval, hierarchical virtual context.
- [ByteRover: Agent-Native Memory Through LLM-Curated Hierarchical Context](https://arxiv.org/html/2604.01599) — production-flavored hierarchical memory.
- [GAM: Hierarchical Graph-based Agentic Memory](https://arxiv.org/html/2604.12285) — two-layer topic→episodic retrieval keeps inference tokens flat as memory grows.
- [Rethinking Memory Mechanisms of Foundation Agents in the Second Half](https://arxiv.org/html/2602.06052v3) — companion survey to Anthropic's posts.

These are useful when designing custom memory layers; for most harnesses, structured note-taking + durable phase state + the SDK's memory tool is enough.

## Practical pacing constraints

### Anthropic prompt cache TTL

[Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching): system prompt, tool defs, and CLAUDE.md are cached automatically. **5-minute ephemeral TTL** by default. Anything over ~270s between turns blows the cache.

Practical implications:

- Polling loops that sleep ≥5 min pay a cache miss every wake-up. Either drop to ≤270s (stay in cache) or commit to ≥1200s (one cache miss buys a much longer wait).
- The 1-hour cache is available for long-running loops — opt in via `cache_control: {ttl: "1h"}`.
- Thinking-config changes invalidate the _message_ cache (system stays cached). Pin thinking config across an agent loop.
- Place `cache_control: {type:"ephemeral"}` on the _last_ tool definition to cache all of them.

### OpenAI compaction frequency

The Responses API compaction is server-side and opaque (the compacted item is encrypted). Cost is cheap; do it at phase boundaries. The cost of _not_ compacting is real — long sessions hit the 272K-input pricing flip on GPT-5.5 (2x in / 1.5x out for the rest of the session).

### Tokenizer changes between model versions

Opus 4.7's tokenizer was ~1.0–1.35x more tokens than 4.6, and Opus 4.8 changed prompt-cache economics again. Recompute context budgets, `max_tokens`, cache thresholds, and compaction triggers on model upgrades. Same warning applies whenever a provider ships a new tokenizer or cache policy.

## Context anxiety

[Inkeep on Context Anxiety](https://inkeep.com/blog/context-anxiety) documented Cognition's finding that Sonnet 4.5 takes shortcuts when it _believes_ it's near context exhaustion — even when it isn't. The model sees "approaching limit" cues and switches into "ship something now" mode.

Implications:

- Don't expose the agent to its own context-pressure signal unless you've thought about it.
- Don't write "you have N turns remaining" into prompts unless you actually want eagerness-to-finish.
- Claude effort/task-budget style controls are explicit versions of this signal — use them intentionally, not as generic "be quick" hints.

## Compaction-aware prompt design

If your harness runs through compaction events (Claude Agent SDK loops or OpenAI Responses API loops with thresholds), prompt design changes:

- **Re-state constraints at phase boundaries.** "Reminder: do not modify the public API. AC are at <workflowDir>/ac.json."
- **Reference artifacts by path, not inline.** Compaction collapses inline content; paths survive.
- **Use GPT-5.2/5.4-style `<planning>` blocks** for ephemeral scratch work. Tokens are discardable during compaction.
- **Use Claude adaptive thinking deliberately.** Opus 4.8 supports adaptive thinking as the only thinking-on mode; thinking content is omitted by default, so opt into summarized display only when the harness actually needs it visible.

## Practical defaults

If you're starting a new harness:

1. **Always write structured artifacts and durable state.** `ac.json`, `PLAN.md`, `DECISIONS.md` minimum, plus phase/attempt/completion state outside the conversation. Subagent prompts reference artifacts by path.
2. **Compact at phase boundaries.** OpenAI: `/responses/compact`. Anthropic: rely on the Agent SDK's automatic compaction unless you have a specific reason not to.
3. **Pace polling loops to either ≤270s or ≥1200s.** Cache TTL drives cost.
4. **Re-state hard constraints at every phase entry.** Not paranoia — the [Long-Horizon Task Mirage](https://arxiv.org/html/2604.11978v1) catastrophic-forgetting evidence is real.
5. **Don't expose context-pressure signals to the agent** unless the eagerness-to-finish behavior is what you want.
6. **On model upgrades**, recompute context budgets and compaction triggers — tokenizers change.
