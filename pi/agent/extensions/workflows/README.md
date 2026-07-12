# workflows extension

The `workflows` extension provides a foreground `workflow` tool for deterministic JavaScript orchestration. A workflow can fan out read-mostly subagents, verify claims, gate reports, and return a compact result while the host enforces concurrency and run budgets.

This is a Phase 1 implementation for research, review, audit, and exploration—not parallel implementation or workspace mutation.

## Tool

### `workflow`

| Field    | Required | Description                                                                              |
| -------- | -------- | ---------------------------------------------------------------------------------------- |
| `script` | Yes      | Raw JavaScript source starting with literal `export const meta = { name, description }`. |
| `args`   | No       | Any JSON value exposed to the script as `args`.                                          |

The script must contain a syntactic direct `agent()` or `verify()` call. The tool runs in the foreground, streams compact phase/subagent progress, and reports agent failures separately from handled `parallel()` and `parallelSettled()` branch failures. Large final output uses the shared spillover helper.

```js
export const meta = {
  name: "repo-audit",
  description: "Audit and verify repository concerns",
};

export async function run() {
  phase("inspect");
  const findings = await parallel(
    ["tests", "docs", "security"].map(
      (topic) => () =>
        agent(`Audit the repository for ${topic} issues.`, {
          agent: "explorer",
          intent: topic,
          model: "small",
        }),
    ),
  );
  return await report(findings, {
    gate: (value) =>
      verify(`These findings are evidence-backed: ${JSON.stringify(value)}`),
  });
}
```

## Script globals

| Global            | Description                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`           | `agent(prompt, { agent?, intent?, output?, model?, retries?, timeoutMs? })` runs one read-mostly subagent. It defaults to `explorer`. Structured `output: { schema }` resolves to the parsed value. `model` accepts only configured `"small"` or `"big"` aliases. Retries are clamped to 0–2. |
| `verify`          | `verify(claim, { agent?, intent?, context?, model?, retries?, timeoutMs? })` asks a structured verifier, defaulting to `reviewer`, and resolves `{ ok, reasons }`. A supported refutation is data (`ok: false`); execution or structured-output failures reject like `agent()`.               |
| `report`          | `report(value, { gate })` awaits `gate(value)` and returns the original value only for `true` or `{ ok: true }`. Other verdicts reject with `workflow_report_rejected`; string-array verdict reasons are normalized into the error. Gate exceptions propagate unchanged.                      |
| `budget`          | Frozen advisory facade with `total`, `spent()`, `remaining()`, `launched`, and `maxAgents`. Disabled limits appear as `null`; unlimited token remaining is `Infinity`. Updates can lag, so authoritative enforcement is host-side.                                                            |
| `parallel`        | Runs thunks with bounded concurrency and input ordering. Failures are logged and become `null`.                                                                                                                                                                                               |
| `parallelSettled` | Uses the same scheduler and returns `{ ok: true, value }` or `{ ok: false, error: { code, message, details? } }`.                                                                                                                                                                             |
| `pipeline`        | Runs sequential stages per item while using `parallel()` across items.                                                                                                                                                                                                                        |
| `phase` / `log`   | Updates the current phase or adds a progress log.                                                                                                                                                                                                                                             |
| `args` / `cwd`    | Tool-call JSON arguments and the current working-directory string.                                                                                                                                                                                                                            |

The scheduler defaults to four concurrent thunks, is configurable up to a host ceiling of 16, and clamps each `parallel(..., { concurrency })` request to the effective limit. Final workflow results must be structured-cloneable; return budget values by calling `spent()` and `remaining()` rather than spreading the facade, whose methods are functions.

## Structured output and verification

Use `output` when fan-in needs machine-readable values. The host forwards only `{ output: { schema } }` through the curated subagents API. The child uses the generic `structured-output` extension, and the host validates plain JSON Schema `type`, `required`, `properties`, `items`, `enum`, `const`, and `additionalProperties: false`.

Failures such as `structured_output_not_called`, `structured_output_incomplete`, `structured_output_malformed`, and `structured_output_invalid` compose with `parallel()` and `parallelSettled()` like other agent failures. `verify()` uses the same path with a strict `{ confirmed: boolean, reasons: string[] }` schema.

```js
export const meta = { name: "verify", description: "Verify a release claim" };

