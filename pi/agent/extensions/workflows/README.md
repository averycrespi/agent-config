# workflows extension

Foreground deterministic JavaScript orchestration for bounded research, review, verification, and audit workflows. Workflow code runs in a permissioned child process; privileged subagent policy, model resolution, accounting, cancellation, and retention stay host-side.

This is read-mostly orchestration, not parallel implementation or workspace mutation.

## Tool

`workflow` accepts:

| Action     | Fields                                                             |
| ---------- | ------------------------------------------------------------------ |
| `list`     | No other fields; returns the current saved-workflow inventory.     |
| `validate` | Exactly one of `script` or `name`; parses without execution.       |
| `run`      | Exactly one of `script` or `name`, plus optional cloneable `args`. |

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

It scopes up to five facets, extracts up to twelve public HTTPS sources, requires two verification votes plus authoritative/primary evidence or reputable independent secondary publishers, then audits the final cited report. One repair is allowed; a second failed audit rejects the report. Remote content is untrusted data. No branch receives broker, shell, or filesystem-discovery capability from the workflow.

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

Supply optional `deliveryScope: {boundary, requirements: [{id, description, requiredFor}]}` from authoritative criteria, then reference requirements using `requirementId` on checks and structured `knownGaps: [{code, detail, requirementId?}]`. Declare each independently required check as a separate requirement; aggregate labels cannot stand in for tests, typecheck, lint, and formatting separately. Each applicable requirement needs its own referenced passing check; duplicate mappings reject before launch. Only not-run checks/gaps confined to declared requirements outside the current boundary are nonblocking. Strings and unclassified gaps block; arbitrary nonblocking labels are not accepted. Without scope, legacy inputs retain conservative all-gaps-block behavior. See the [full input contract](../../skills/review/references/workflow-input.md) for a scoped example and limits.

Set `reviewMode: "confirmation"` after authorized repairs and provide original blockers, dispositions, repair scope, and affected boundaries in `priorReviewContext`. Confirmation focuses on those blockers, affected boundaries, and repair-induced regressions instead of unrestricted fresh review. `reviewMode` otherwise defaults to `initial`. Use a new `initial` review when the delivery boundary or requirements expand; unchanged HEAD does not make prior local qualification sufficient. The owning ticket session persists repair consumption before editing, with two cycles by default and explicit additive authorization only for new local follow-up scope. The workflow itself never mutates code or resets that allowance.

All model calls receive only `read-filesystem`; no review branch gets shell, web, broker, or mutation authority. Repository artifacts, diffs, comments, and prior model output are treated as untrusted evidence. The workflow does not fix findings or loop back into implementation; rerun it against a newly prepared revision after repairs.

## Model and capability policy

`profile` accepts only `fast`, `balanced`, or `strong`. Profile model/effort pairs and the capability ceiling come exclusively from `extension:subagents`; workflows have no profile overrides or fallback to parent/named definitions. Unknown profiles, globally disallowed capabilities, unresolved models, and model-unsupported efforts fail closed through `runSubagent()`.

The sandbox receives capability and profile names, never full model selectors, effort values, or process authority. `capabilities: []` still loads normal Pi project context files by design, while child skills/templates remain disabled.

## Verification, retries, and budgets

`verify()` composes a strict `{ confirmed: boolean, reasons: string[] }` output contract. A supported refutation is data; process/provider/structured failures remain ordinary agent failures. `report()` is the terminating gate and does not create open-ended fix loops.

`maxAgentsPerRun` counts policy-valid logical calls; retries reuse the slot. `maxTokensPerRun` accounts streamed usage across attempts. Crossing a positive token limit is sticky: active calls abort, and retries/new calls fail with `workflow_budget_exceeded`. Run-cap denial uses `workflow_run_cap_exceeded` without aborting admitted work. The sandbox budget mirror may lag and is advisory.

Failures preserve distinct codes for policy, provider/schema, structured output, per-agent timeout, workflow timeout/cancellation, budget, run cap, report rejection, missing result, and script failure. `parallel()` and `parallelSettled()` preserve separate final agent/logged/settled failure counts.

## Safety boundary

Scripts reject imports, `require`, filesystem/network/process/global/buffer/worker/timer APIs, clocks, randomness, performance counters, and cryptography. Execution uses a separate Node child with an empty environment, permission mode, no filesystem/network/child-process grants, and string code generation disabled. The extension fails closed when required Node flags are unavailable.

The host treats sandbox RPC as untrusted. It validates required execution fields and output schemas, controls retries/timeouts/budgets, and passes only sanitized requests to `runSubagent()`. Both sandbox validation and host admission reject `write-filesystem` and `exec-shell`; workflow children may use only `read-filesystem`, `read-broker`, `read-web`, or no tools.

## Rendering

The separate call row is suppressed, and every result starts with one width-truncated header identifying `workflow run <name>`, `workflow list`, or `workflow validate <name>`. Run output shows agent progress by default in chronological start order, with the newest at the bottom, using the shared two-line grammar: status, intent, duration, and tool/token counts first; then profile, compact capabilities, timeout metadata, and volatile activity last. Compact capability labels are `fs`, `broker`, and `web`; empty sets are omitted. List output shows the saved inventory by default, while validate remains a concise status line. Expanding tool output preserves the header and progress rows, then adds workflow logs, failure metadata, retained paths, the list store path, invalid-entry diagnostics, or the validated source path as applicable. The tool title is emphasized while separators and supporting metadata stay muted. Dynamic text is control-normalized, bounded, and width-aware. Raw prompts, scripts, secrets, and compressed contents are never rendered.

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

Every run persists an exact owner-only source copy under the system temporary workflow-script directory before sandbox execution. Source copies are lazily removed after seven days. Successful workflow results are not journaled.

After abnormal termination, settled structured successes and typed failures may be retained in one owner-only `.json.gz` recovery envelope under `${tmpdir()}/pi-retained-diagnostics`. It excludes prompts, workflow args, successful prose, raw activity/stdout/stderr, tool traces, environment, credentials, and source. It may include identity/policy metadata, timings, attempts, effective timeouts, usage, validated structured values, failures, and child-log paths.

Recovery files share the subagent diagnostic pool's seven-day lazy retention and 1 GiB compressed quota. Persistence failure never replaces the original workflow cause. Spillover files are separate and may contain raw model/tool output. Compression is not sanitization; inspect retained files explicitly and never send them to a provider without review.

## Limitations

- No project workflow stores, workflow mutation actions, nested workflows, background manager, or arbitrary script paths.
- No writable coordination, worktrees, parallel implementation, session inheritance, resume/replay, successful-run journal, or response cache.
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
