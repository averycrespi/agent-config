# Workflows Runtime Parity Plan

## Goal

Expand the Pi `workflows` extension with four coordinated capabilities inspired by Claude Code dynamic workflows: configurable bounded concurrency, a narrow `verify()`/`report()` verification API, host-enforced run token and logical-agent budgets, and fixed per-call model-tier aliases. Preserve the foreground, read-mostly, killable-worker architecture and backward compatibility for existing workflow scripts.

## Background / Repo Context

- `pi/agent/extensions/workflows/workflow-tool.ts` registers the foreground `workflow` tool, owns model-facing guidance, loads configuration and agent definitions, connects runtime snapshots to tool updates, and formats final output.
- `pi/agent/extensions/workflows/config.ts` merges defaults, global settings, project settings, and environment overrides through shared config helpers. `/workflows-config` is already registered in `index.ts`.
- `pi/agent/extensions/workflows/parser.ts` performs AST guardrail validation and currently requires a syntactic direct `agent()` call.
- `pi/agent/extensions/workflows/runtime.ts` is the host orchestrator. Its worker message handler is the privileged RPC boundary, and `createWorkflowAgentSpawner()` is the read-mostly agent/model policy boundary.
- `pi/agent/extensions/workflows/worker-source.ts` generates the killable worker module and exposes only deterministic workflow globals. Its bounded scheduler already clamps per-call `parallel()` concurrency against `workerData.maxConcurrency`, which is currently fixed at `DEFAULT_MAX_CONCURRENCY = 4`.
- Workflows import subagent functionality only through `pi/agent/extensions/subagents/api.ts`; that curated boundary must remain intact.
- Subagent activity tracking already derives token usage from child `message_end` events. This is the authoritative source available for run-token accounting; no provider-specific estimator or new privileged worker API is needed.
- Existing tests are colocated by concern (`config.test.ts`, `parser.test.ts`, `runtime.test.ts`, and `workflow-tool.test.ts`) and use real workers with injected spawn behavior plus exported ESM-safe wrapper holders where mocking is necessary.
- Current README and DESIGN documents explicitly list model tiers and a quality-helper standard library as non-goals. This work deliberately lifts those two boundaries only in the narrow forms described below. Foreground execution, read-mostly agents, no persistence, and no writable workflow coordination remain unchanged.
- The earlier research plan included journaled resume. This plan supersedes it for the current branch and intentionally excludes all journaling, run IDs, resume parameters, retained workflow scripts, and cached model responses.

## Acceptance Criteria

