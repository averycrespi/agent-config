# workflows extension design

The `workflows` extension owns deterministic foreground orchestration above the curated `subagents` process API. It keeps privileged policy, model resolution, accounting, and cancellation in the host while a separate permissioned, killable child process executes minimal read-mostly workflow scripts.

## Architecture

- `index.ts` registers the extension and `/workflows-config`.
- `config.ts` loads all seven timeout, concurrency, budget, and fixed-tier settings through shared precedence helpers.
- `workflow-tool.ts` defines canonical tool guidance, creates one ledger per execution, wires host policy/runtime options, streams progress, and applies final spillover.
- `parser.ts` performs AST guardrail validation and extracts literal metadata.
- `ledger.ts` synchronously reserves logical calls and accounts cumulative observed tokens by request and retry attempt.
- `runtime.ts` owns the sandbox process and RPC boundary, retries, cancellation causes, policy enforcement, model resolution, schema validation, and activity tracking.
- `sandbox-source.ts` exposes deterministic script globals, clone-safe errors, combinators, and the advisory budget mirror.
- `display.ts`, `safe-stringify.ts`, and `types.ts` own rendering, safe previews, and shared contracts.

Imports from subagents must remain limited to `../subagents/api.ts`. The ledger is internal and has no persisted or cross-run state.

## Runtime and security boundary

Workflow JavaScript runs as a generated data-URL module inside a separate Node child process. Parent cancellation or the whole-workflow timeout aborts active subagents and terminates the process. Per-agent timeouts abort only that attempt. Token exhaustion uses a separate controller: it aborts active subagents but deliberately leaves the sandbox alive so `parallel()` and `parallelSettled()` can complete fan-in.

The child starts with an empty environment, `--permission`, and `--disallow-code-generation-from-strings`. It receives no filesystem, network, child-process, worker, addon, inspector, environment, raw model-selector, session-inheritance, or writable-agent capability. Host communication uses advanced-serialization IPC only. The child receives `args`, `cwd`, a normalized concurrency limit, an advisory budget snapshot, and frozen deterministic globals; `process` is hidden and `Math.random` is omitted.

The parser is defense in depth, not the primary capability boundary. String code generation is disabled process-wide so `Function`, indirect evaluation, and function-constructor chains cannot bypass lexical checks. The runtime fails closed if either required Node flag is unavailable. Do not replace this boundary with a same-process `vm`, parser-only filtering, or a less restricted subprocess.

RPC inputs remain untrusted even with process isolation. The host validates output schemas before reserving or spawning, and the production spawner repeats that preflight. Unsupported schemas fail with `agent_policy_rejected` rather than silently becoming prose requests. Sandbox errors cross IPC only with a non-empty string code, a string message, and recursively clone-safe details; unknown or numeric codes normalize to `workflow_script_error`.

## Script validation

`parser.ts` enforces:

- literal `export const meta = { name, description }` as the first statement;
- no imports, re-exports, dynamic imports, `require`, direct filesystem/network/process/global/buffer/worker/timer APIs, or nondeterministic clock, random, performance, or cryptographic calls;
- at least one syntactic direct `agent()` or `verify()` call.

`report()` is local and non-spawning, so it does not satisfy the last rule. Indirect aliases are not statically inferred.

## State and ledger

Workflow progress is in-memory for one foreground call. Snapshots retain metadata, phases, logs, agent activity, timings, previews, and separate final-agent/logged-branch/settled-branch failure counts.

One `WorkflowRunLedger` is shared by `runWorkflow()` and `createWorkflowAgentSpawner()` for a tool execution. Its synchronous operations prevent concurrent RPC messages from oversubscribing the call cap. It tracks:

- a reservation set keyed by logical sandbox request ID;
- latest cumulative tokens keyed by `(requestId, attempt)`;
- independent call-cap and sticky token-threshold conditions;
- fresh immutable snapshots and listeners.

Repeated activity records for one attempt replace that attempt's previous cumulative total. Retries use distinct attempt keys and therefore add to earlier usage while reusing the same logical reservation. Disabled limits appear as `null` in snapshots even though configuration uses `0`.

The sandbox's `budget` facade is frozen. Its accessors read a hidden snapshot replaced by host messages. This mirror can lag streamed usage and is optimization/advice only; every authoritative reservation and cancellation remains host-side.

## Subagent and model policy

`createWorkflowAgentSpawner()` is the read-mostly policy boundary:

