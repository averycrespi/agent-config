# workflows extension design

The `workflows` extension owns deterministic foreground orchestration above the curated `subagents` process API. It keeps privileged policy, model resolution, accounting, and cancellation in the host while a separate permissioned, killable child process executes minimal read-mostly workflow scripts.

## Architecture

- `index.ts` registers the extension, `/workflows-config`, and live `/workflows-list` discovery.
- `config.ts` loads timeout, concurrency, budget, fixed-tier, and single-store settings through shared precedence helpers.
- `store.ts` resolves the configured user root on demand, inventories bounded definitions fail-soft, and resolves requested names fail-closed.
- `script-artifacts.ts` exclusively persists exact per-run source under a dedicated owner-controlled temporary directory and owns seven-day `.js` cleanup.
- `workflow-tool.ts` dispatches compound `list`, `validate`, and `run` actions. Only `run` creates a ledger/spawner, persists the source artifact, streams progress, applies final spillover, and persists a narrow recovery envelope after abnormal runtime termination.
- `parser.ts` performs the one canonical AST guardrail validation and extracts literal metadata for inline and saved sources.
- `ledger.ts` synchronously reserves logical calls and accounts cumulative observed tokens by request and retry attempt.
- `runtime.ts` owns the sandbox process and RPC boundary, terminal cutover/drain, retries, authoritative cancellation causes, effective timeout resolution, structured recovery accumulation, policy enforcement, model resolution, schema validation, and activity tracking.
- `sandbox-source.ts` exposes deterministic script globals, clone-safe errors, combinators, and the advisory budget mirror.
- `display.ts`, `safe-stringify.ts`, and `types.ts` own rendering, safe previews, and shared contracts.
- `pi/agent/workflows/deep-research.js` is a repository-managed ordinary saved definition, not extension runtime code or a parser bypass.

Imports from subagents must remain limited to `../subagents/api.ts`. The ledger is internal and has no persisted or cross-run state.

## Store and action lifecycle

`userWorkflowsDir` is the only store. Its default is `<agentDir>/workflows`; settings and `WORKFLOWS_USER_WORKFLOWS_DIR` use normal global → project → environment precedence, and relative values resolve against the current call cwd. No repository store, directory walking, or startup cache exists. The explicitly configured root may itself resolve through a Stow-managed symlink. After resolving that root, entry paths must remain contained within its real target.

Saved identity is strict: a regular `<name>.js` file and literal `meta.name` must match `^[a-z0-9][a-z0-9-]{0,63}$`. Entries are opened without following symlinks, checked as regular files, bounded to 256 KiB, and passed to `parseWorkflowScript()`. Inventory is deterministic and fail-soft, capped at 200 candidates and 2 MiB aggregate parsed source; invalid entries retain capped single-line diagnostics. Formatted tool text is capped at 32 KiB with explicit truncation. Direct requested-name resolution computes and validates `<name>.js` independently of inventory truncation.

`list` loads config and current inventory only. `validate(script)` invokes only the parser; `validate(name)` additionally performs safe store resolution and identity checks. Neither path loads agents, creates a ledger, writes an artifact, or starts a child. `run` resolves and parses one inline or named source, then persists `ParsedWorkflow.script` before loading agents or constructing runtime state. Named and inline sources converge at that point and cannot drift in parser, sandbox, policy, budget, cancellation, rendering, or failure behavior.

The repository-managed `deep-research` definition uses this unchanged saved-file path. Its deterministic structure bounds the run to five search facets, twelve source extractions, three independent claim-verification ballots, one synthesis, one initial audit, and at most one repair plus final audit: 25 logical calls at the ceiling. The script owns public-web prompts, authority-aware claim adjudication, partial-failure reporting, and the final Markdown contract; the host still owns model-alias resolution, retries, accounting, cancellation, schemas, and policy. Tests load the actual saved file through `parseWorkflowScript()` and execute it through `runWorkflow()` with controlled structured subagent results.

The artifact directory must be a real owner-controlled mode-`0700` directory. Files use independently sanitized names plus an opaque nonce and exclusive mode-`0600` creation, so metadata and tool-call IDs cannot affect containment or overwrite an existing artifact. Failure is fatal before execution. Cleanup considers only this helper's old regular `.js` files and leaves symlinks, unrelated spillover, and other content alone. Run results and runtime errors expose `scriptFile`; named runs separately expose `sourceFile`. No result or run-state sidecar is written.

## Runtime and security boundary

Workflow JavaScript runs as a generated data-URL module inside a separate Node child process. The first terminal event closes request admission. Parent cancellation or the whole-workflow timeout aborts active subagents and terminates the process. A normal result or script error also terminates detached outstanding work. Runtime tracks every admitted logical-call promise and does not return or throw until those promises acknowledge settlement, so final counts and recovery state cannot race child termination. Per-agent timeouts abort only that attempt. Token exhaustion uses a separate controller: it aborts active subagents but deliberately leaves the sandbox alive so `parallel()` and `parallelSettled()` can complete fan-in.