- **AC-1 — Configurable bounded concurrency:** `maxConcurrency` defaults to `4`, accepts positive integers from settings and `WORKFLOWS_MAX_CONCURRENCY`, and clamps values above `16` with a warning. Invalid settings fall back to the default with a warning; invalid environment values warn and do not override a valid lower-precedence setting.
- **AC-2 — Defensive runtime concurrency:** `runWorkflow()` passes the effective concurrency to worker data and independently normalizes direct-call values. Omitted, non-finite, fractional, zero, or negative direct values cannot produce an invalid scheduler limit; configured values can never exceed `16`.
- **AC-3 — Verification primitive:** `verify(claim, options?)` validates a non-empty claim, defaults to the `reviewer` agent, allows explicit `agent`, `intent`, `context`, `model`, `retries`, and `timeoutMs` overrides, requests a strict structured `{ confirmed: boolean, reasons: string[] }` verdict, and resolves `{ ok, reasons }`. A valid refutation resolves `{ ok: false, reasons }`; verifier execution or structured-output failure rejects as an ordinary agent failure.
- **AC-4 — Report gate:** `report(value, { gate })` invokes and awaits `gate(value)`. It returns the original value only when the gate returns `true` or an object with `ok === true`. Any other returned verdict rejects with code `workflow_report_rejected`; a plain-object verdict may supply `reasons`, which is normalized by retaining only string array members and exposed as exactly `{ reasons: string[] }` in error details and in the rejection message. Gate exceptions propagate unchanged rather than being converted into a verdict.
- **AC-5 — Parser and composition behavior:** A syntactic direct `verify()` call satisfies the required-spawn parser rule. A script with neither direct `agent()` nor direct `verify()` still fails validation, and `report()` alone does not satisfy the rule. Verification and report failures compose with existing `parallel()` and `parallelSettled()` semantics.
- **AC-6 — Run-budget defaults and config:** `maxTokensPerRun` defaults to `0` (unlimited) and `maxAgentsPerRun` defaults to `100`. Both accept non-negative integers from settings and corresponding `WORKFLOWS_MAX_TOKENS_PER_RUN` / `WORKFLOWS_MAX_AGENTS_PER_RUN` overrides; `0` disables that limit. Invalid settings or environment values follow the same warning and precedence behavior as AC-1.
- **AC-7 — Logical-call accounting:** The agent cap counts each policy-valid logical `agent()` request at most once. Retry attempts reuse that reservation and do not consume additional slots. Once the cap is reached, later calls fail with `workflow_run_cap_exceeded` without spawning and without aborting already admitted calls.
- **AC-8 — Retry-safe token accounting:** Token use is accumulated across every attempt of every logical call. Repeated cumulative activity updates for one attempt replace that attempt's prior total rather than double-counting, while a retry's usage is added under a distinct attempt identity and cannot overwrite earlier-attempt usage.
- **AC-9 — Token-budget enforcement:** Meeting or exceeding a positive token limit makes `workflow_budget_exceeded` sticky for new calls, aborts active subagents, and prevents retries or later spawns. Enforcement reacts to each streamed child event rather than waiting for activity rendering or process completion. The worker itself remains alive so scripts using `parallel()` or `parallelSettled()` can fan in partial successes and typed failures. Only attempts whose composed signal was first aborted by the tagged budget cause are labeled `workflow_budget_exceeded`; unrelated timeouts, parent cancellation, and other failures retain their original codes.
- **AC-10 — Independent budget conditions:** Reaching the logical-call cap does not suppress later token-budget enforcement for already active agents. A later token overage still aborts active work even if new calls were previously denied by the run cap.
- **AC-11 — Advisory immutable budget global:** Every worker exposes an immutable `budget` facade with `total`, `spent()`, `remaining()`, `launched`, and `maxAgents`. Unlimited token budgets appear as `total === null` and `remaining() === Infinity`. Snapshots may lag streamed usage, but scripts cannot replace or redefine the facade or its methods, and all authoritative checks remain host-side.
- **AC-12 — Fixed model-tier configuration:** `modelTierSmall` and `modelTierBig` default to empty strings and support `WORKFLOWS_MODEL_TIER_SMALL` and `WORKFLOWS_MODEL_TIER_BIG`. Values are trimmed full Pi model selectors stored only in host configuration; an empty value leaves that tier unconfigured.
- **AC-13 — Alias-only model routing:** `agent(prompt, { model: "small" | "big" })` and `verify(claim, { model: "small" | "big" })` send only the alias across worker RPC. The host treats the incoming field as untrusted string data until fixed-alias validation completes. A configured requested tier overrides the selected agent definition's model and the parent fallback. Omitting `model` preserves the current `agent.model ?? parentModel` behavior. Unknown strings such as `"medium"` and unconfigured fixed aliases fail that call with `agent_policy_rejected` and never silently fall back.
- **AC-14 — Safety and compatibility:** Existing scripts that do not use the new globals/options retain their current output, retry, timeout, structured-output, failure-accounting, and read-mostly policy behavior. The worker receives no filesystem, network, environment, raw model-selector, session-inheritance, or writable-agent capability.
- **AC-15 — User-facing guidance and configuration:** Tool descriptions and prompt guidelines accurately describe `verify`, `report`, `budget`, concurrency, budget failures, and model aliases. `/workflows-config` displays all seven effective fields, with model selectors treated as non-sensitive configuration unless repository conventions change.
- **AC-16 — Documentation coherence:** Workflows README/DESIGN and repository capability summaries accurately describe the four additions and retain journaling/resume, saved workflows, background execution, writable workflows, and worktree coordination as out of scope. No documentation claims concurrency is hardcoded or that model tiers and all quality helpers are absent.
- **AC-17 — Regression safety:** Focused tests and the full repository checks pass without live model credentials: `make typecheck`, `make test`, `npm run lint`, and `npm run format:check`.

