# Goal Completion Review Plan

## Goal

Add an optional, fail-closed completion-review gate to the Pi `goal` extension. When enabled, `goal_update(status: "complete")` should treat the agent's evidence as a provisional completion claim, run one independent read-only reviewer, and mark the goal complete only when no high-confidence blocker or important findings remain.

## Background / Repo Context

- `pi/agent/extensions/goal/index.ts` owns commands, lifecycle hooks, prompt injection, widget updates, compaction, persistence wiring, and auto-run continuation.
- `pi/agent/extensions/goal/state.ts` owns the branch-scoped goal and auto-run state machines. State transitions belong in the store, reads/listener notifications are cloned, and persisted snapshots are parsed defensively.
- `pi/agent/extensions/goal/tools.ts` currently validates evidence and completes the goal immediately. The review gate belongs on this synchronous tool path so findings return directly to the main agent without completing and reopening persisted state.
- Goal snapshots are restored from ordered `goal-state` custom entries and `goal_update` tool-result details. Review lifecycle data therefore needs to be part of the version-tolerant persisted state.
- `pi/agent/extensions/subagents/api.ts` exposes `loadAgents()` and `spawnSubagent()` for direct programmatic use. `SpawnInvocation` supports fresh sessions, explicit tools/extensions/model policy, structured output, a caller-provided abort signal, and the existing reviewer agent's environment restrictions.
- `pi/agent/agents/reviewer.md` defines the existing read-only `reviewer` agent and its model/thinking/tool policy. Its prose-only output contract needs a narrow compatibility rule for dispatches that require the `structured_output` tool.
- `pi/agent/extensions/workflows/runtime.ts` demonstrates caller-owned timeout composition around an abortable subagent. Goal review should follow that ownership boundary but wait for child teardown before applying a timeout result.
- The extension is designed for interactive and headless use. The gate must not depend on TUI-only APIs.

## Acceptance Criteria