- default type is `explorer`;
- allowed types are `explorer`, `scout`, `researcher`, `reviewer`, and `analyst`;
- agent-definition tools are intersected with the fixed non-mutating `read`, `ls`, `find`, `grep`, read-only broker, and web retrieval allowlist; `bash`, `write`, `edit`, and unknown tools are removed regardless of agent name or prompt;
- `inheritSession` is always `"none"`; only the selected host agent definition's curated `env` is forwarded (preserving read-only broker/approval policy), script-provided environment is impossible, and the effective signal is propagated;
- structured output is forwarded only through the existing `{ output: { schema } }` contract after `validateOutputSchema()` accepts the complete schema;
- retries are bounded to 0–2 and per-agent timeout remains runtime-owned.

Policy-valid agent type and model alias checks happen before the ledger reservation. Invalid calls do not consume a logical slot. A retry calls the same spawner with the same request ID and a distinct internal attempt number.

The sandbox RPC's optional `model` remains untrusted string data. The host recognizes only `small` and `big`, resolves them from host configuration, and rejects unknown or unconfigured aliases without spawning. Resolution precedence is requested configured tier, selected agent definition model, then parent model. Raw provider/model selectors never enter sandbox data or responses.

## Verification and report gates

`verify()` is sandbox standard-library composition over `agent()`, not a privileged RPC. It validates its claim/options, defaults to `reviewer`, constructs an evidence-oriented prompt, and requests strict `{ confirmed: boolean, reasons: string[] }` output. A valid refutation resolves `{ ok: false, reasons }`; execution and structured-output failures remain ordinary agent failures.

`report()` is entirely local. It awaits `gate(value)`, returns the original value only for `true` or an object with `ok === true`, and otherwise throws `workflow_report_rejected`. Plain-object reasons are normalized to string array members and attached exactly as `{ reasons }`. Exceptions thrown by a gate propagate unchanged.

Both failure kinds naturally compose with the existing combinators. `workflow_report_rejected` is a script/gate error, not a retry class.

## Concurrency, retries, and budget enforcement

The effective scheduler limit defaults to four and is hard-capped at 16 in both config normalization and direct runtime normalization. Sandbox `parallel()` requests are independently normalized and clamped to that effective limit.

Logical-call exhaustion returns `workflow_run_cap_exceeded` only to the denied request; admitted work continues. Token exhaustion is independent and sticky. Each streamed child event first updates the activity tracker, then records its cumulative total for the current attempt. The final tracker state is recorded again after completion. On threshold transition, runtime pushes a snapshot and aborts the dedicated budget controller. New spawns and retries then fail with `workflow_budget_exceeded`.

Abort cause is preserved through composed workflow/budget/per-attempt signals. An attempt is labeled `workflow_budget_exceeded` only when its effective signal was first aborted by the tagged budget reason. Earlier timeout, parent cancellation, provider failure, policy rejection, and script errors keep their original codes. A prior run-cap denial cannot suppress a later token abort of admitted work. Per-agent timeout and cancellation responses wait for the underlying spawn promise to acknowledge termination before scheduler capacity is released, preventing timed-out children from overlapping replacement work.

`parallel()` logs branch failures and substitutes `null`; `parallelSettled()` returns typed records; `pipeline()` applies sequential stages per item with the same scheduler. Final failure counters preserve their prior semantics, so handled budget or report errors do not introduce a new top-level result schema.

## Rendering, logging, and output

`workflow-tool.ts` merges runtime snapshots with subagent activity updates. Shared width-aware renderers keep one compact row per subagent. Script logs are capped at 100 entries × 2,000 characters and phases at 100 entries × 200 characters in both the sandbox and host, preventing unbounded IPC/state/TUI amplification. Final output uses shared safe stringification and spillover.

No run database, budget journal, script store, or response cache is introduced. Subagent logs and spillover may contain raw tool/model output, as documented in the user README.

## Non-goals

- Background execution, a workflow navigator, retained runs, journaling/resume, run IDs, saved scripts, or response caching.
- Writable workflow agents, parallel implementation, session inheritance, git worktree isolation, or writable coordination.
- Arbitrary script model selectors, user-defined alias maps, changes to agent Markdown model declarations, or changes to direct `spawn_agents` behavior.
- Cost budgets, estimates, reservations, per-phase/per-agent quotas, or generalized quota infrastructure.
- A generalized quality-helper, voting, consensus, router, loop, or evaluator framework beyond `verify()` and `report()`.

## Change guidance

- Keep privileged enforcement and raw selector resolution host-side.
- Preserve synchronous reservation/accounting and independent call/token conditions.
- Feed accounting from every streamed child event, not activity-render callbacks.
- Add real-sandbox tests before broadening globals or RPC options, including constructor-based capability probes.
- Keep Node permissions, the empty child environment, disabled string code generation, schema preflight, and host-side RPC validation fail-closed.
- Keep public imports limited to `subagents/api.ts` and do not broaden writable capabilities as a small option toggle.