## Non-Goals / Out of Scope

- Journaled resume, run persistence, run IDs, saved workflow scripts, response caching, or any new retained raw model output.
- Background execution, a `/workflows` navigator, or a workflow run database.
- Writable workflow agents, parallel implementation, git worktree isolation, or session inheritance.
- Arbitrary provider/model selectors in workflow scripts or a user-defined model-alias map.
- Cost/USD budgets, per-phase budgets, per-agent token allocations, token reservation or estimation, or generalized quota infrastructure.
- An open-ended quality-helper library. `verify()` and `report()` are the sole curated exception; voting, consensus, router, loop, and evaluator frameworks remain out of scope.
- Changes to the public subagents API, agent Markdown model declarations, or the direct `spawn_agents` concurrency pool.

## Constraints

- Preserve the separate killable worker and the host-owned `worker.on("message")` RPC boundary. Do not move privileged enforcement or model resolution into worker script code.
- Keep imports from subagents limited to `pi/agent/extensions/subagents/api.ts`.
- Use the existing activity tracker stream as the only token source. Treat its counts as actual observed usage, not a preflight estimate.
- Keep budget enforcement and model-tier resolution host-side even though advisory state and aliases are visible to scripts.
- Keep script globals deterministic and minimal. Freeze the `budget` facade and do not expose its mutable backing snapshot.
- Preserve bounded retry behavior (0–2) and make all budget/policy denials non-retryable.
- Follow shared configuration conventions: settings use camelCase, every field has an uppercase snake-case environment override, environment overrides settings when valid, and `/workflows-config` shows parsed effective values.
- Use exported holder objects when tests must stub ESM-bound worker or spawn functions.
- Do not add dependencies; the required ledger and worker helpers are small and native to the existing architecture.

## Chosen Approach

Add one pure host-side run ledger and thread it, concurrency, and model-tier policy through the extension's existing injectable runtime options. The ledger tracks accepted logical calls separately from cumulative tokens keyed by logical request and retry attempt. It publishes fresh snapshots to `runWorkflow()`, which pushes advisory budget updates to the worker and owns cancellation when the token threshold is crossed. The agent-count cap rejects only new logical calls; token exhaustion aborts active agents but deliberately does not terminate the worker, preserving script-level partial-failure handling.

Implement `verify()` and `report()` as worker standard-library functions. `verify()` composes the existing `agent()` RPC and structured-output path, so it adds no privileged message type. `report()` is entirely local and converts an explicit failed gate into a stable typed script error. Extend parser validation only enough to recognize direct `verify()` calls as spawning work.

Expose model selection as fixed `small` and `big` aliases. The worker validates and forwards an alias, while `createWorkflowAgentSpawner()` resolves it from host configuration after normal agent-type policy checks. This preserves the rule that workflow scripts never receive or choose raw provider/model IDs.

The four features ship together, but implementation should proceed in dependency order with focused tests at each seam: configuration/concurrency, verification helpers, ledger/accounting, runtime enforcement and budget mirror, then model tiers and documentation integration.

## Design Decisions