- **AC-1 — Backward-compatible opt-in:** `reviewEnabled` defaults to `false`. With review disabled, `goal_update` retains its current immediate completion behavior and does not resolve or spawn a reviewer.
- **AC-2 — Independent provisional review:** With review enabled, an active goal's completion claim is persisted as reviewing, then exactly one fresh-context `reviewer` subagent receives the durable goal, latest submitted evidence, current working directory, and—on re-review—the previous blocking findings. The parent conversation is not inherited.
- **AC-3 — Safe reviewer policy:** The spawn forwards the resolved reviewer definition's tools, extensions, model, thinking level, environment, system prompt, and skill/template restrictions. Goal and evidence text are delimited as untrusted data, and no write-capable tools or automatic verification commands are added by this feature.
- **AC-4 — Validated gate decision:** Reviewer output uses the concrete structured contract in Design Decisions D2. Caller-side semantic validation rejects missing/extra fields, unsupported severities, non-integer or out-of-range confidence values, empty/oversized text, more than 10 findings, and oversized serialized content. Valid findings below confidence 80 are discarded; only `blocker` and `important` findings with confidence at least 80 block completion, while confidence-80+ suggestions remain reportable but non-blocking.
- **AC-5 — Passing completion:** A clean review or a review containing only non-blocking findings marks the same goal complete, preserves the submitted evidence and review outcome, stops auto-run with the normal completion reason, and reports any non-blocking suggestions without reopening the goal.
- **AC-6 — One bounded fix loop by default:** `reviewMaxFixRounds` defaults to `1` and accepts non-negative integers. The first blocking review keeps the goal active, persists concise findings and the claim evidence, and returns instructions to fix or refute findings with concrete evidence. A subsequent `goal_update` performs a full re-review of the goal plus prior findings. A value of `0` allows the initial review but no automatic fix round.
- **AC-7 — Exhaustion is fail-closed:** If blocking findings remain after the configured fix rounds, the goal becomes paused, auto-run stops with a review-specific exhaustion reason, and the final unresolved report remains available through goal state, `/goal-show`, compaction, and the tool result.
- **AC-8 — Reviewer failure is distinct and fail-closed:** Missing reviewer configuration, spawn failure, invalid/missing structured output, timeout, or parent cancellation never counts as a pass and never consumes a fix round. If the reviewed goal is still current, it becomes paused with a review-unavailable result and a review-specific auto-run stop reason; there is no automatic retry.
- **AC-9 — Bounded timeout with cleanup:** `reviewTimeoutSeconds` defaults to `600` and accepts positive integers. Timeout and parent cancellation compose into the signal passed to `spawnSubagent`; timers/listeners are always cleared, the child process is allowed to finish its existing termination cleanup, and a late result cannot mutate state.
- **AC-10 — Stale-result protection:** Every asynchronous review result is applied only if the current goal ID and persisted review-attempt token still match, the goal is still `active`, and its review substate is still `reviewing`. Pausing, replacing, clearing, resuming, approving, navigating away from, restoring/replacing state, or otherwise superseding the claim invalidates the pending attempt. Deferred results—including a same-ID result after pause or tree navigation—cannot complete or pause current state.
- **AC-11 — Durable, recoverable lifecycle:** Review status, attempt/fix-round counts, latest claim evidence, bounded findings, failure metadata, and override metadata survive valid branch restoration. Legacy snapshots without review data still parse. Restoring/replacing a snapshot whose review status is `reviewing` atomically normalizes the goal to paused/review-unavailable and changes any running auto-run to stopped with `review_unavailable`; it never silently respawns, treats the review as passed, or leaves a paused goal with running auto-run.
- **AC-12 — Explicit resume:** `/goal-resume` resets the bounded review cycle and stale actionable review state before making the goal active. It preserves the existing behavior of not starting auto-run; users may continue manually or use `/goal-renew`.
- **AC-13 — Human-only override:** `/goal-approve <reason>` is available only when review paused the goal because of exhaustion or reviewer unavailability. It requires a non-empty bounded reason, marks the goal complete using the latest submitted claim evidence, preserves the unresolved report/error, records that completion was human-approved, and has no equivalent agent tool.
- **AC-14 — Visible without noisy output:** The widget gives a compact reviewing/fix-required/review-paused indicator, while `/goal`, `/goal-show`, tool results, and compaction provide enough bounded detail for the main agent and user to understand the next action. Full findings do not overflow the fixed-size widget.
- **AC-15 — Configuration and documentation:** `/goal-config`, the goal README's unified config table/example, logging documentation, extension design documentation, `pi/README.md`, and the root capability overview accurately describe opt-in review behavior, environment overrides, bounds, failure policy, retained subagent diagnostics, resume semantics, and `/goal-approve`.
- **AC-16 — Regression safety:** Focused tests cover review state transitions, snapshot parsing, reviewer orchestration, timeout/cancellation cleanup, stale results, tool outcomes, commands, compaction, rendering, and configuration. The repository typecheck, full test suite, lint, and formatting checks pass.

## Non-Goals / Out of Scope

- Multiple reviewers, reviewer fan-out, or invoking the seven-agent `review` skill.
- Automatic test, lint, build, browser, or other deterministic command execution.
- Adding a native timeout option or changing outcome semantics in the public subagents API.
- Automatic cross-family model selection or goal-specific reviewer model/thinking settings.
- Writable reviewer tools, automatic reviewer fixes, agent-controlled override, or unbounded review/fix loops.
- Project-global review state, background review after Pi exits, or automatic retry of reviewer failures.
- Counting child-reviewer tokens against the goal extension's existing observational usage counters.

## Constraints

