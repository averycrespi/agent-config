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
          modelTier: "medium",
          thinking: "high",
        }),
    ),
  );
  const verdict = await verify("These findings are evidence-backed", {
    intent: "Verify findings",
    capabilities: ["read-filesystem"],
    modelTier: "large",
    thinking: "high",
    context: findings,
  });
  return await report(findings, { gate: () => verdict });
}
```

## Script globals

| Global                              | Contract                                                                                                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent(prompt, options)`            | Requires non-empty `intent`, explicit `capabilities` (including `[]`), `modelTier`, and `thinking`. Optional `output`, `retries`, and `timeoutMs`.                                           |
| `verify(claim, options)`            | Requires the same explicit execution fields plus optional `context`, retries, and timeout. Uses a fixed strict verdict schema and resolves `{ ok, reasons }`; it is not a reviewer identity. |
| `report(value, { gate })`           | Returns the original value only for `true` or `{ ok: true }`; otherwise throws `workflow_report_rejected`.                                                                                   |
| `parallel(thunks, options?)`        | Bounded, input-ordered fan-out. Failed branches are logged and become `null`.                                                                                                                |
| `parallelSettled(thunks, options?)` | Returns typed success/failure records without throwing branch failures.                                                                                                                      |
| `pipeline(items, ...stages)`        | Sequential stages per item, parallel across items.                                                                                                                                           |
| `phase(name)` / `log(value)`        | Bounded progress metadata.                                                                                                                                                                   |
| `budget`                            | Frozen advisory token/run mirror; host enforcement is authoritative.                                                                                                                         |
| `args` / `cwd`                      | Tool arguments and call cwd.                                                                                                                                                                 |

Workflow options cannot name agents, select exact models, raw tools/extensions/environment, or rely on hidden defaults. The host routes every request through the subagents extension's centralized capability/tier/thinking policy and live model registry.

Retries are clamped to 0–2. A valid positive `timeoutMs` shorter than the configured default applies to every retry attempt for that logical call. Structured output uses `{ output: { schema } }` and resolves to the validated value.

## Saved workflows

Saved definitions are regular `<name>.js` files in `userWorkflowsDir`. Filename and literal `meta.name` must match lowercase kebab case. Files are loaded on every list/validate/run, so edits are visible without restart.

```json
{ "action": "list" }
{ "action": "validate", "name": "review" }
{ "action": "run", "name": "deep-research", "args": "What changed?" }
```

Inventory rejects unsafe names, symlinks, non-regular/unreadable/oversized files, filename/metadata mismatches, and parser failures. It is bounded to 200 candidates, 256 KiB per file, 2 MiB parsed source, and 32 KiB tool text.

### `deep-research`

The shipped workflow accepts a non-empty question and uses exact routing:

- scope, synthesis, audit, and one repair: `[]`, large tier, high thinking;
- public-web search: `read-web`, small tier, medium thinking, one retry;
- extraction and three claim-verification ballots: `read-web`, large tier, high thinking; extraction retries once.

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

Three core medium/high reviewers cover behavior, assurance, and maintainability in parallel. They return strict evidence-backed finding batches. Exact duplicates are grouped before one large/high adjudicator confirms, rejects, or sends each immutable group for human judgment. The workflow validates that every exact group is dispositioned once without splitting, combining, rewriting, or inventing findings, and falls back to an incomplete human-review report if adjudication fails semantically or operationally. Final Markdown is rendered deterministically; it never claims merge readiness. Failed or missing checks, reviewer failures, model-reported gaps, and unresolved candidates remain visible.

All model calls receive only `read-filesystem`; no review branch gets shell, web, broker, or mutation authority. Repository artifacts, diffs, comments, and prior model output are treated as untrusted evidence. The workflow does not fix findings or loop back into implementation; rerun it against a newly prepared revision after repairs.

## Model and capability policy

`modelTier` accepts only `small`, `medium`, or `large`. Selectors and allowed thinking/capabilities come exclusively from `extension:subagents`; workflows have no model-tier settings or fallback to parent/named definitions. Unknown, globally disallowed, unresolved, or model-unsupported values fail closed through `runSubagent()`.

The sandbox receives capability names and tier/thinking strings, never full model selectors or process authority. `capabilities: []` still loads normal Pi project context files by design, while child skills/templates remain disabled.

## Verification, retries, and budgets

`verify()` composes a strict `{ confirmed: boolean, reasons: string[] }` output contract. A supported refutation is data; process/provider/structured failures remain ordinary agent failures. `report()` is the terminating gate and does not create open-ended fix loops.

`maxAgentsPerRun` counts policy-valid logical calls; retries reuse the slot. `maxTokensPerRun` accounts streamed usage across attempts. Crossing a positive token limit is sticky: active calls abort, and retries/new calls fail with `workflow_budget_exceeded`. Run-cap denial uses `workflow_run_cap_exceeded` without aborting admitted work. The sandbox budget mirror may lag and is advisory.

Failures preserve distinct codes for policy, provider/schema, structured output, per-agent timeout, workflow timeout/cancellation, budget, run cap, report rejection, missing result, and script failure. `parallel()` and `parallelSettled()` preserve separate final agent/logged/settled failure counts.

## Safety boundary