- **D1 — Concurrency policy:** Preserve default fan-out `4`, permit configuration up to a hard host-side ceiling of `16`, and warn when clamping. Runtime options are validated again because tests and future callers may bypass config normalization.
- **D2 — Narrow verification API:** `verify()` defaults to `reviewer` but permits an agent override and a fixed model-tier override. A refutation is valid data, not an exception. `report()` is the opt-in mechanism that turns a negative gate into `workflow_report_rejected`.
- **D3 — Parser rule:** Direct `agent()` and direct `verify()` calls satisfy the syntactic spawn requirement. Indirect aliases are not statically inferred, matching the existing guardrail's intentionally simple direct-call semantics.
- **D4 — Budget defaults:** Token limiting is opt-in (`0`) to avoid surprising existing workloads. A default cap of `100` accepted logical calls bounds runaway loops while remaining well above expected foreground Phase-1 fan-out.
- **D5 — Logical calls versus attempts:** Reserve the run slot once after agent-type/model-tier policy validation and before the first spawn. Retry attempts carry a distinct internal attempt identity for token accounting but reuse the same logical reservation.
- **D6 — Two independent limits:** Logical-call exhaustion rejects new work but never cancels admitted work. Token exhaustion is independently sticky, aborts admitted work, and takes precedence for subsequent calls. Do not model these as a single "first exceeded code wins" state because that could suppress a later token abort.
- **D7 — Partial recovery and cancellation cause:** Token exhaustion aborts a dedicated budget controller, not the controller that represents parent cancellation or whole-workflow timeout. Each attempt receives a composed signal that preserves the first abort reason, including a tagged `workflow_budget_exceeded` reason. The per-attempt timeout layer must propagate an upstream signal's reason instead of replacing it with a generic abort. This permits precise relabeling and lets `parallelSettled()` return partial results and budget errors without terminating the worker; the existing whole-workflow timeout continues to bound scripts that ignore failures.
- **D8 — Retry-safe usage:** Record the latest cumulative token total per `(requestId, attempt)` and sum all attempts. This matches activity-tracker semantics and prevents retries from overwriting earlier usage.
- **D9 — Advisory worker mirror:** Budget values are pushed asynchronously over the existing parent-to-worker message channel and exposed through a frozen facade. Scripts may optimize based on the mirror but cannot rely on it for enforcement or exact race-free decisions.
- **D10 — Alias precedence:** A configured requested tier wins over an agent definition's model, which otherwise wins over the parent model. Unknown and unconfigured aliases reject explicitly to avoid accidental cost or quality changes.

## Implementation Notes

### Configuration and runtime option threading

- Extend `pi/agent/extensions/workflows/config.ts` and `config.test.ts` with:
  - `maxConcurrency` / `WORKFLOWS_MAX_CONCURRENCY`, default `4`, ceiling `16`;
  - `maxTokensPerRun` / `WORKFLOWS_MAX_TOKENS_PER_RUN`, default `0`;
  - `maxAgentsPerRun` / `WORKFLOWS_MAX_AGENTS_PER_RUN`, default `100`;
  - `modelTierSmall` / `WORKFLOWS_MODEL_TIER_SMALL`, default empty;
  - `modelTierBig` / `WORKFLOWS_MODEL_TIER_BIG`, default empty.
- Keep positive-integer and non-negative-integer parsing distinct. Invalid environment values should be omitted from the environment layer rather than replacing valid project/global settings with defaults.
- Add concurrency ceiling/default constants and the necessary optional runtime/policy fields in `pi/agent/extensions/workflows/types.ts`. Keep internal state camelCase and fixed aliases represented by a narrow type or fixed record rather than a free-form script-facing map.
- Thread parsed config through `workflow-tool.ts` into `runWorkflow()` and `createWorkflowAgentSpawner()`. Existing `/workflows-config` registration should require no special-case output code; verify that all fields appear through the shared command helper.

### Verification helpers