- Keep review disabled by default to preserve existing cost, latency, and completion semantics.
- Reuse the existing `reviewer` agent definition as the single source of model, thinking, tools, extensions, environment, and skill/template policy.
- Keep goal lifecycle status (`active`, `paused`, `complete`) separate from the completion-review substate.
- Centralize state transitions and cloning in `createGoalStore()`; command/tool handlers must not assemble snapshots ad hoc.
- Persist review transitions before and after the awaited child call when `appendEntry` is available, and return the complete state in tool-result `details`.
- Treat goal objectives, completion evidence, previous findings, and reviewer output as untrusted data. Do not let them override system/developer policy.
- Bound all reviewer-derived state before persistence. Prefer narrow fixed limits tied to the existing evidence/report constraints rather than adding speculative user settings.
- Use the public `pi/agent/extensions/subagents/api.ts` surface only; do not import subagent internals.
- Follow the repository's ESM-safe wrapper-export pattern for stubbing process/timer/loader dependencies in tests.
- Preserve headless behavior and avoid dialogs or TUI-only control flow.

## Chosen Approach

Model completion review as a persisted substate attached to the current goal while retaining the existing three goal lifecycle statuses. `goal_update` validates evidence, creates a unique review-attempt token for the current goal, persists a `reviewing` claim, and synchronously calls a dedicated goal review runner. The runner resolves the existing `reviewer` agent, builds a fresh untrusted-data-delimited prompt, requests structured findings, and composes the parent cancellation signal with a goal-local timeout.

The goal extension—not the reviewer—derives the gate decision from validated severity and confidence. Passing results complete the matching goal. A blocking result either leaves the goal active for the next bounded fix attempt or pauses it when the fix budget is exhausted. Infrastructure or contract failures pause the matching goal as review unavailable. Before applying any result, the store verifies both goal ID and attempt token so stale async work cannot mutate replacement or navigated state.

This synchronous design is preferred over a `turn_end`/follow-up loop because the reviewer result naturally becomes the `goal_update` tool result, existing auto-run behavior can continue an active goal, and the extension never has to reopen a completed snapshot.

## Design Decisions

- **D1 — One reviewer:** Use one purpose-built completion audit prompt with the existing `reviewer` agent. The generic seven-lens review skill is too expensive and cannot be nested through the current public depth policy.
- **D2 — Structured findings, harness-owned verdict:** Request an object with exactly `summary` and `findings`; do not request or trust a model verdict. `summary` is a trimmed non-empty string of at most 1,000 characters. `findings` is an array of at most 10 objects with no extra properties: required `severity` (`blocker | important | suggestion`), `confidence` (integer `0..100`), `description` (trimmed non-empty, at most 800 characters), and `evidence` (trimmed non-empty, at most 500 characters); optional `location` (at most 200 characters) and `suggested_fix` (at most 500 characters). Apply an additional 20,000-character cap to the serialized validated output before persistence. The TypeBox/plain JSON schema enforces required fields, types, enums, and `additionalProperties: false`; goal code explicitly enforces integer/range, array, string, and serialized-size limits unsupported by the shared validator. Contract violations are review-unavailable failures, not substantive findings. After validation, discard findings below confidence 80 and derive the gate decision from the remaining severities.
- **D3 — Blocking policy:** Only confidence-80+ `blocker` and `important` findings consume review/fix flow. Suggestions remain visible but cannot prevent completion.
- **D4 — Fix-round semantics:** `reviewMaxFixRounds = 1` means initial review, one opportunity to fix/refute, and one final re-review. Reviewer invocation count is therefore at most `maxFixRounds + 1` per cycle.
- **D5 — Failure and exhaustion pause:** The gate never silently fails open. Review failures do not consume fix rounds; unresolved substantive findings do.
- **D6 — Timeout ownership:** Keep the 600-second deadline in goal review policy. Abort the child through the public signal contract, wait for child settlement/cleanup, then classify timeout separately from user cancellation.
- **D7 — Human authority:** `/goal-approve` is a user command restricted to review-paused goals. The agent cannot waive its own completion gate.
- **D8 — Fresh context:** Do not fork the parent session. The durable goal is the canonical requirement source; the reviewer independently reads goal- or evidence-referenced repository artifacts with its existing read-only tools.

## Implementation Notes

### Review state and store transitions

