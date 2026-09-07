# workflows extension design

`workflows` is a deterministic foreground control plane above the sanitized subagents API. A permissioned child evaluates orchestration JavaScript; the host owns authority, live model resolution, accounting, cancellation, validation, state, and retention.

## Architecture

- `config.ts` owns workflow-only timeout, concurrency, budgets, visibility, and saved-store settings. It diagnoses removed workflow tier settings.
- `store.ts` safely inventories and resolves bounded saved definitions.
- `parser.ts` validates literal metadata, deterministic syntax, a direct `agent()`/`verify()` call, and obvious result-contract mistakes before agent admission.
- `sandbox-source.ts` exposes deterministic globals and transports explicit intent/capabilities/profile over IPC.
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

The parser is defense in depth. It rejects imports, re-exports, dynamic import, `require`, direct privileged globals/APIs, nondeterminism, and scripts without a direct `agent()` or `verify()` call. Result preflight deliberately checks only straight-line top-level `run` function bodies with no value-returning statement and direct `report()` calls with statically missing gate options. Nested callback returns cannot satisfy the outer result contract. Any user binding named `report` disables helper-specific checks conservatively; spreads, computed properties, dynamic options, and complex control flow remain runtime concerns. Do not turn this into a general JavaScript type or control-flow checker. Runtime result and gate validation remain authoritative.

The runtime fails closed when required Node flags are unsupported.

RPC remains untrusted. Host admission reconstructs only required execution policy, retry/timeout, and validated output contracts. A first terminal event closes admission; the host then drains every admitted call before returning or throwing so counts and recovery cannot race detached work.

## Explicit subagent policy

Both sandbox helpers require:

- non-empty intent;
- explicit read-only capability array, including valid `[]`;
- `fast`, `balanced`, or `strong` profile.

There is no agent identity, named allowlist, raw model selector, caller-selected effort, role default, parent fallback, or workflow-local profile map. `verify()` is standard-library composition over `agent()` with a fixed verdict prompt/schema; it has no reviewer identity.

`createWorkflowAgentSpawner()` forwards sanitized requests to `runSubagent()` with `ctx.modelRegistry`. Central subagent config resolves the profile's model and effort and validates capability/profile policy. Sandbox validation and host admission both reject `write-filesystem` and `exec-shell`. Workflow code cannot pass tools, extensions, environment, system prompts, skills/templates, session controls, or exact models.

Policy validation and output-schema validation occur before process launch. Retries retain the same logical policy and request ID. Structured output, cancellation, logging, and child context invariants remain owned by the subagent engine.

## Deep research routing

Caller-side opt-in guidance belongs in the saved definition's `meta.description` and README, not a global workflow restriction or a runtime authorization flag. Keep the opt-in requirement and generic-research exclusions within the inventory's 240-character description limit. Tests check the actual inventory to prevent truncation from hiding that distinction; they do not prove model compliance with the guidance.

The saved workflow deliberately narrows each phase:

- scope/synthesis/audit/repair use `[]` with `strong`;
- search uses `read-web` with `fast`;
- extraction and claim verification use `read-web` with `strong`.

Search/extraction retry once; verification does not. Deterministic tests execute the actual saved source and assert routing, retries, strict output contracts, claim thresholds, bounded repair, and public-web prompt boundaries.

## Review routing

The saved review workflow deliberately separates caller-owned evidence preparation from model review. The caller supplies target metadata, acceptance criteria, changed files, readable context paths, deterministic check results, prior review context, delivery scope and evidence requirements, known gaps, and optional risk/lens tags. The sandbox validates and bounds this package but does not run Git, fetch remote data, or execute checks.

One comprehensive independent reviewer runs with `read-filesystem` and the `balanced` profile by default. At most two risk-driven optional lenses—architecture and performance—use the same policy. `parallelSettled()` preserves partial results and turns any selected branch failure into a coverage gap. Reviewer outputs are strict finding batches; exact duplicate groups retain every candidate ID. The single-reviewer path directly renders normalized findings, deferring low-confidence claims to human judgment rather than adding a mandatory adjudicator.

Only multi-lens findings invoke one `read-filesystem`, `strong` adjudicator to confirm, reject, or defer each immutable exact-duplicate group. Semantic validation requires every group exactly once and rejects split, combined, rewritten, duplicate, or invented groups. Invalid or failed adjudication defers every candidate and marks coverage incomplete. Unsupported blocking categories require human judgment, not silent downgrade. Nonblocking suggestions remain visible without reopening implementation. JavaScript returns a structured completeness/outcome/scope result plus deterministic Markdown without another synthesis call or merge-readiness claim.

Gap classification is requirement-based, not a model-supplied blocking boolean. Caller, reviewer, and adjudicator gaps can reference declared requirements; only requirements outside the current boundary become qualifications. Each independently required check has a distinct requirement ID and at most one check result; duplicate mappings reject before launch, omitted applicable requirements lack passing evidence, and every failed check blocks. The reviewer must compare the declared inventory with repository/user requirements to catch undeclared checks or aggregate declarations. Unclassified gaps, infrastructure failures, truncation, malformed findings, and adjudication ambiguity fail closed. Prepared unknown requirement IDs reject; model-invented IDs remain blocking. Scope declarations still require independent comparison with authoritative user/repository criteria: schema validation cannot prove a claimed exemption is legitimate. Preserve this distinction in both structured output and the full report.

