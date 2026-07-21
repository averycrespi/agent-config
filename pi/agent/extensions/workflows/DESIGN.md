# workflows extension design

`workflows` is a deterministic foreground control plane above the sanitized subagents API. A permissioned child evaluates orchestration JavaScript; the host owns authority, live model resolution, accounting, cancellation, validation, state, and retention.

## Architecture

- `config.ts` owns workflow-only timeout, concurrency, budgets, visibility, and saved-store settings. It diagnoses removed workflow tier settings.
- `store.ts` safely inventories and resolves bounded saved definitions.
- `parser.ts` validates literal metadata, deterministic syntax, and a direct `agent()`/`verify()` call.
- `sandbox-source.ts` exposes deterministic globals and transports explicit intent/capabilities/modelTier/thinking over IPC.
- `runtime.ts` owns sandbox lifecycle, RPC admission, retries, timeouts, cancellation, ledgers, structured output, recovery records, and sanitized `runSubagent()` calls.
- `workflow-tool.ts` implements list/validate/run, source persistence, progress, final spillover, and abnormal recovery persistence.
- `ledger.ts`, `display.ts`, `safe-stringify.ts`, `script-artifacts.ts`, and `types.ts` own accounting, terminal-safe rendering, previews, source retention, and contracts.
- `pi/agent/workflows/deep-research.js` and `review.js` are ordinary saved definitions tested beside their sources.

Cross-extension imports remain limited to `../subagents/api.ts`.

## Store lifecycle

`userWorkflowsDir` is the only store. Entries are strict regular `<name>.js` files whose literal `meta.name` matches the filename and kebab-case pattern. Resolution rejects symlinked/unsafe/non-regular/unreadable/oversized/mismatched definitions. Inventory is deterministic, bounded, and fail-soft; direct resolution is fail-closed and independent of inventory truncation.

`list` reads configuration and inventory. `validate` parses only. `run` parses, persists exact source in an owner-controlled temporary directory, constructs one ledger/spawner, and starts the sandbox. Named and inline sources converge before execution.

## Sandbox boundary

The workflow child starts with an empty environment, Node permission mode, no filesystem/network/child-process/worker/addon/inspector grants, and string code generation disabled. It receives only cloneable args, cwd, normalized concurrency, advisory budget snapshots, and deterministic globals. `process` is hidden and randomness/clocks are unavailable.

The parser is defense in depth. It rejects imports, re-exports, dynamic import, `require`, direct privileged globals/APIs, nondeterminism, and scripts without a direct `agent()` or `verify()` call. The runtime fails closed when required Node flags are unsupported.

RPC remains untrusted. Host admission reconstructs only required execution policy, retry/timeout, and validated output contracts. A first terminal event closes admission; the host then drains every admitted call before returning or throwing so counts and recovery cannot race detached work.

## Explicit subagent policy

Both sandbox helpers require:

- non-empty intent;
- explicit capability array, including valid `[]`;
- `small`, `medium`, or `large` model tier;
- explicit thinking level.

There is no agent identity, named allowlist, raw model selector, role default, parent fallback, or workflow-local tier map. `verify()` is standard-library composition over `agent()` with a fixed verdict prompt/schema; it has no reviewer identity.

`createWorkflowAgentSpawner()` forwards sanitized requests to `runSubagent()` with `ctx.modelRegistry`. Central subagent config resolves tier/model and validates capability/thinking policy. Workflow code cannot pass tools, extensions, environment, system prompts, skills/templates, session controls, or exact models.

Policy validation and output-schema validation occur before process launch. Retries retain the same logical policy and request ID. Structured output, cancellation, logging, and child context invariants remain owned by the subagent engine.

## Deep research routing

The saved workflow deliberately narrows each phase:

- scope/synthesis/audit/repair use `[]`, large, high;
- search uses `read-web`, small, medium;
- extraction and claim verification use `read-web`, large, high.

Search/extraction retry once; verification does not. Deterministic tests execute the actual saved source and assert routing, retries, strict output contracts, claim thresholds, bounded repair, and public-web prompt boundaries.

## Review routing

The saved review workflow deliberately separates caller-owned evidence preparation from model review. The caller supplies target metadata, acceptance criteria, changed files, readable context paths, deterministic check results, prior review context, known gaps, and optional risk/lens tags. The sandbox validates and bounds this package but does not run Git, fetch remote data, or execute checks.