- Extend `pi/agent/extensions/goal/state.ts` with a version-tolerant completion-review substate. It should represent at least reviewing, fix-required, passed, exhausted, unavailable, and overridden outcomes, along with the current attempt token, review/fix counters, latest claim evidence, bounded findings/summary, failure classification, timestamps, and override reason.
- Add store methods that atomically begin a review claim, apply a validated pass/block/failure only to a matching goal ID and token whose goal is still active and review is still `reviewing`, reset a review cycle during resume, and human-approve an eligible paused review. Store methods should return an explicit stale/mismatch result rather than mutating current state.
- Make every superseding transition invalidate a running attempt. In particular, manual pause must leave the goal paused and make the attempt inapplicable; set/clear/resume/approve remove or replace the token; state replacement/tree navigation normalizes persisted `reviewing` state instead of preserving a live token.
- Add review-specific auto-run stop reasons for exhaustion and unavailable review so output can distinguish them from an ordinary user pause.
- Extend cloning, formatting, and `parsePersistedGoalState()` without breaking legacy snapshots. Invalid review data should not corrupt otherwise valid older state. During `replaceState`/restoration, atomically normalize persisted `reviewing` to paused/unavailable and normalize a paired running auto-run to stopped with `review_unavailable`.

### Reviewer orchestration

- Add a focused module such as `pi/agent/extensions/goal/review.ts` with pure prompt/result validation helpers and a narrow orchestration function. Keep subagent spawning out of the store.
- Resolve `reviewer` through `loadAgents()` by constructing `new Map(agents.map((agent) => [agent.name, agent]))`, matching the subagents extension's last-filename-sorted-duplicate-wins behavior. Missing resolution follows the clarified unavailable/pause policy.
- Forward the resolved definition with the direct API's exact fields: `toolAllowlist: reviewer.tools`, `extensionAllowlist: reviewer.extensions`, `model`, `thinking`, `systemPrompt`, `env: reviewer.env`, `disableSkills`, and `disablePromptTemplates`. Also set `inheritSession: "none"`, the current tool context `cwd`, a unique review log ID, the composed signal, and the structured-output schema.
- Compose parent cancellation and `reviewTimeoutSeconds` with a local `AbortController`. Track which source fired, clear all resources in `finally`, and await the spawn outcome after abort so subprocess cleanup completes before state changes.
- Use `_shared/untrusted.ts` or equivalent established boundary helpers for the objective, evidence, and prior findings. Prompt the reviewer to inspect referenced artifacts, audit every explicit goal requirement, re-check previous blockers during later attempts, distinguish missing evidence from implementation defects, and avoid pre-existing or preference-only findings.
- Define structured finding fields sufficient for action: severity, integer confidence, concise description, concrete evidence/location when available, and optional remediation guidance. Derive blocking status in the caller; do not trust a model-provided verdict.
- Add an explicit structured-output exception to `pi/agent/agents/reviewer.md`: ordinary dispatches retain `FINDINGS`/`NO_FINDINGS`, while a dispatch requiring `structured_output` must follow its supplied schema as the final action. Do not otherwise broaden reviewer permissions or behavior.

### Tool, command, and lifecycle integration

- Refactor `registerGoalTools()` in `pi/agent/extensions/goal/tools.ts` to receive current review configuration and an injectable review runner. Expand `execute` to Pi's five-argument form—`(toolCallId, params, signal, onUpdate, ctx)`—using the third-argument `AbortSignal` for cancellation and fifth-argument `ExtensionContext.cwd` for the reviewer workspace.
- Preserve the current immediate path before any reviewer lookup when `reviewEnabled` is false.
- On the enabled path, persist the provisional state before awaiting review, apply only a matching result, persist the resulting state, and return concise action-oriented text plus the full state in `details`.
- Ensure first-round blocking output tells the agent to validate and fix reasonable findings or provide contrary evidence, then call `goal_update` again. Do not instruct it to fix suggestions blindly.
- Add `/goal-approve <reason>` in `pi/agent/extensions/goal/index.ts`, validate eligibility/reason, persist once, and update the widget. Keep it command-only.
- Update `/goal-resume` to reset the review cycle through the store while preserving its no-auto-run behavior.
- Include actionable review state in active-goal prompt steering and compaction so a compacted main agent knows why completion was rejected and what must be revalidated.
- If a goal changes while review runs, return a clear stale-review result without mutating the new/current goal.

