# Clarification Protocol

Resolve material ambiguity at the calling task's scale. Follow its authority boundary and output contract; clarification does not grant new authority.

## Establish and research

Identify the intended outcome, settled decisions, and remaining uncertainty from the request and available evidence. Investigate contradictions instead of silently choosing a source.

Research questions the repository, existing artifacts, or authoritative external sources can answer before asking the user. Delegate self-contained research questions when parallelism, isolation of substantial context, or independent judgment clearly outweighs startup and handoff costs; keep straightforward lookups inline. Use configured memory tools when prior decisions matter.

## Separate defaults from decisions

Choose reasonable, low-impact, reversible defaults consistent with the request, including user-visible wording or presentation choices. State assumptions when they help the user understand the result.

Ask when unresolved alternatives materially affect scope, correctness, acceptance criteria, security, data semantics, system boundaries, authorization, or risk tolerance. Do not hide those decisions as defaults. Leave routine implementation choices to execution and explicitly defer decisions owned by a downstream task.

## Ask focused questions

Ask one material question at a time, wait for the answer, and use it to choose the next question. Resolve upstream decisions first. Prefer `ask_user` with 2–5 options when trade-offs warrant a choice; put the recommendation first and explain it briefly.

Retain settled decisions and their rationale to avoid repeated questions. Do not require a taxonomy, formal ledger, or fixed response template for a simple clarification.

## Finish and continue

Stop questioning when the current task is actionable: material decisions are settled, routine defaults are reasonable, and any downstream deferrals are explicit. Summarize only useful decisions, assumptions, unresolved concerns, and the next action.

Resume already-authorized work without a new approval pause. Keep an explicitly requested standalone clarification session read-only. If the user stops or required evidence remains unavailable, report settled decisions and remaining blockers; never label an artifact Ready while blocking decisions remain.