The sandbox rejects absent `run()` and resolved `undefined` with `workflow_missing_result`; host receipt repeats the check defensively. `null` remains a valid explicit empty result. The first top-level cause is normalized once and carried in `WorkflowRuntimeError` with a frozen final snapshot, mutually categorized counts, and recovery records. Later budget flags, sandbox exits, or persistence failures must not relabel that cause.

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

Workflow progress is in-memory for one foreground call. Snapshots retain metadata, phases, logs, agent activity, timings, previews, host-resolved per-agent timeouts, normalized terminal metadata, and separate final-agent/logged-branch/settled-branch failure counts.

Runtime also keeps one input-ordered record per settled logical call. A record contains request/agent/intent/phase identity, timings, attempts, effective timeout, and either a host-validated structured value or a typed terminal failure plus optional finalized child-log path. Successful prose is counted but not recoverable. Prompts, args, raw activity, stdout/stderr, tool traces/outputs, environment, and source never enter this accumulator. Settlement is recorded before posting the response back to the sandbox, preserving host data if IPC closes.

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

Policy-valid agent type and model alias checks happen before the ledger reservation. Invalid calls do not consume a logical slot. Runtime resolves one effective timeout when admitting a request; valid explicit short values are preserved rather than raised to the default. A retry calls the same spawner with the same request ID, the same effective timeout, and a distinct internal attempt number. The spawner-owned agent state remains authoritative for live UI activity and records that timeout and terminal metadata.

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

`workflow-tool.ts` merges runtime snapshots with final spawner-owned states by request ID. `display.ts` follows the repository tool-row grammar: every action has a stable source-free call summary; collapsed failures show one compact authoritative cause/count line; expanded results reveal inventory, validation source, per-agent timeout/failure metadata, recent logs, and finalized diagnostic paths. Dynamic display fields are bounded and control-character-normalized before the shared width-aware renderer truncates each logical line. Compressed contents are never read by rendering. Script logs are capped at 100 entries × 2,000 characters and phases at 100 entries × 200 characters in both the sandbox and host, preventing unbounded IPC/state/TUI amplification. Final output uses shared safe stringification and spillover.

Exact source copies remain persistent run inputs with independent seven-day best-effort cleanup. On an abnormal `WorkflowRuntimeError`, `workflow-tool.ts` is the host persistence boundary: if recoverable records exist, it builds a versioned JSON envelope, enriches records with final activity usage, and asks `_shared/retained-artifacts.ts` to gzip/finalize it. That helper shares a fixed 1 GiB compressed-byte pool and seven-day lazy cleanup with subagent failure logs, using owner/symlink checks, exclusive `0600` staging, cross-process lock serialization, oldest-first eviction, and no-overwrite hard-link publication. Success and normal authored outcomes never call this path. Persistence is secondary: failures become bounded warnings and cannot replace the runtime cause. Only paths enter tool/session output.

The recovery envelope is diagnostic partial work, not a durable run system. No run database, resume/replay, budget journal, response cache, checkpoint, successful-run journal, ledger snapshot, or complete model-response persistence is introduced. Subagent logs, recovery files, and spillover may contain sensitive raw or structured data as documented in the user README.

## Non-goals

- Project stores, implicit repository lookup, an extension-owned built-in definition registry, precedence/shadowing, workflow-specific mutation actions, or arbitrary file paths.
- Workflow composition, nesting, recursion, per-workflow commands/templates, background execution, or a workflow navigator.
- Retained successful runs/results, journaling/resume/replay, run IDs, checkpoints, response caching, or additional metadata schemas/policies. Narrow abnormal structured recovery is the explicit exception.
- Writable workflow agents, parallel implementation, session inheritance, git worktree isolation, or writable coordination.
- Arbitrary script model selectors, user-defined alias maps, changes to agent Markdown model declarations, or changes to direct `spawn_agents` behavior.
- Cost budgets, estimates, reservations, per-phase/per-agent quotas, or configurable generalized quota infrastructure. The fixed shared diagnostic-storage quota is not a workflow budget.
- A generalized quality-helper, voting, consensus, router, loop, or evaluator framework beyond `verify()` and `report()`.

## Change guidance

- Keep store enumeration, file reads, identity checks, artifact writes, privileged enforcement, and raw selector resolution host-side.
- Keep `parseWorkflowScript()` as the mandatory shared validation seam; never add a trusted-store bypass.
- Preserve fail-soft bounded inventory, direct fail-closed resolution, symlink rejection, real-root containment, and fail-closed artifact persistence.
- Keep source-script cleanup scoped to old regular `.js` files in its dedicated directory. Keep diagnostic recovery in the shared retained-artifact pool; do not fold either into spillover cleanup.
- Preserve synchronous reservation/accounting and independent call/token conditions.
- Feed accounting from every streamed child event, not activity-render callbacks.
- Add real-sandbox tests before broadening globals or RPC options, including constructor-based capability probes.
- Keep Node permissions, the empty child environment, disabled string code generation, schema preflight, and host-side RPC validation fail-closed.
- Keep public imports limited to `subagents/api.ts` and do not broaden writable capabilities as a small option toggle.