### Configuration, rendering, and docs

- Add `reviewEnabled: false`, `reviewMaxFixRounds: 1`, and `reviewTimeoutSeconds: 600` to `pi/agent/extensions/goal/config.ts` with `GOAL_REVIEW_ENABLED`, `GOAL_REVIEW_MAX_FIX_ROUNDS`, and `GOAL_REVIEW_TIMEOUT_SECONDS` overrides. Add non-negative integer parsing for fix rounds while retaining positive-integer validation for timeout. Mirror all three fields in `index.ts`'s separately typed `DEFAULT_RUNTIME_CONFIG` so pre-`session_start` tool registration and config getters remain complete.
- Extend goal output and `pi/agent/extensions/goal/render.ts` with compact review phase/round information. Keep full evidence and findings in `/goal-show` and tool output, not the fixed widget.
- Update `pi/agent/extensions/goal/README.md` for command/tool behavior, configuration table and JSON example, state/restoration, compaction, headless behavior, troubleshooting, and logging. Note that successful child logs follow normal subagent cleanup while failed/aborted review diagnostics may be retained by the subagents extension.
- Update `pi/agent/extensions/goal/DESIGN.md` with the review state machine, synchronous lifecycle, stale-result invariant, security boundary, and change guidance.
- Update the `goal` capability descriptions in `pi/README.md` and the root `README.md` because reviewed completion changes the repository's top-level workflow capability.

### Tests

- Add focused tests beside the new review module for reviewer resolution/policy forwarding, fresh-session invocation, prompt boundaries, structured semantic validation, blocker classification, timeout versus parent abort, timer/listener cleanup, and malformed outcomes. Use exported wrapper holders for ESM mocks.
- Expand `state.test.ts` for every review transition, round accounting (including zero), stale token/goal rejection, pause-while-reviewing invalidation, same-ID replacement/tree restoration invalidation, resume reset, approval eligibility/audit data, atomic reviewing-plus-running restoration normalization, legacy snapshots, invalid nested data, cloning, and review-specific auto-run reasons.
- Expand `tools.test.ts` for disabled compatibility, pass, suggestions-only pass, first blocking result, final blocking pause, re-review context, unavailable reviewer, spawn/structured failure, cancellation, timeout, stale result, persistence ordering, and complete-goal idempotence.
- Expand `index.test.ts` for `/goal-approve`, invalid command states/reasons, resume reset, prompt/compaction content, restoration, widget notifications, and auto-run behavior after fix-required versus paused outcomes.
- Expand config and render tests for defaults, settings/env precedence, invalid values, compact labels, and width bounds.
- Keep process-spawning tests deterministic by injecting/stubbing the review runner; do not require live model credentials.

## Documentation Impact

Update:

- `pi/agent/extensions/goal/README.md`
- `pi/agent/extensions/goal/DESIGN.md`
- `pi/README.md`
- `README.md`
- `pi/agent/agents/reviewer.md` for structured-output compatibility

No new standalone documentation file or public extension API document is needed. The goal review runner remains internal to the extension, and the subagents public API does not change.

## Testing / Verification

- **V1 (AC-1, AC-6, AC-9, AC-15):** Run focused config tests and verify defaults/environment parsing, including zero fix rounds and the 600-second timeout.
  - `npx tsx --test pi/agent/extensions/goal/config.test.ts`
- **V2 (AC-4, AC-8, AC-9):** Run the new review module tests; expect structured validation, classification, timeout, cancellation, and cleanup cases to pass without spawning a real model.
  - `npx tsx --test pi/agent/extensions/goal/review.test.ts`