- Extend `pi/agent/extensions/workflows/worker-source.ts` with a strict verifier output schema, `verify()`, and `report()`.
- `verify()` should build an adversarial, evidence-oriented prompt, serialize optional context safely, and call the existing `agent()` helper with structured output. Forward only the allowed agent, intent, fixed model alias, retries, and timeout fields.
- `report()` should accept only an options object containing a callable gate, invoke it as `await gate(value)`, and pass only for `true` or an object with `ok === true`. Every other returned value is a typed rejection. For a plain-object verdict, normalize `reasons` to the string members of an array (otherwise `[]`), attach exactly `{ reasons: string[] }`, and include those reasons in the message. If the gate itself throws or rejects, propagate that exception unchanged.
- Update `pi/agent/extensions/workflows/parser.ts` and `parser.test.ts` to recognize direct `verify()` alongside direct `agent()`. Keep `report()` non-spawning.
- Add `workflow_report_rejected` to the workflow error-code vocabulary without treating it as an agent retry class.
- Cover helper behavior end-to-end through a real worker in `runtime.test.ts`, including reviewer defaults, override forwarding, structured verdicts, verifier failures, negative report gates, async gates, thrown gates, and model-tier forwarding.
- Generated worker code is a TypeScript template literal. Preserve the existing concatenation/escaping pattern for worker-runtime interpolation such as option-validation error messages.

### Run ledger and budget enforcement

- Add `pi/agent/extensions/workflows/ledger.ts` and `ledger.test.ts` as pure host-side modules with no I/O. The public-to-workflows contract should expose only operations needed to:
  - reserve one policy-valid logical call;
  - record the latest cumulative token count for a `(requestId, attempt)` pair;
  - inspect independent token/call denial state;
  - return immutable fresh snapshots;
  - subscribe to state changes.
- Snapshot shape should support the worker contract: `total: number | null`, `used`, `launched`, and `maxAgents: number | null`. Disabled limits use `null` in the mirror even though settings use `0`.
- Make reservation and accounting synchronous so concurrent worker messages cannot oversubscribe the logical-call cap between awaits.
- Update retry dispatch in `runtime.ts` so each attempt has a stable internal attempt number. Retry attempts must not reserve another logical slot. Wrap every child `onEvent` call so it first feeds `tracker.handleEvent(event)` and then immediately records `tracker.state.totalTokens` under the correct `(requestId, attempt)` key; do not rely on the tracker's `onUpdate`, because `message_end` token changes do not emit that callback when workflow activity rendering is disabled. Record once more after tracker finalization as a defensive final capture.
- Place logical reservation after agent-type and model-tier policy validation but before the first process spawn. A policy-invalid call should remain `agent_policy_rejected` and should not consume a launch slot.
- Pass the same ledger instance to runtime orchestration and the policy spawner. `workflow-tool.ts` creates one ledger per tool execution; no ledger state survives the foreground call.
- Add `workflow_budget_exceeded` and `workflow_run_cap_exceeded` as non-retryable error codes. A run-cap denial posts a failed response only for that request. It must not abort the shared workflow signal.
- Give token enforcement a dedicated `AbortController`. Compose its signal with parent/workflow cancellation and per-attempt timeout while preserving the first source's tagged reason. On token threshold transition, abort the budget controller once, push an updated budget snapshot, and leave the worker running. Classify `workflow_budget_exceeded` only when the attempt's effective signal reason is the tagged budget reason; do not infer causality merely from the ledger currently being over budget, and do not relabel timeouts, parent cancellation, policy rejection, provider errors, or script errors.
- Ensure token exhaustion prevents retry attempts that would otherwise follow a retryable provider failure.
- Extend worker message handling with a parent-to-worker budget snapshot update. Expose a lexical `const budget = Object.freeze(...)` facade whose accessors read an inaccessible backing snapshot; do not expose the snapshot object itself.
- Test the call-cap and token-cap paths separately and together, including:
  - sequential and concurrent calls at the cap;
  - admitted in-flight work surviving a run-cap denial;
  - retries consuming one call slot but accumulating every attempt's tokens;
  - cumulative updates within one attempt not double-counting;
  - a streamed `message_end` crossing the token cap and aborting a still-blocked sibling before either attempt completes;
  - partial fan-in under `parallelSettled()`;
  - independent token enforcement after the call cap has already denied work;
  - immutable/advisory worker-global behavior;
  - no-ledger/direct-runtime defaults.