export async function run() {
  const verdict = await verify(
    "All acceptance criteria have concrete evidence",
    {
      context: { checks: args.checks },
      model: "big",
    },
  );
  return await report(args, { gate: () => verdict });
}
```

## Budgets and failures

`maxAgentsPerRun` counts policy-valid logical `agent()` calls. Retry attempts reuse the same slot. Reaching this cap rejects later calls with `workflow_run_cap_exceeded` but does not abort already admitted work.

`maxTokensPerRun` observes streamed child token usage across every retry attempt. Meeting or exceeding a positive limit is sticky: active subagents are aborted, retries and later spawns are prevented, and affected attempts fail with `workflow_budget_exceeded`. The sandbox process remains alive, allowing `parallelSettled()` to fan in prior successes and typed failures. Token accounting reacts to observed usage, so some overshoot is possible and the `budget` mirror is not a reservation system.

`workflow_report_rejected` is produced only when a report gate returns a non-passing verdict. A thrown gate error is not relabeled. Timeouts, parent cancellation, policy failures, and provider failures retain their own codes rather than being inferred from current budget state.

A normally returning workflow is still reported as completed when it deliberately handles branch failures. Final counters remain distinct:

- `agentFailureCount`: final failed logical agent calls after retries;
- `loggedBranchFailureCount`: failures caught by `parallel()`;
- `settledBranchFailureCount`: failures returned by `parallelSettled()`.

## Model aliases

Scripts never receive raw provider/model selectors. `model: "small"` and `model: "big"` cross the sandbox RPC only as aliases and are validated and resolved by the host. A configured requested tier overrides the selected agent definition's model and the parent model. Omitting `model` preserves agent-definition-then-parent fallback. Unknown or unconfigured aliases fail with `agent_policy_rejected` without spawning.

## Safety restrictions

Scripts are parsed before execution and reject imports, `require`, filesystem/network/worker/process/global/buffer/timer APIs, and nondeterministic clocks, randomness, performance counters, and cryptography. A direct `agent()` or `verify()` call is required; `report()` alone does not satisfy this guardrail.

Execution runs in a separate killable Node child process with an empty environment, Node permission mode enabled without filesystem, network, child-process, worker, addon, or inspector grants, and string code generation disabled. The process receives only deterministic workflow globals, `args`, `cwd`, alias strings, and advisory budget snapshots over IPC. `process` is hidden and `Math.random` is absent. The host validates every RPC request and permits only `explorer`, `scout`, `researcher`, `reviewer`, and `analyst`, always with `inheritSession: "none"`. Workflow spawning applies a fixed non-mutating tool allowlist, so `bash`, `write`, `edit`, and any other agent-definition tools outside that list are removed.

The extension fails closed when the active Node runtime does not support `--permission` and `--disallow-code-generation-from-strings`.

## Configuration

Configure `extension:workflows` in Pi settings. Environment variables override settings only when valid. Invalid settings fall back to defaults with a warning; invalid environment values warn and leave valid lower-precedence settings intact. Use `/workflows-config` to display all effective parsed fields. Model selectors are displayed as non-sensitive configuration.

| Field               | Default                     | Environment override            | Description                                                                        |
| ------------------- | --------------------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| `workflowTimeoutMs` | `3600000`                   | `WORKFLOWS_WORKFLOW_TIMEOUT_MS` | Positive integer whole-workflow timeout in milliseconds.                           |
| `agentTimeoutMs`    | `600000`                    | `WORKFLOWS_AGENT_TIMEOUT_MS`    | Positive integer default per-agent timeout in milliseconds.                        |
| `maxConcurrency`    | `4`                         | `WORKFLOWS_MAX_CONCURRENCY`     | Positive integer scheduler limit; values above 16 are clamped with a warning.      |
| `maxTokensPerRun`   | `0`                         | `WORKFLOWS_MAX_TOKENS_PER_RUN`  | Non-negative observed-token limit; `0` disables it.                                |
| `maxAgentsPerRun`   | `100`                       | `WORKFLOWS_MAX_AGENTS_PER_RUN`  | Non-negative logical-agent limit; `0` disables it.                                 |
| `modelTierSmall`    | `openai-codex/gpt-5.6-luna` | `WORKFLOWS_MODEL_TIER_SMALL`    | Trimmed full Pi model selector for the fixed `small` alias; empty is unconfigured. |
| `modelTierBig`      | `openai-codex/gpt-5.6-sol`  | `WORKFLOWS_MODEL_TIER_BIG`      | Trimmed full Pi model selector for the fixed `big` alias; empty is unconfigured.   |

```json
{
  "extension:workflows": {
    "workflowTimeoutMs": 3600000,
    "agentTimeoutMs": 600000,
    "maxConcurrency": 4,
    "maxTokensPerRun": 0,
    "maxAgentsPerRun": 100,
    "modelTierSmall": "openai-codex/gpt-5.6-luna",
    "modelTierBig": "openai-codex/gpt-5.6-sol"
  }
}
```

The default aliases use the `openai-codex` provider and require it to be authenticated. Override either selector when using another available Pi provider.

## Logging and retained output

The extension does not keep a workflow run database, scripts, budget journals, or model responses. Progress and ledger state live only for the active foreground call. A script may retain at most 100 `log()` entries of 2,000 characters each and 100 phase entries of 200 characters each; exceeding either entry cap fails the script, and the host independently enforces the same storage bounds. Subagent failures may produce retained logs through `subagents`. Shared spillover files under the system temp directory may contain raw model/tool output, are owner-readable, and are cleaned best-effort after the retention window.

## Limitations

- No background manager or `/workflows` navigator.
- No journaled resume, run IDs, saved workflows, response cache, or persistence.
- No writable workflow mode, parallel implementation, session inheritance, or git worktree coordination.
- No arbitrary script-selected model IDs or user-defined alias maps.
- No general quality-helper framework beyond the narrow `verify()` and `report()` primitives.

## Troubleshooting

- `script must start with...`: make literal metadata the first statement.
- `workflow must call agent() or verify()`: add a direct syntactic call; `report()` alone is not spawning work.
- `agent type ... is not allowed`: use a read-mostly built-in agent listed above.
- `model alias ... is not configured`: configure the corresponding fixed tier or omit `model`.
- `workflow sandbox exited`: check for an unsupported Node runtime, script error, infinite loop, timeout, or cancellation.
- Retryable provider failures may use `retries: 1`; policy, cap, budget, timeout, abort, and permanent provider schema failures are not retried.

## Prior art

- [Claude Code dynamic workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) — model-authored JavaScript orchestration for fan-out subagent work.
- [Michaelliv/pi-dynamic-workflows](https://github.com/michaelliv/pi-dynamic-workflows) — influenced the raw-script, deterministic-global, foreground-progress shape.
- [@quintinshaw/pi-dynamic-workflows](https://pi.dev/packages/@quintinshaw/pi-dynamic-workflows) — demonstrates broader background, navigation, journaling, saved-workflow, retry, and worktree ideas that remain out of scope here.
