# workflows extension

Background-only deterministic JavaScript orchestration for bounded research, review, verification, and audit workflows. Workflow code runs in a permissioned child process; privileged subagent policy, model resolution, accounting, cancellation, and retention stay host-side.

This is read-mostly orchestration, not parallel implementation or workspace mutation. Use it for coordinated read-only fan-out (including parallel-only batches), dependent phases, programmatic aggregation, verification gates, or an applicable saved workflow. Use [`subagent`](../subagents/README.md) for one independent question; separate direct calls need separate ownership and reconciliation. Preserve skill-required workflows. Use [`script`](../script/README.md) with the selected `mcp` provider for gateway composition that needs no subagent reasoning.

## Tool

`workflow` accepts:

| Action                         | Fields                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `list`                         | No other fields; returns the current saved-workflow inventory.                                                                |
| `validate`                     | Exactly one of `script` or `name`; parses without execution.                                                                  |
| `run`                          | Exactly one of `script` or `name`, plus optional cloneable `args` and `execution: background` (default; foreground rejected). |
| `executions`                   | List retained background workflow executions, without results.                                                                |
| `inspect`, `cancel`, `dismiss` | Required background execution `id`; no source or args.                                                                        |

Every script starts with literal metadata and contains a direct `agent()` or `verify()` call:

```js
export const meta = {
  name: "repo-audit",
  description: "Audit repository concerns",
};

export async function run() {
  phase("inspect");
  const findings = await parallel(
    args.topics.map(
      (topic) => () =>
        agent(`Audit the repository for ${topic} issues.`, {
          intent: `Audit ${topic}`,
          capabilities: ["read-filesystem"],
          profile: "balanced",
        }),
    ),
  );
  const verdict = await verify("These findings are evidence-backed", {
    intent: "Verify findings",
    capabilities: ["read-filesystem"],
    profile: "strong",
    context: findings,
  });
  return await report(findings, { gate: () => verdict });
}
```

`run()` must return its final value. For ordinary results use `return results`; for verified results use `return await report(results, { gate: () => verdict })`. `report()` is an asynchronous gate, not an output emitter. Calling it without returning the result does not supply the workflow's output. Use `return null` for an intentional empty result.

Both `validate` and `run` reject obvious straight-line `run()` bodies with no value-returning statement (including bare `return;`), and direct unshadowed `report()` calls with missing options or a literal options object missing `gate`, before any agents launch. These are conservative syntax checks, not full control-flow or type analysis: complex branches, dynamic options, spreads, and shadowed helper names remain runtime-validated. A successful validation does not prove every execution path returns a value or every gate is callable.

## Background execution

Runs default to background; explicit foreground fails before work starts. Both Workflows and [Background](../background/README.md) must be loaded in a persistent session; missing service fails clearly, without foreground fallback. `list` and `validate` remain nonexecuting saved-definition operations.

```json
{
  "action": "run",
  "execution": "background",
  "script": "export const meta = { name: 'inspect', description: 'Inspect one question' }; export async function run() { return await agent('Explain what a closure captures', { intent: 'Explain closures', capabilities: [], profile: 'fast' }); }"
}
```

Admission resolves and validates inline/named source, clones arguments/configuration, pins cwd and the model-registry handle, and persists the exact source before starting. Later named-file edits do not affect that run. Central subagent policy/model resolution still occurs through the existing curated API on each call; background grants no additional authority.

One execution owns the entire workflow, including awaited agents/verifiers; children are never detached Background jobs. The original absolute workflow deadline, per-attempt timeouts, concurrency, retries, logical-call limits and token ledger remain authoritative. The one-line widget shows state and name, nonzero running/done/failed/canceled logical-child counts, reported cumulative tokens and elapsed time. Retries reuse a logical child but accumulate usage across attempts. Uninvoked parallel thunks are not queued agents; only admitted children count. Phase and detailed child activity remain inspectable, not a proxy for stalled work. Continue independent authorized work while awaiting one automatic outcome notification; do not duplicate child work or change files under review. Yield when no useful independent work remains rather than polling. Use `executions`, then `inspect`, `cancel`, or terminal-only `dismiss` with the returned ID.

Inspection returns bounded accounting plus `resultFile` and exact-source references. Read `resultFile` for the complete final result, failure counts, typed cause and recovery/diagnostic paths. Rejected gates, failed branches, and explicitly incomplete review results are not labeled successful. A successfully executed workflow is still not acceptance: findings, qualification gaps and the returned report remain authoritative. Cancellation closes admission, aborts children and drains them before settlement. Background shutdown/navigation marks interruption immediately, preserves references and aborts work; cooperative draining may subsequently finalize the referenced outcome file. A pending file after process exit is incomplete evidence, never success. Restoration never replays/resumes work.