### Fixed model-tier aliases

- Extend worker `agent()` option validation and RPC payloads with `model`, accepting script input only as an alias string. `verify()` forwards the same field through its internal call.
- Keep the worker-RPC/request field as `model?: string` because it is untrusted input. Validate it host-side against a separate fixed `WorkflowModelTier = "small" | "big"` vocabulary before narrowing/resolving; never place configured raw selectors in worker data or worker messages.
- In `createWorkflowAgentSpawner()`, resolve only the two fixed aliases against the host-built tier table. Reject empty, unknown, or unconfigured requested aliases as `agent_policy_rejected` before reserving a logical launch.
- Preserve current model resolution when no alias is supplied. When configured, requested tier selector precedence is: requested tier, then agent definition model, then parent model.
- Do not modify `pi/agent/agents/*.md`, the subagents loader, the public subagents API, or direct `spawn_agents` model behavior.
- Add config and runtime tests for trimming/environment precedence, empty defaults, configured aliases, requested-tier precedence, explicit `model: "medium"` rejection without spawning or fallback, unconfigured fixed-alias rejection, omission compatibility, and `verify()` forwarding.

### Tool guidance, output, and integration

- Update `pi/agent/extensions/workflows/workflow-tool.ts` tool description and prompt guidelines with concise examples and failure semantics for verification, budgets, and model tiers. Avoid encouraging budget-dependent loops without noting that the mirror is advisory.
- Keep final result and failure counters backward compatible. Budget-denied or budget-aborted calls should appear in existing agent and branch failure accounting according to where scripts handle them; do not add speculative top-level result schemas.
- No new renderer state is required unless implementation evidence shows budget state is necessary for understanding an active run. Prefer keeping budget details in tool result/snapshot details over adding noisy TUI rows.

## Documentation Impact

Update:

- `pi/agent/extensions/workflows/README.md`
  - add `verify`, `report`, and `budget` to the globals contract;
  - document model aliases on `agent()` and `verify()`;
  - document concurrency and budget semantics, stable error codes, asynchronous mirror caveat, and examples;
  - expand the single unified config table and JSON example to all seven fields;
  - retain explicit logging language that no workflow run database or new retained output is introduced;
  - narrow the quality-helper limitation and remove the model-tier/hardcoded-concurrency limitations.
- `pi/agent/extensions/workflows/DESIGN.md`
  - document the ledger, independent limit semantics, retry-attempt accounting, immutable worker mirror, verification composition, alias-only model policy, and unchanged host/worker security boundary;
  - rewrite only the superseded non-goals while retaining persistence, background, and writable-workflow boundaries.
- `pi/README.md`
  - update the workflows extension row to mention bounded budgets, verification gates, and curated model routing.
- Root `README.md`
  - inspect the workflow capability overview and update it if it describes the narrower current feature set; otherwise record in completion evidence that no root change was necessary.

No new standalone user documentation, API document, persistence documentation, or changelog is required. The ledger remains internal to the workflows extension.

## Testing / Verification

- **V1 (AC-1, AC-6, AC-12, AC-15):** Run focused config tests for defaults, settings/environment precedence, invalid input, concurrency clamping, disabled budgets, and trimmed tier selectors.
  - `npx tsx --test pi/agent/extensions/workflows/config.test.ts`
- **V2 (AC-5):** Run parser tests for direct `agent()`/`verify()` acceptance and `report()`-only/no-spawn rejection.
  - `npx tsx --test pi/agent/extensions/workflows/parser.test.ts`
- **V3 (AC-7 through AC-11):** Run pure ledger tests for logical reservations, independent limits, retry-attempt token replacement/summing, threshold transitions, snapshots, and listeners.
  - `npx tsx --test pi/agent/extensions/workflows/ledger.test.ts`
- **V4 (AC-2 through AC-14):** Run runtime tests through real workers with injected spawn behavior. Verify concurrency worker data, verification/report contracts, retry-safe usage, call-cap behavior, token cancellation/relabeling, partial fan-in, immutable budget access, and model-tier policy without live credentials.
  - `npx tsx --test pi/agent/extensions/workflows/runtime.test.ts`
