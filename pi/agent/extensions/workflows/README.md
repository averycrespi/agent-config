# workflows extension

The `workflows` extension provides a foreground `workflow` tool for deterministic JavaScript orchestration. A workflow can fan out read-mostly subagents, verify claims, gate reports, and return a compact result while the host enforces concurrency and run budgets.

This is a Phase 1 implementation for research, review, audit, and exploration—not parallel implementation or workspace mutation.

## Tool and saved definitions

### `workflow`

`action` is always required. Pi's schema rejects missing, unknown, or incorrectly typed actions before execution. The accepted action-specific fields are:

| Action     | Fields                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------- |
| `list`     | No other fields. Returns the current saved-definition inventory.                         |
| `validate` | Exactly one of `script` or `name`; parses and validates without executing.               |
| `run`      | Exactly one of `script` or `name`, plus optional verbatim JSON `args` exposed to script. |

Inline and named runs use the same parser, sandbox, subagent policy, model aliases, concurrency, budgets, cancellation, and foreground lifecycle. Every script must start with literal `export const meta = { name, description }` and contain a syntactic direct `agent()` or `verify()` call.

```js
workflow({
  action: "run",
  args: { topics: ["tests", "docs", "security"] },
  script: `export const meta = {
    name: "repo-audit",
    description: "Audit and verify repository concerns",
  };

  export async function run() {
    phase("inspect");
    const findings = await parallel(
      args.topics.map((topic) => () => agent(
        \`Audit the repository for \${topic} issues.\`,
        { agent: "explorer", intent: topic, model: "small" },
      )),
    );
    return report(findings, {
      gate: (value) => verify(
        \`These findings are evidence-backed: \${JSON.stringify(value)}\`,
      ),
    });
  }`,
});
```

Saved definitions are ordinary `*.js` files in the one effective `userWorkflowsDir`. The filename stem and literal `meta.name` must be identical lowercase kebab-case values matching `^[a-z0-9][a-z0-9-]{0,63}$`; `meta.description` is the only other discovery metadata. The file body is the exact workflow source—there is no envelope, frontmatter, argument schema, or execution-policy metadata.

```js
workflow({ action: "list" });
workflow({ action: "validate", name: "repo-audit" });
workflow({ action: "run", name: "repo-audit", args: { scope: "tests" } });
```

Definitions are loaded on every list, validation, or named run, so file additions, edits, and removals are visible without restarting Pi. `/workflows-list` displays the same current inventory for users. Create or edit definitions with ordinary filesystem tools at the absolute paths shown by `/workflows-config` and listing output. Missing directories are treated as empty.

### Shipped saved workflows

This repository installs ordinary saved definitions into the default store through Stow:

| Workflow        | Input                   | Purpose                                                                       |
| --------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `deep-research` | Non-empty question text | Research public web sources, cross-check claims, and return one cited report. |

```js
workflow({
  action: "run",
  name: "deep-research",
  args: "What changed in the latest version of the example protocol?",
});
```

`deep-research` scopes up to five complementary facets, searches with the `small` model tier, extracts at most twelve public HTTPS sources with the `big` tier, and has three independent `big`-tier researchers adjudicate source-backed claims. A claim reaches the verified findings only with two verifier votes plus either one primary/authoritative source or reputable secondary evidence from at least two publishers with distinct canonical homepage hostnames. Search, fetch, and verifier failures are retained as limitations when at least one material claim remains verified.

The successful result is one Markdown report with an executive summary, verified findings and claim-level evidence, conflicts and unverified claims, assumptions, limitations, open questions, and methodology. A final reviewer audits the report against the internal evidence ledger. One repair is allowed; a second failed integrity audit rejects the report. The script admits at most 25 logical calls—below its explicit ceiling of 30—and retrieval calls retry at most once.

The public-web boundary is prompt-enforced in this version. Research prompts require public HTTPS sources and forbid local files, repository context, attachments, private systems, authenticated services, and broker tools, but the generic agent tool allowlist does not mechanically narrow those capabilities per saved workflow. Remote content remains untrusted data. Successful reports are returned to the conversation and are not retained as workflow artifacts.

Inventory ignores non-JavaScript files and directories. Unsafe names, unreadable or oversized files, symlinked entries, filename/metadata mismatches, and parser failures appear as invalid with diagnostics and cannot run. Processing is capped at 256 KiB per file, 200 candidate entries, 2 MiB aggregate parsed source, and 32 KiB of tool text; descriptions and diagnostics are single-line and capped. Listing marks truncation explicitly. Direct resolution of a validated name does not depend on the truncated inventory subset.

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

The scheduler defaults to four concurrent thunks, is configurable up to a host ceiling of 16, and clamps each `parallel(..., { concurrency })` request to the effective limit. Every workflow must export `run()` and return a value. A missing `run()` or a function that resolves `undefined` fails non-retryably with `workflow_missing_result`; return `null` for an explicit empty result. Other final results must be structured-cloneable. Return budget values by calling `spent()` and `remaining()` rather than spreading the facade, whose methods are functions.

An explicit positive `timeoutMs` below the configured default is valid. The host resolves the effective timeout once for each logical call, uses it across retries, and exposes it in expanded terminal diagnostics; the default is a fallback, not a minimum.

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

`workflow_report_rejected` is produced only when a report gate returns a non-passing verdict. A thrown gate error is not relabeled. Missing results, script errors, whole-workflow timeouts, parent cancellation, per-agent timeouts, policy failures, and provider failures retain distinct codes rather than being inferred from current budget state. Failed tool text reports the authoritative top-level cause plus completed, failed, timed-out, canceled, and outstanding counts.

A normally returning workflow is still reported as completed when it deliberately handles branch failures. Final counters remain distinct:

- `agentFailureCount`: final failed logical agent calls after retries;
- `loggedBranchFailureCount`: failures caught by `parallel()`;
- `settledBranchFailureCount`: failures returned by `parallelSettled()`.

## TUI rendering

Tool rows use compact action-oriented summaries by default. Running and completed workflows show the workflow name, agent counts, failures, phase when active, and elapsed time without exposing inline script source. Failed collapsed rows show one concise authoritative cause/count summary. Expand the tool row to inspect per-agent activity, effective timeout and typed failure metadata, recent workflow logs, saved inventory entries, validation source paths, and retained diagnostic paths.

Errors retain context instead of replacing the row with a bare exception: run failures keep the latest workflow and agent summary, while earlier failures identify the attempted action and saved workflow name when available. Dynamic workflow, agent, activity, warning, and path text is control-normalized, bounded, and width-aware. Compressed contents are never previewed or decompressed automatically.

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
| `userWorkflowsDir`  | `<agentDir>/workflows`      | `WORKFLOWS_USER_WORKFLOWS_DIR`  | Non-empty directory; relative values resolve against the current call's cwd.       |

```json
{
  "extension:workflows": {
    "workflowTimeoutMs": 3600000,
    "agentTimeoutMs": 600000,
    "maxConcurrency": 4,
    "maxTokensPerRun": 0,
    "maxAgentsPerRun": 100,
    "modelTierSmall": "openai-codex/gpt-5.6-luna",
    "modelTierBig": "openai-codex/gpt-5.6-sol",
    "userWorkflowsDir": "/Users/example/.pi/agent/workflows"
  }
}
```

The default aliases use the `openai-codex` provider and require it to be authenticated. Override either selector when using another available Pi provider.

This repository ships `pi/agent/workflows/deep-research.js`, so `make stow-pi` installs the default workflow store and definition under `<agentDir>/workflows`. Other saved definitions may be added there or kept in a different private directory through `userWorkflowsDir`. The configured store remains the only store; the extension does not add project lookup or precedence rules.

## Logging and retained output

Saved definitions persist until the user edits or removes them. After successful resolution and parsing, every `run` copies the exact original effective source into the dedicated owner-controlled system temporary `pi-workflow-scripts` directory before the sandbox starts. Directories are mode `0700`, artifacts are created exclusively at mode `0600`, existing files are never overwritten, and unsafe metadata/tool-call values cannot escape the directory. Persistence failure stops execution. Tool text and details report the immutable run-script path; named runs also report the saved source path.

Workflow script artifacts contain source only and are removed best-effort after seven days. Shared spillover files are separate, may contain raw model/tool output, and retain their own cleanup behavior. Progress and ledger state otherwise live only for the active foreground call. A script may retain at most 100 `log()` entries of 2,000 characters each and 100 phase entries of 200 characters each.

After a top-level abnormal termination, the host waits for every admitted child to acknowledge settlement, then may persist one versioned owner-only `.json.gz` recovery envelope under `${tmpdir()}/pi-retained-diagnostics`. It contains workflow/phase/request identity, timings, attempts, host-resolved effective timeouts, aggregate counts/usage, validated structured successes, typed terminal failures, and finalized child-log paths. It explicitly excludes prompts, workflow args, successful free-form prose, raw activity/stdout/stderr, tool traces/outputs, environment, credentials, and script source. Successful runs—including workflow-authored `partial` or `inconclusive` values—never journal results. Failures with no settled structured value or typed logical-call failure create no empty envelope.

Recovery files and compressed subagent logs share a fixed 1 GiB quota in compressed on-disk bytes and seven-day lazy cleanup. Oldest finalized recognized artifacts are evicted when necessary; active files, symlinks, directories, and unrelated files are ignored. An oversized artifact or persistence/lock/quota failure is discarded, the original workflow error remains authoritative, and bounded tool text reports the secondary warning. Tool/session output exposes only the finalized `.json.gz` path and bounded metadata. These files are sensitive; gzip is not sanitization or encryption. Inspect explicitly with `gzip -dc /path/to/file.json.gz` and never send an artifact to a provider without deliberate review.

## Limitations

- No project workflow stores, implicit `<cwd>/.pi/workflows`, directory walking, or precedence/shadowing between stores. The extension has no built-in definition registry; this repository's `deep-research.js` is an ordinary file in the configured saved-workflow store.
- No workflow-specific save, read, update, delete, import, export, or rename actions; use ordinary filesystem tools.
- No per-workflow slash commands, prompt templates, arbitrary `scriptPath`, or execution outside the configured store.
- No workflow-to-workflow composition, nested workflow RPC, recursion policy, background manager, or navigator.
- No journaled resume, replay, run IDs, checkpoints, response caches, successful-run result journaling, run database, or durable run state. The only retained result data is the narrow abnormal-run recovery envelope described above.
- No writable workflow mode, parallel implementation, session inheritance, or git worktree coordination.
- No additional workflow metadata such as argument schemas, phases, model/tool policy, defaults, or `whenToUse`.
- No arbitrary script-selected model IDs, user-defined alias maps, or general quality-helper framework beyond `verify()` and `report()`.

## Troubleshooting

- `script must start with...`: make literal metadata the first statement.
- `workflow must call agent() or verify()`: add a direct syntactic call; `report()` alone is not spawning work.
- `agent type ... is not allowed`: use a read-mostly built-in agent listed above.
- `model alias ... is not configured`: configure the corresponding fixed tier or omit `model`.
- `Unknown saved workflow`: call `workflow({ action: "list" })` or `/workflows-list`, then check the configured directory and strict filename.
- `Saved workflow ... is invalid`: fix the listed name, size, symlink, identity, read, or parser diagnostic before running.
- Artifact persistence errors: check that the system temporary scripts directory is an owner-controlled real directory.
- `workflow_missing_result`: export `run()` and return a value; use `return null` when no payload is intended.
- `workflow sandbox exited`: check for an unsupported Node runtime, script error, infinite loop, timeout, or cancellation.
- Recovery persistence warnings: the workflow's original cause still applies; inspect root ownership/mode, available storage, lock contention, and the fixed shared quota. A path appears only when retention succeeded.
- Retryable provider failures may use `retries: 1`; policy, cap, budget, timeout, abort, and permanent provider schema failures are not retried.

## Prior art

- [Claude Code dynamic workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) — model-authored JavaScript orchestration for fan-out subagent work.
- [Michaelliv/pi-dynamic-workflows](https://github.com/michaelliv/pi-dynamic-workflows) — influenced the raw-script, deterministic-global, foreground-progress shape.
- [@quintinshaw/pi-dynamic-workflows](https://pi.dev/packages/@quintinshaw/pi-dynamic-workflows) — demonstrates broader background, navigation, journaling, retry, and worktree ideas; this extension adopts only user-scoped saved definitions.