Behavior, assurance, and maintainability reviews always run with `read-filesystem`, medium tier, and high thinking. At most two deterministic optional lenses—architecture and performance—use the same policy. `parallelSettled()` preserves partial results and turns branch failures into explicit coverage gaps. Reviewer outputs are strict finding batches; exact duplicate groups retain every candidate ID.

One `read-filesystem`, large/high adjudicator may confirm, reject, or defer each immutable exact-duplicate group. Parent-side semantic validation requires every group exactly once and rejects split, combined, rewritten, duplicate, or invented groups. Invalid or failed adjudication moves every candidate group to human judgment and marks the report incomplete. JavaScript renders the final severity-grouped report without another synthesis call, merge-readiness claim, or fix loop.

## State and ledger

Progress state is one foreground run: metadata, phase/log history, intent-first subagent states, explicit policy, timings, previews, timeouts, typed errors, and separate agent/logged/settled failure counts. Prompts are not retained in display state.

One synchronous ledger reserves logical request IDs and tracks latest cumulative tokens by request/attempt. Retries add prior-attempt usage but reuse one run slot. Disabled limits appear as `null`. Token exhaustion is sticky and aborts active calls while leaving the sandbox alive for settled fan-in; run-cap denial affects only later calls. The sandbox budget facade is advisory and may lag.

## Timeout, retry, and termination

Runtime resolves one effective timeout per logical call. A valid shorter call timeout applies across retries. Per-call timeout aborts only that attempt and waits for settlement before scheduler capacity is released. Parent cancellation and whole-run timeout terminate admission, abort active calls, kill the sandbox, and drain admitted promises.

Retries are bounded to 0–2. Permanent policy/schema, cap, budget, timeout, and cancellation causes are not retried. The first top-level cause remains authoritative; later budget state or retention warnings cannot relabel it.

There is no unbounded verify/fix loop. `report()` either passes once or terminates with a structured rejection; saved workflows own any bounded repair logic.

## Rendering and recovery

The call renderer is intentionally empty so collapsed tool output has exactly one aggregate result line. Expansion must preserve that line byte-for-byte before adding details. Rows use intent as identity and carry capability/tier/thinking plus status, timing, tool/token counts, typed failures, and paths. Expanded agent rows preserve chronological start order regardless of status, with the newest at the bottom; settled-history limits hide rows without reordering the visible ones. Expanded output also shows logs, inventory, source paths, and diagnostics. Tool identity is emphasized; separators and supporting metadata are muted. Dynamic data is control-normalized, bounded, and width-aware. Prompts, raw scripts, secrets, and compressed content are not rendered.

Exact source copies are retained for seven days. Abnormal runs may persist one versioned owner-only gzip recovery envelope containing identity/policy, timings, attempts, usage, structured successes, typed failures, and child-log paths. It excludes prompts, args, successful prose, raw activity/output/tool traces, environment, credentials, and source. Recovery shares the subagent diagnostic quota; persistence is secondary and never replaces the run cause.

## Configuration invariant

Workflow configuration must not own model selectors. `WORKFLOWS_MODEL_TIER_SMALL`, `WORKFLOWS_MODEL_TIER_BIG`, `modelTierSmall`, and `modelTierBig` are removed and diagnosed when encountered. All tier selectors and capability/thinking ceilings belong to `extension:subagents`.

## Non-goals

- Named agents, role defaults, model aliases outside the three central tiers, or per-workflow authority maps.
- Writable coordination, worktrees, parallel implementation, nested/background workflows, session inheritance, or arbitrary execution paths.
- Resume/replay, run database, checkpoints, response cache, or successful result journal.
- A generalized judge/router/consensus framework beyond strict `verify()` and `report()`.

## Change guidance

Keep privileged resolution and mutable state host-side. Preserve required explicit policy at both sandbox and host boundaries, central `runSubagent()` routing, deterministic termination, synchronous accounting, empty child environment, Node permissions, disabled string generation, fail-closed schemas, and sanitized rendering. Add real-sandbox tests before broadening globals or RPC fields. Do not reintroduce workflow tier settings or named compatibility paths.