- **V5 (AC-14, AC-15):** Run tool tests for config wiring, prompt/tool descriptions, details/failure counters, and unchanged final-output/spillover behavior.
  - `npx tsx --test pi/agent/extensions/workflows/workflow-tool.test.ts`
- **V6 (AC-17):** Run all mandatory and repository-wide checks after focused tests.
  - `make typecheck`
  - `make test`
  - `npm run lint`
  - `npm run format:check`
- **V7 (AC-16):** Inspect the final diff and search documentation to confirm all seven config fields and environment overrides are documented, `/workflows-config` coverage is complete, the four capabilities are described consistently, and resume/journaling remains explicitly out of scope.
- **V8 (all ACs):** Audit completion evidence against every numbered acceptance criterion, citing focused test names/results and documentation paths rather than relying only on aggregate green commands.

## Risks and Mitigations

- **Retry usage undercount:** A fresh activity tracker is created for every retry, so keying only by request ID would overwrite earlier usage. Include an internal attempt identity and test both cumulative updates and cross-attempt sums.
- **Limit-state interference:** A single sticky "first exceeded" code could let an earlier call-cap denial suppress a later token abort. Track call and token conditions independently and give active token enforcement its own transition.
- **Over-cancellation:** Reusing the token-abort behavior for agent-cap denial would kill valid admitted work. The call cap rejects only the new request; only token exhaustion aborts active agents.
- **Cancellation mislabeling:** Parent abort, timeout, and token abort can race. Use a dedicated budget controller, compose signals while preserving the first tagged reason, propagate upstream reasons through the per-attempt timeout controller, and classify only attempts whose effective abort cause is the budget tag.
- **Budget overshoot:** Usage arrives after provider activity, so cancellation cannot guarantee an exact hard token ceiling. Document the limit as observed-usage enforcement and keep the worker mirror advisory.
- **Mutable advisory state:** A normal object would let scripts replace methods or accessors. Freeze the facade, hide its backing state, and test mutation/redefinition attempts.
- **Invalid direct concurrency:** A naive `Math.min` clamp propagates `NaN` and fractional values. Normalize finite positive integers before clamping and test callers that bypass config.
- **Silent model fallback:** Falling back from an unconfigured alias could unexpectedly change cost or quality. Reject explicitly and keep alias resolution host-side.
- **Worker-source escaping:** Generated worker code lives inside a TypeScript template literal. Follow the established concatenation pattern for runtime interpolation and cover option-validation messages through real-worker tests.
- **Documentation drift:** README and DESIGN currently state that model tiers and all quality helpers are absent. Update these claims in the same rollout and run format/search checks.

## Assumptions

- Child `message_end.usage.totalTokens` remains the activity tracker's cumulative observed-token input for each subagent process.
- Pi continues to accept full `provider/model-id` selectors through the existing host-side `SpawnInvocation.model` field.
- Project-level workflow configuration keeps the existing shared precedence semantics; model tier selectors may therefore be supplied globally, per project, or by environment without becoming script-controlled values.
- No renderer change is needed unless implementation reveals that existing snapshot/details output cannot explain budget failures; stable branch error codes are the primary user-visible diagnostic.

## Handoff Summary

Implement the four capabilities as one workflows-extension rollout while preserving the current foreground read-mostly sandbox. Start with config and pure ledger tests, then add verification helpers, retry-safe budget enforcement, the immutable worker mirror, fixed host-resolved model aliases, and coherent documentation. Do not implement any journal, resume, persistence, background manager, raw script model selector, or writable workflow behavior.

Suggested autonomous objective:

```text
/goal Implement .plans/2026-07-11-workflows-runtime-parity.md. Complete only after every acceptance criterion is satisfied with concrete evidence from focused tests, make typecheck, make test, lint, format checking, and the final documentation/config audit.
```