- **V3 (AC-5 through AC-13):** Run state and tool tests; expect all pass/block/re-review/exhaustion/failure/stale/resume/approve paths and legacy restoration to pass.
  - `npx tsx --test pi/agent/extensions/goal/state.test.ts pi/agent/extensions/goal/tools.test.ts`
- **V4 (AC-2, AC-7, AC-12, AC-14):** Run index and render tests; expect command registration, prompt/compaction, persistence restoration, auto-run stop behavior, and compact UI output to pass.
  - `npx tsx --test pi/agent/extensions/goal/index.test.ts pi/agent/extensions/goal/render.test.ts`
- **V5 (AC-16):** Run mandatory repository checks after focused tests.
  - `make typecheck`
  - `make test`
  - `npm run lint`
  - `npm run format:check`
- **V6 (AC-15):** Inspect the final diff to confirm every user-facing config field has its documented environment override, JSON example, command semantics, logging behavior, and top-level capability text; confirm no private or environment-specific data was introduced.
- **V7 (all ACs):** Audit completion evidence against each numbered AC, citing focused test names/results and changed documentation paths rather than relying only on the aggregate test suite.

## Risks and Mitigations

- **Stale async mutation:** The user can pause, replace, resume, or navigate away from a goal while review is pending. Require goal ID plus attempt-token plus `active/reviewing` compare-and-apply, invalidate on every superseding transition, and normalize restored running attempts so even same-ID deferred results are harmless.
- **Crash during review:** A persisted `reviewing` snapshot can outlive its child process. Normalize it to paused/unavailable on restoration and require explicit resume.
- **Reviewer prompt/output conflict:** The current agent says to emit exact prose while structured spawning requires a final tool call. Add a narrow documented exception and test the generated invocation/contract.
- **Schema overconfidence:** The subagent validator does not enforce every JSON Schema keyword. Perform explicit semantic and bounds validation before using or persisting reviewer data.
- **False positives and churn:** Use the fixed confidence/severity gate, one default fix round, full re-review, fail-closed pause, and human-only approval with an audit reason.
- **Unbounded state/session growth:** Bound finding count and text fields, persist only the current cycle/report needed for audit and continuation, and keep widget output summarized.
- **Timeout races and leaked subprocesses:** Abort through the existing spawn signal, wait for settlement, remove parent listeners, clear timers, and ignore late/mismatched results.
- **Fresh-context blind spots:** Make the durable goal and evidence self-contained, provide prior findings on re-review, and direct the reviewer to inspect goal/evidence-referenced artifacts. Do not claim it reviewed unavailable conversation-only requirements.
- **Security regression:** Reuse the reviewer definition's read-only tool and broker environment, disable session inheritance, delimit untrusted content, and keep approval unavailable to the agent.
- **Documentation drift:** Update README configuration, logging, command, state, and limitation sections in the same change and enforce format checks.

## Assumptions

- The installed Pi tool execution context continues to expose `cwd` and an abort signal, as documented and used by existing extensions.
- The existing `reviewer` definition remains present in the configured agent directory; absence is a supported review-unavailable outcome rather than a startup failure.
- The current subagent public API remains stable for `loadAgents()`, `spawnSubagent()`, and structured output while this work is implemented.
- Reviewer child usage remains outside existing goal usage counters in v1; this is documented rather than silently treated as included.

## Handoff Summary

Implement this plan as a focused extension enhancement. Start with tests for the persisted review state machine and pure structured-result validation, then wire the synchronous `goal_update` gate, timeout/cancellation and stale-result protections, user commands/UI, and documentation. Preserve the disabled path exactly and do not expand into multi-reviewer orchestration, automatic commands, or subagent API changes.

Suggested autonomous objective:

```text
/goal Implement .plans/2026-07-09-goal-completion-review.md. Complete only after every acceptance criterion is satisfied with concrete evidence from focused tests, make typecheck, make test, lint, format checking, and the final documentation/config audit.
```
