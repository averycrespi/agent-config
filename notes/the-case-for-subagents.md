# The Case for Subagents

Subagents are useful when a self-contained question benefits from parallelism, isolation of substantial intermediate context, or independent judgment. Those benefits must outweigh startup, handoff, and verification costs. File count, task category, and read-only status alone do not justify delegation.

## What I mean by subagent

A child invocation spawned by an owning agent to do scoped work and return an evidence-bearing result. Independent read-only questions can run in parallel. Implementation and fixes stay in the owning session by default; writable delegation is an explicitly requested exception, not a routine phase of coding.

## The main argument: context quality

Exploration notes, logs, and intermediate search results can bury the requirements and decisions the main agent needs. A child can process that material and return relevant findings with source references and uncertainties. The main agent retains synthesis and checks consequential claims against the evidence.

This is a potential quality benefit, not a promise of lower cost. Subagents add model work, and reconstructing missing context can erase the savings from a smaller summary. The [Voidwire implementation report](https://labs.voidwire.info/posts/the-real-cost-of-claude-code-subagents/) describes substantial token overhead; it is not a universal multiplier or proof that the trade improves implementation quality.

A fresh context can also help independent review. Using the same model as the implementer does not eliminate correlated blind spots, but independence does not require deliberately choosing a weaker model.

## How to delegate

Give each child one question or task, scope boundaries, relevant context and decisions, authoritative source paths, explicit capabilities and profile, an evidence-bearing deliverable with uncertainties, and a stop condition. Supply necessary context rather than the whole conversation. Use structured output when automation needs it; schema validity does not establish factual correctness.

Do not delegate a short lookup or deterministic check when doing it inline is cheaper. Avoid duplicating the child's investigation. Add separate review when required or justified by risk, rather than attaching a reviewer chain to every result. Keep repair and redispatch bounded.

## The steelman: implementation needs continuity

Cognition's [Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) identifies a real mechanism: actions carry implicit decisions that other agents may not see. Parallel writers can choose incompatible approaches. Sequential writers avoid simultaneous edits, but still lose information at handoffs.

A plan records intent, not every rejected alternative or constraint discovered during implementation. Summarizing that work can remove information the owner needs to verify or extend it. A lean parent context is not automatically a better-informed parent.

This supports preserving implementation ownership as the default. It does not prove that one sequential implementation child is always worse; the cited practitioner arguments do not directly establish that comparison under matched conditions. The claim that implementation is where subagents help most is likewise unsupported.

## The writable exception

Keep writable delegation available when explicitly requested by the user through an explicit execution workflow with bounded scope, one writer, orchestrator-owned state and evidence, a structured handoff, and independent verification. Never overlap parent or child writes in one checkout, and preserve stricter active workflow boundaries.

A bounded component with stable interfaces and explicit acceptance checks may justify that exception. A fresh implementer for every tightly coupled slice should not be the default. If a child needs steering, inspect the scope and handoff, but recognize that legitimate discoveries or requirement changes can also demand intervention.

Before claiming an advantage, compare owning-session implementation against one sequential child with the same model, effort, tools, starting revision, and acceptance checks. Use repeated trials and measure verified success, regressions, handoff omissions, parent rework, latency, and total usage. That experiment can follow adoption of the conservative default; it need not block it.

## References

- [Anthropic — Subagents in Claude Code](https://claude.com/blog/subagents-in-claude-code) — context isolation and scoped child work.
- [Cognition — Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) — practitioner argument about shared context and implicit decisions.
- [Voidwire Labs — The Real Cost of Claude Code Subagents](https://labs.voidwire.info/posts/the-real-cost-of-claude-code-subagents/) — implementation token-overhead report, not a general quality comparison.
- [`plan-execute-review.md`](./plan-execute-review.md) — phase boundaries without mandatory child handoffs.