Scripts reject imports, `require`, filesystem/network/process/global/buffer/worker/timer APIs, clocks, randomness, performance counters, and cryptography. Execution uses a separate Node child with an empty environment, permission mode, no filesystem/network/child-process grants, and string code generation disabled. The extension fails closed when required Node flags are unavailable.

The host treats sandbox RPC as untrusted. It validates required execution fields and output schemas, controls retries/timeouts/budgets, and passes only sanitized requests to `runSubagent()`. Workflow JavaScript cannot mutate the parent workspace directly, but a deliberately requested `exec-shell` capability can mutate through its subagent and should not be used for read-mostly workflows.

## Rendering

Collapsed tool output is always one width-truncated aggregate line; the separate call row is suppressed. Headers identify every action explicitly as `workflow run <name>`, `workflow list`, or `workflow validate <name>`. Expanded output preserves that exact line, then adds workflow details. Runs place intent-first subagent rows in chronological start order, with the newest at the bottom; list and validate actions add inventory or source details. Rows show capability/tier/thinking, status, duration, tool/token counts, typed errors, logs, and diagnostic paths. The tool title is emphasized while separators and supporting metadata stay muted. Dynamic text is control-normalized, bounded, and width-aware. Raw prompts, scripts, secrets, and compressed contents are never rendered.

## Configuration

Settings live under `extension:workflows`. Global, project, and valid environment values use normal precedence. Use `/workflows-config` to inspect effective values and `/workflows-list` for inventory.

| Field                     | Default                | Environment override                   | Description                                                       |
| ------------------------- | ---------------------- | -------------------------------------- | ----------------------------------------------------------------- |
| `workflowTimeoutMs`       | `3600000`              | `WORKFLOWS_WORKFLOW_TIMEOUT_MS`        | Whole-run timeout in milliseconds.                                |
| `agentTimeoutMs`          | `600000`               | `WORKFLOWS_AGENT_TIMEOUT_MS`           | Default logical-call timeout.                                     |
| `maxConcurrency`          | `4`                    | `WORKFLOWS_MAX_CONCURRENCY`            | Sandbox scheduler limit, clamped to 16.                           |
| `maxTokensPerRun`         | `0`                    | `WORKFLOWS_MAX_TOKENS_PER_RUN`         | Observed-token limit; `0` disables.                               |
| `maxAgentsPerRun`         | `100`                  | `WORKFLOWS_MAX_AGENTS_PER_RUN`         | Logical-call limit; `0` disables.                                 |
| `maxVisibleSettledAgents` | `5`                    | `WORKFLOWS_MAX_VISIBLE_SETTLED_AGENTS` | Settled rows shown when expanded; `0` shows running only.         |
| `userWorkflowsDir`        | `<agentDir>/workflows` | `WORKFLOWS_USER_WORKFLOWS_DIR`         | Saved definition directory; relative paths resolve from call cwd. |

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

The removed workflow model-tier fields and environment variables are ignored with diagnostics; configure all three tiers under `extension:subagents`.

## Logging and retained output

Every run persists an exact owner-only source copy under the system temporary workflow-script directory before sandbox execution. Source copies are lazily removed after seven days. Successful workflow results are not journaled.

After abnormal termination, settled structured successes and typed failures may be retained in one owner-only `.json.gz` recovery envelope under `${tmpdir()}/pi-retained-diagnostics`. It excludes prompts, workflow args, successful prose, raw activity/stdout/stderr, tool traces, environment, credentials, and source. It may include identity/policy metadata, timings, attempts, effective timeouts, usage, validated structured values, failures, and child-log paths.

Recovery files share the subagent diagnostic pool's seven-day lazy retention and 1 GiB compressed quota. Persistence failure never replaces the original workflow cause. Spillover files are separate and may contain raw model/tool output. Compression is not sanitization; inspect retained files explicitly and never send them to a provider without review.

## Limitations

- No project workflow stores, workflow mutation actions, nested workflows, background manager, or arbitrary script paths.
- No writable coordination, worktrees, parallel implementation, session inheritance, resume/replay, successful-run journal, or response cache.
- No arbitrary model IDs, workflow-local tier maps, named-agent compatibility, hidden defaults, or generic quality framework beyond `verify()`/`report()`.

## Troubleshooting

- `workflow must call agent() or verify()`: add a direct syntactic call.
- `agent intent/capabilities/modelTier/thinking...`: provide every required execution field explicitly.
- `agent_policy_rejected`: inspect `/subagents-config` for capability, tier, model, or thinking policy.
- `workflow_missing_result`: return a value; use `null` for an intentional empty result.
- Saved workflow invalid/unknown: inspect `workflow list`, `/workflows-list`, and strict filename/metadata identity.
- Retry only transient read-only calls; policy, cap, budget, timeout, cancellation, and permanent schema failures are not retry classes.

## Prior art

- [Claude Code dynamic workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) — model-authored JavaScript fan-out.
- [Michaelliv/pi-dynamic-workflows](https://github.com/michaelliv/pi-dynamic-workflows) — deterministic Pi workflow globals and foreground progress.
- [@quintinshaw/pi-dynamic-workflows](https://pi.dev/packages/@quintinshaw/pi-dynamic-workflows) — broader adjacent workflow patterns.