Outcome files live in owner-only `${tmpdir()}/pi-workflow-outcome-*` directories, with mode-0600 `result.json`. They contain returned data/tool details and can contain sensitive model output; no automatic outbound disclosure. They have no automatic expiry and must be retained with the Background sidecar/session. Source and compressed abnormal-recovery files retain their existing seven-day policies. Failed outcome storage is reported as failure, not success. Background accounting is separate from Pi native session totals; inspection does not charge usage again. See [Background API](../background/API.md) for shared retention, controls and notification semantics.

## Script globals

| Global                              | Contract                                                                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent(prompt, options)`            | Requires non-empty `intent`, explicit read-only `capabilities` (including `[]`), and `profile`. Optional `output`, `retries`, and `timeoutMs`.                                               |
| `verify(claim, options)`            | Requires the same explicit execution fields plus optional `context`, retries, and timeout. Uses a fixed strict verdict schema and resolves `{ ok, reasons }`; it is not a reviewer identity. |
| `report(value, { gate })`           | Returns the original value only for `true` or `{ ok: true }`; otherwise throws `workflow_report_rejected`.                                                                                   |
| `parallel(thunks, options?)`        | Bounded, input-ordered fan-out. Failed branches are logged and become `null`.                                                                                                                |
| `parallelSettled(thunks, options?)` | Returns typed success/failure records without throwing branch failures.                                                                                                                      |
| `pipeline(items, ...stages)`        | Sequential stages per item, parallel across items.                                                                                                                                           |
| `phase(name)` / `log(value)`        | Bounded progress metadata.                                                                                                                                                                   |
| `budget`                            | Frozen advisory token/run mirror; host enforcement is authoritative.                                                                                                                         |
| `args` / `cwd`                      | Tool arguments and call cwd.                                                                                                                                                                 |

`parallel()` represents failed branches as `null`; use `parallelSettled()` when completeness or per-branch failure accounting matters. Never silently discard failed required branches.

Workflow options cannot name agents, select exact models or effort, request raw tools/extensions/environment, or rely on hidden defaults. The host routes every request through the subagents extension's centralized capability/profile policy and live model registry.

Retries are clamped to 0–2. Omit `timeoutMs` normally to use configured `agentTimeoutMs` (default 10 minutes). A valid positive `timeoutMs` overrides that default, shorter or longer, separately for every attempt of an `agent()` or `verify()` call; it does not extend `workflowTimeoutMs` (default one hour), which bounds the entire run including later phases. Set an override only for a justified task-specific deadline, accounting for workload and profile. Avoid blanket short deadlines for substantial research, review, or strong-profile calls. Inspect effective settings with `/workflows-config`.

Structured output uses `{ output: { schema } }` and resolves to the validated value. Prefer it for research and fan-in boundaries that need machine-readable results; validated structured successes may be retained after abnormal termination, unlike successful prose. See Logging and retained output for retention limits.

## Saved workflows

Saved definitions are regular `<name>.js` files in `userWorkflowsDir`. Filename and literal `meta.name` must match lowercase kebab case. Files are loaded on every list/validate/run, so edits are visible without restart.

```json
{ "action": "list" }
{ "action": "validate", "name": "review" }
{ "action": "run", "name": "deep-research", "args": "Produce an exhaustive public-web report on WebAssembly browser support as of 2026-06-01, prioritizing browser vendor documentation." }
```

Inventory rejects unsafe names, symlinks, non-regular/unreadable/oversized files, filename/metadata mismatches, and parser failures. It is bounded to 200 candidates, 256 KiB per file, 2 MiB parsed source, and 32 KiB tool text.

### `deep-research`

Use only when the user explicitly requests deep research, asks to run this workflow, or approves a proposed deep-research run. Equivalent intent such as “produce an exhaustive research report” qualifies; exact wording is not required. Generic requests to research, investigate, compare, or check current documentation do not activate it. Default to targeted searches, source reads, or bounded read-only delegation. Do not automatically escalate because a question is broad.

Once authorized, use once per research question. Include an explicit as-of date or cutoff and any must-cover sources; review the report's coverage and limitations, then use targeted research for gaps instead of rerunning. This is caller-side routing guidance, not a runtime approval check: the question string alone cannot establish user authorization. Local, private, and authenticated sources are out of scope.

The shipped workflow accepts a non-empty question and uses exact routing:

- scope, synthesis, audit, and one repair: `[]`, `strong` profile;
- public-web search: `read-web`, `fast` profile, one retry;
- extraction and three claim-verification ballots: `read-web`, `strong` profile; extraction retries once.

It scopes up to five facets, extracts up to twelve public HTTPS sources, requires two verification votes plus authoritative/primary evidence or reputable independent secondary publishers, then audits the final cited report. One repair is allowed; a second failed audit rejects the report. Remote content is untrusted data. No branch receives MCP, shell, or filesystem-discovery capability from the workflow.

### `review`

The shipped review workflow accepts a caller-prepared evidence package. Target discovery, Git/GitHub retrieval, diff capture, and deterministic checks stay with the caller because the workflow sandbox cannot perform them safely. At least one `contextPaths` entry is required; reviewers may inspect those paths and declared changed files with `read-filesystem` only. The companion [`review` skill](../../skills/review/SKILL.md) is the interactive adapter: it prepares a patch and check evidence, invokes this workflow, and presents the deterministic report without adding a second review layer.

```json
{
  "action": "run",
  "name": "review",
  "args": {
    "target": { "kind": "working-tree", "label": "current changes" },
    "objective": "Implement the requested behavior",
    "acceptanceCriteria": ["The behavior is correct"],
    "changedFiles": ["src/example.ts"],
    "contextPaths": ["/tmp/review.patch", "AGENTS.md"],
    "checks": [{ "name": "tests", "status": "passed", "summary": "12 passed" }],
    "priorReviewContext": [],
    "knownGaps": [],
    "riskTags": [],
    "requestedLenses": []
  }
}
```

Target `kind` is one of `working-tree`, `branch`, `commit-range`, `pull-request`, `document`, or `other`. Check status is `passed`, `failed`, or `not-run`. Optional lenses are `architecture` and `performance`; risk tags `architecture`, `migration`, `multi-module`, or `public-api` add architecture, while `concurrency`, `database`, `hot-path`, or `performance` add performance.

One independent `balanced` reviewer covers acceptance, correctness, compatibility, security, failure behavior, and regression assurance by default, returning a consolidated evidence-backed batch without a mandatory adjudicator. Optional risk-selected lenses use the same policy; when multiple lenses return findings, exact duplicates are grouped before one `strong` adjudicator confirms, rejects, or defers each immutable group. Every group must be dispositioned once without inventing findings; invalid or failed adjudication produces an incomplete human-review report. Low-confidence single-reviewer findings and unsupported blocking categories require human judgment. Nonblocking suggestions remain visible without making the outcome blocking. The result is `{report, complete, outcome, deliveryScope, blockingGaps, qualificationLimitations}`. Markdown in `report` is deterministic and never claims merge readiness. `complete` describes required coverage, not absence of findings; preserve findings and failed checks separately. Failed checks, required missing evidence, reviewer failures, and unresolved candidates remain blocking. Qualification limitations remain visible without blocking an otherwise complete review for the authorized boundary.

Supply optional `deliveryScope: {boundary, requirements: [{id, description, requiredFor}]}` from authoritative criteria, then reference requirements using `requirementId` on checks and structured `knownGaps: [{code, detail, requirementId?}]`. Declare each independently required check as a separate requirement; aggregate labels cannot stand in for tests, typecheck, lint, and formatting separately. Each applicable requirement needs its own referenced passing check; duplicate mappings reject before launch. Only not-run checks/gaps confined to declared requirements outside the current boundary are nonblocking. Strings and unclassified gaps block; arbitrary nonblocking labels are not accepted. Without scope, legacy inputs retain conservative all-gaps-block behavior. Boundary names are opaque caller-defined evidence scopes, not workflow phases. Review covers the full supplied change and criteria; the caller owns scheduling and readiness. Complete review coverage is not delivery readiness. Caller-accepted exceptions remain separate dispositions; they never change failed/incomplete review results into success. See the [full input contract](../../skills/review/references/workflow-input.md) for a scoped example and limits.

Set `reviewMode: "confirmation"` after authorized repairs and provide original blockers, dispositions, repair scope, and affected boundaries in `priorReviewContext`. Confirmation focuses on those blockers, affected boundaries, and repair-induced regressions instead of unrestricted fresh review. `reviewMode` otherwise defaults to `initial`. Use a new `initial` review when scope or requirements expand beyond prior coverage; a boundary label alone does not require duplicate review. The caller owns repair authority, budgets, and persistence. The workflow itself never mutates code or manages repair allowances.

All model calls receive only `read-filesystem`; no review branch gets shell, web, MCP, or mutation authority. Repository artifacts, diffs, comments, and prior model output are treated as untrusted evidence. The workflow does not fix findings or loop back into implementation; rerun it against a newly prepared revision after repairs.

## Model and capability policy

`profile` accepts only `fast`, `balanced`, or `strong`. Profile model/effort pairs and the capability ceiling come exclusively from `extension:subagents`; workflows have no profile overrides or fallback to parent/named definitions. Unknown profiles, globally disallowed capabilities, unresolved models, and model-unsupported efforts fail closed through `runSubagent()`.

The sandbox receives capability and profile names, never full model selectors, effort values, or process authority. `capabilities: []` still loads normal Pi project context files by design, while child skills/templates remain disabled.

## Verification, retries, and budgets

`verify()` composes a strict `{ confirmed: boolean, reasons: string[] }` output contract. A supported refutation is data; process/provider/structured failures remain ordinary agent failures. `report()` is the terminating gate and does not create open-ended fix loops.

`maxAgentsPerRun` counts policy-valid logical calls; retries reuse the slot. `maxTokensPerRun` accounts streamed usage across attempts. Crossing a positive token limit is sticky: active calls abort, and retries/new calls fail with `workflow_budget_exceeded`. Run-cap denial uses `workflow_run_cap_exceeded` without aborting admitted work. The sandbox budget mirror may lag and is advisory.

Failures preserve distinct codes for policy, provider/schema, structured output, per-agent timeout, workflow timeout/cancellation, budget, run cap, report rejection, missing result, and script failure. `parallel()` and `parallelSettled()` preserve separate final agent/logged/settled failure counts.

## Safety boundary

Scripts reject imports, `require`, filesystem/network/process/global/buffer/worker/timer APIs, clocks, randomness, performance counters, and cryptography. Execution uses a separate Node child with an empty environment, permission mode, no filesystem/network/child-process grants, and string code generation disabled. The extension fails closed when required Node flags are unavailable.

The host treats sandbox RPC as untrusted. It validates required execution fields and output schemas, controls retries/timeouts/budgets, and passes only sanitized requests to `runSubagent()`. Both sandbox validation and host admission reject `write-filesystem` and `exec-shell`; workflow children may use only `read-filesystem`, `read-mcp`, `read-web`, or no tools. Unknown and retired capability names are rejected by both boundaries.

## Rendering

Background admission/executions/inspect/cancel/dismiss have contextual one-line summaries, with uncertainty/no-replay guidance before optional identity and retained details on expansion. These use the shared Background control renderer; no raw source or arbitrary result previews appear collapsed. Inline run titles statically extract literal metadata names; inspect/cancel/dismiss titles show the requested short ID. Inspection retains lifecycle state and any bounded adapter failure cause alongside actionable warnings. Ordinary success uses green `succeeded` without generic effects-may-persist boilerplate; failure is red and cancellation yellow. Admission, cancellation requests and attention dismissal remain distinct.

Immediate list/validate show a call row with action and optional saved name plus a flush-left count/validation result. Background run controls summarize admission and inspection; expanded inspection holds agent progress in chronological start order. Compact capability labels are `fs`, `mcp`, and `web`; empty sets are omitted. List output shows only its saved count when collapsed, with the saved inventory on expansion; validate remains a concise status line. Expanding tool output preserves the header and progress rows, then adds workflow logs, failure metadata, retained paths, the list store path, invalid-entry diagnostics, or the validated source path as applicable. The call title is emphasized; renderer-authored tool lines do not use middle-dot separators or status icons. Execution and child progress use explicit state words with semantic colors; saved definitions say `valid`/`invalid`, never execution success. Dynamic text is control-normalized, bounded, and width-aware. Raw prompts, scripts, secrets, and compressed contents are never rendered.

## Configuration

Settings live under `extension:workflows`. Global, project, and valid environment values use normal precedence. Use `/workflows-config` to inspect effective values and `/workflows-list` for inventory.

| Field                     | Default                | Environment override                   | Description                                                              |
| ------------------------- | ---------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| `workflowTimeoutMs`       | `3600000`              | `WORKFLOWS_WORKFLOW_TIMEOUT_MS`        | Whole-run timeout in milliseconds.                                       |
| `agentTimeoutMs`          | `600000`               | `WORKFLOWS_AGENT_TIMEOUT_MS`           | Default per-attempt agent/verify timeout; call `timeoutMs` overrides it. |
| `maxConcurrency`          | `4`                    | `WORKFLOWS_MAX_CONCURRENCY`            | Sandbox scheduler limit, clamped to 16.                                  |
| `maxTokensPerRun`         | `0`                    | `WORKFLOWS_MAX_TOKENS_PER_RUN`         | Observed-token limit; `0` disables.                                      |
| `maxAgentsPerRun`         | `100`                  | `WORKFLOWS_MAX_AGENTS_PER_RUN`         | Logical-call limit; `0` disables.                                        |
| `maxVisibleSettledAgents` | `5`                    | `WORKFLOWS_MAX_VISIBLE_SETTLED_AGENTS` | Settled progress rows shown; `0` shows running agents only.              |
| `userWorkflowsDir`        | `<agentDir>/workflows` | `WORKFLOWS_USER_WORKFLOWS_DIR`         | Saved definition directory; relative paths resolve from call cwd.        |

```json
{
  "extension:workflows": {
    "workflowTimeoutMs": 3600000,
    "agentTimeoutMs": 600000,
    "maxConcurrency": 4,
    "maxTokensPerRun": 0,
    "maxAgentsPerRun": 100,
    "maxVisibleSettledAgents": 5,
    "userWorkflowsDir": "/Users/example/.pi/agent/workflows"
  }
}
```

The removed workflow model-tier fields and environment variables remain ignored with diagnostics. Configure profiles under `extension:subagents`.

## Logging and retained output

Every run persists an exact owner-only source copy under the system temporary workflow-script directory before sandbox execution. Source copies are lazily removed after seven days. Background outcomes use the retained files described above.

After abnormal termination, settled structured successes and typed failures may be retained in one owner-only `.json.gz` recovery envelope under `${tmpdir()}/pi-retained-diagnostics`. It excludes prompts, workflow args, successful prose, raw activity/stdout/stderr, tool traces, environment, credentials, and source. It may include identity/policy metadata, timings, attempts, effective timeouts, usage, validated structured values, failures, and child-log paths.

Recovery files share the subagent diagnostic pool's seven-day lazy retention and 1 GiB compressed quota. Persistence failure never replaces the original workflow cause. Spillover files are separate and may contain raw model/tool output. Compression is not sanitization; inspect retained files explicitly and never send them to a provider without review.

## Limitations

- No project workflow stores, workflow mutation actions, nested workflows, independent background manager, or arbitrary script paths.
- No writable coordination, worktrees, parallel implementation, session inheritance, resume/replay, or response cache.
- No arbitrary model IDs, workflow-local profile maps, named-agent compatibility, hidden defaults, or generic quality framework beyond `verify()`/`report()`.

## Troubleshooting

- `workflow must call agent() or verify()`: add a direct syntactic call.
- `agent intent/capabilities/profile...`: provide every required execution field explicitly.
- `agent_policy_rejected`: inspect `/subagents-config` for capability, profile, model, or configured-effort policy.
- `run() must return a result` / `workflow_missing_result`: return a value from `run()` itself, not only a nested callback; use `null` for an intentional empty result. Complex missing-return paths are detected at runtime.
- `report() requires options with a callable gate`: use `return await report(value, { gate: () => verdict })`; for ungated output, simply `return value`.
- Saved workflow invalid/unknown: inspect `workflow list`, `/workflows-list`, and strict filename/metadata identity.
- `agent_timeout`: that child's effective deadline expired. `workflow_timeout`: the whole-run deadline expired and active children were canceled. Neither proves the work stalled. Inspect the effective deadline, progress, failure details (use `parallelSettled()` for per-branch records), and any recovery artifact before deciding on a new run. Preserve useful completed results and target missing work instead of blindly repeating the whole fan-out; recovery does not automatically resume a run.
- Retry only transient read-only calls; policy, cap, budget, timeout, cancellation, and permanent schema failures are not retry classes.

## Prior art

- [Claude Code dynamic workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) — model-authored JavaScript fan-out.
- [Michaelliv/pi-dynamic-workflows](https://github.com/michaelliv/pi-dynamic-workflows) — deterministic Pi workflow globals and foreground progress.
- [@quintinshaw/pi-dynamic-workflows](https://pi.dev/packages/@quintinshaw/pi-dynamic-workflows) — broader adjacent workflow patterns.