`reviewMode: confirmation` requires prior review context and narrows reviewer/adjudicator prompts to original blockers, affected boundaries, and repair-induced regressions. Expanded delivery scope requires new initial review and reevaluation of newly applicable checks even at unchanged HEAD. Prompt scope is guidance, not a deterministic guarantee of model behavior. The owning session retains repair authority, findings/dispositions, revision evidence, and durably consumed repair count; workflow children remain read-only. Tests exercise actual source routing, fail-closed outcomes, and context delivery; behavioral scenarios separately observe model compliance.

## State and ledger

Progress state is one foreground run: metadata, phase/log history, intent-first subagent states, explicit policy, timings, previews, timeouts, typed errors, and separate agent/logged/settled failure counts. Prompts are not retained in display state.

One synchronous ledger reserves logical request IDs and tracks latest cumulative tokens by request/attempt. Retries add prior-attempt usage but reuse one run slot. Disabled limits appear as `null`. Token exhaustion is sticky and aborts active calls while leaving the sandbox alive for settled fan-in; run-cap denial affects only later calls. The sandbox budget facade is advisory and may lag.

## Timeout, retry, and termination

Runtime resolves one effective timeout per logical call. Omitted `timeoutMs` inherits configured `agentTimeoutMs`; a valid explicit value replaces it, whether shorter or longer, for each retry attempt. Profiles do not change this policy. The whole-run deadline starts with the workflow and still bounds later-starting calls and longer overrides. Per-call timeout aborts only that attempt and waits for settlement before scheduler capacity is released. Parent cancellation and whole-run timeout terminate admission, abort active calls, kill the sandbox, and drain admitted promises.

Deadline-selection guidance belongs in `workflow-tool.ts`'s tool description and prompt guidelines, not a general engineering skill. Prefer configured defaults and justify overrides from workload and profile; do not infer stagnation from elapsed time alone. Registration tests check that this guidance reaches the agent, while runtime tests establish deadline inheritance, override behavior, sibling preservation, and whole-run cancellation. These tests do not prove model compliance.

Retries are bounded to 0–2. Permanent policy/schema, cap, budget, timeout, and cancellation causes are not retried. The first top-level cause remains authoritative; later budget state or retention warnings cannot relabel it.

There is no unbounded verify/fix loop. `report()` either passes once or terminates with a structured rejection; saved workflows own any bounded repair logic.

## Rendering and recovery

The call renderer is intentionally empty so every tool result owns a single action-specific header (`run`, `list`, or `validate`). Run results show the per-agent progress inventory by default; expansion must preserve that header and those rows before adding diagnostics. Workflow agents reuse the shared two-line subagent grammar: stable identity and statistics first, then compact `profile (capabilities)` policy, workflow timeout metadata, and volatile activity last. Fixed workflow capabilities map to `fs`, `broker`, and `web`; empty sets are omitted. Agent rows preserve chronological start order regardless of status, with the newest at the bottom; settled-history limits hide rows without reordering the visible ones. List results show inventory rows by default, while validate results remain one line. Expansion adds typed failures, workflow logs, retained and recovery paths, the list store path and invalid-entry diagnostics, or the validated source path. Tool identity is emphasized; separators and supporting metadata are muted. Dynamic data is control-normalized, bounded, and width-aware. Prompts, raw scripts, secrets, and compressed content are not rendered.

Exact source copies are retained for seven days. Abnormal runs may persist one versioned owner-only gzip recovery envelope containing identity/policy, timings, attempts, usage, structured successes, typed failures, and child-log paths. Schema version 2 records profile policy rather than the removed tier/thinking pair. It excludes prompts, args, successful prose, raw activity/output/tool traces, environment, credentials, and source. Recovery shares the subagent diagnostic quota; persistence is secondary and never replaces the run cause.

## Configuration invariant

Workflow configuration must not own profile mappings or model selectors. `WORKFLOWS_MODEL_TIER_SMALL`, `WORKFLOWS_MODEL_TIER_BIG`, `modelTierSmall`, and `modelTierBig` remain removed and diagnosed when encountered. All profile model/effort mappings and the global capability ceiling belong to `extension:subagents`.

## Non-goals

- Named agents, role defaults, model aliases outside the three central profiles, or per-workflow authority maps.
- Writable coordination, worktrees, parallel implementation, nested/background workflows, session inheritance, or arbitrary execution paths.
- Resume/replay, run database, checkpoints, response cache, or successful result journal.
- A generalized judge/router/consensus framework beyond strict `verify()` and `report()`.

## Change guidance

Keep privileged resolution and mutable state host-side. Preserve required explicit policy and read-only capability admission at both sandbox and host boundaries, central `runSubagent()` routing, deterministic termination, synchronous accounting, empty child environment, Node permissions, disabled string generation, fail-closed schemas, and sanitized rendering. Add real-sandbox tests before broadening globals or RPC fields. Do not reintroduce workflow profile settings or named compatibility paths.
