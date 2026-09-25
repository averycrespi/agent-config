# subagents

Pi extension for running isolated child Pi processes through one explicit execution policy. The model-facing tool is `subagent`; other extensions use the sanitized [`runSubagent()` API](./API.md).

## Tool

### `subagent`

Launch exactly one subagent through a shared FIFO concurrency gate. `action: "run"` and background execution are defaults; explicit foreground and legacy `agents` batches reject before work starts. The child must be self-contained and explicit:

| Parameter             | Type     | Required | Description                                                              |
| --------------------- | -------- | -------- | ------------------------------------------------------------------------ |
| `agent.intent`        | string   | yes      | Short user-visible identity for the run.                                 |
| `agent.prompt`        | string   | yes      | Complete task prompt; children do not receive conversation history.      |
| `agent.capabilities`  | string[] | yes      | Explicit built-ins. `[]` is valid and launches a no-tools child.         |
| `agent.profile`       | string   | yes      | `fast`, `balanced`, or `strong`; resolves a configured model and effort. |
| `agent.files`         | string[] | no       | Readable regular files attached through Pi's native `@file` handling.    |
| `agent.output_schema` | object   | no       | Supported JSON Schema subset for validated machine-readable output.      |

There are no roles, named agents, raw tools, extension lists, exact model IDs, caller-selected effort, environment overrides, skills, templates, or context-file controls in the request. Profiles are centrally configured routing bundles, not fixed model identities.

Profile selection is task-oriented: use `fast` for narrow lookups, extraction, and straightforward summaries; `balanced` for substantial bounded exploration and synthesis; and `strong` for difficult analysis, ambiguous or consequential judgment, and demanding review. Legacy stored calls map `small` to `fast`, `medium` to `balanced`, and `large` to `strong`; their caller-selected thinking value is discarded because configured profile effort is authoritative. Legacy `modelTier*` settings and `SUBAGENTS_MODEL_TIER_*` overrides remain deprecated model fallbacks with warnings when the corresponding profile model is unset.

## Background execution

Run returns promptly with one execution ID after complete child validation and durable admission. [Background](../background/README.md) must be loaded in a persistent session; missing service fails with `background_unavailable`, never silently falls back. `timeout_ms` optionally bounds the whole background run, including queue time (default 600000, range 1000–3600000). The deadline never renews. No foreground fallback exists.

```json
{"agent":{"intent":"Trace routing","prompt":"Trace routing and cite file:line evidence. Do not modify files.","profile":"balanced","capabilities":["read-filesystem"]}}
{"action":"list"}
{"action":"inspect","id":"<execution-id>"}
{"action":"cancel","id":"<execution-id>"}
{"action":"dismiss","id":"<execution-id>"}
```

Controls accept no agent or execution options. List omits result bodies; inspect retains input-aligned outcomes, structured values, prose, diagnostics and reported usage. Large results expose a JSON `resultFile`; use `read` to inspect the complete retained result. A single child has one Background row showing its intent, profile, time since admission and live phase or safe tool name instead of 0/1 settled; historical batches retain real settled/total and failed counts. One terminal notification follows. No polling is required for notification. Per-child output belongs in inspection, not extra widgets or notifications.

Direct runs use the same FIFO capacity and mutable-child gate. All five capabilities remain available. Mutable children require explicit writable-delegation authority; the gate does **not** exclude parent edits or isolate checkouts. Queued cancellation launches no child; running cancellation aborts children and waits for process cleanup before terminal notification. Cancellation is not rollback. Session loss retains the last persisted partial outcomes/usage and conservative interruption evidence, aborts owned work, and never restarts children. Late callbacks cannot overwrite restored receipts; usage arriving after revocation cannot be recovered by this adapter.

Background admission has no completed usage; inspection and notification **never** charge usage again. Late background usage is retained per child and in the run result, including failed/aborted children, but is **not added to Pi's native footer/session totals**: the supported extension API has no late tool-usage insertion operation. Consumers must reconcile this separate ledger by execution ID rather than summing repeated inspections or notification deliveries. Notification handoff, observed consumption and semantic acceptance remain distinct; dismissal retains results and accounting.

Historical `subagents` and `spawn_agents` calls remain historical transcript entries; no alias or second active tool is registered and unfinished calls are not replayed. The new `subagent` controls list/inspect/cancel/dismiss retained `subagents` owner executions (including multi-child records) on their admission branch until eligible rolling retirement; an old retired ID returns `background_unknown_execution`. Submit new work through `subagent` after reconciling prior effects. Existing profile-argument normalization is retained for calls to the current tool. Directory, configuration namespace and `runSubagent()` host API are unchanged.

## Delegation guidance

Delegate a self-contained question when parallelism, isolation of substantial intermediate context, or independent judgment offers a clear benefit over startup, handoff, and verification costs. File count, task category, and read-only status alone are not triggers. Keep short lookups, deterministic checks, tightly coupled reasoning, and work needing unstated conversation context inline.

Once delegation is justified, use `subagent` for one independent question. Use [`workflow`](../workflows/README.md) for coordinated read-only multi-child fan-out, including parallel-only batches, dependent phases, aggregation and verification. Separate direct subagent calls require independent ownership/outcomes and parent reconciliation. Preserve skill-required workflows.

Keep implementation and fixes in the owning session by default. Writable delegation remains an exception when explicitly requested by the user and supported by an explicit execution workflow with bounded scope, one writer, orchestrator-owned state and evidence, a structured handoff, and independent verification. Do not overlap parent or child writes in the same checkout. Stricter workflow boundaries still apply: `work-ticket` keeps its subagents read-only.

Brief each child with one question or task, scope boundaries, relevant context and decisions, authoritative source paths, explicit capabilities and profile, an evidence-bearing deliverable with uncertainties, and a stop condition. Supply necessary context rather than the whole conversation. Use structured output when automation needs it. The parent owns synthesis and checks consequential claims against evidence; schema validity does not establish factual correctness.

## Built-in capabilities

Capabilities compose by deterministic catalog order. Tools and extensions are deduplicated.

| Capability         | Effective tools                                  | Extensions    | Additional policy                                                             |
| ------------------ | ------------------------------------------------ | ------------- | ----------------------------------------------------------------------------- |
| `read-filesystem`  | `read`, `ls`, `find`, `grep`                     | none          | Read-only filesystem inspection.                                              |
| `write-filesystem` | `edit`, `write`                                  | none          | Direct file mutation; does not imply read or shell authority.                 |
| `exec-shell`       | `bash`                                           | none          | Full shell authority; commands can mutate files and systems.                  |
| `read-mcp`         | `mcp_search`, `mcp_describe`, `mcp_call`, `read` | `mcp-gateway` | Forces `MCP_GATEWAY_READONLY=1`; refreshed annotation admission before calls. |
| `read-web`         | `web_search`, `web_fetch`, `read`                | `web-access`  | `read` supports known spill-file paths returned by web tools.                 |

`read-mcp` also includes `read` for gateway spill files. Neither web nor MCP authority implicitly grants `ls`, `find`, or `grep`. Calls receive only requested capabilities, subject to the global ceiling. Custom capability packs are intentionally unsupported.

`write-filesystem` and `exec-shell` are mutable authority. Any `subagent` request containing either capability must contain exactly one agent, and a shared exclusive gate serializes mutable children across concurrent tool calls. This is serialization, not sandboxing: file tools are not workspace-root restricted, and shell inherits the parent environment. The gate does not enforce user authorization, workflow prerequisites, or exclusion of parent-session edits; callers remain responsible for those boundaries.

## Example

```json
{
  "agents": [
    {
      "intent": "Trace request flow",
      "prompt": "Trace the request flow from the HTTP handler to persistence. Cite file:line evidence and do not modify files.",
      "capabilities": ["read-filesystem"],
      "profile": "balanced"
    },
    {
      "intent": "Summarize supplied evidence",
      "prompt": "Synthesize the supplied context into three validated conclusions.",
      "capabilities": [],
      "profile": "strong",
      "output_schema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["conclusions"],
        "properties": {
          "conclusions": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  ]
}
```

Preflight collects child validation errors and launches no child when invalid. It checks required text, capability names and global allowance, mutable-child serialization, configured profiles, live model resolution, configured effort support, attachments, and output schemas. The check uses Pi's live model registry; profile names do not imply fixed models. Runtime-supported `max` effort works when configured for the profile and supported by the selected model.

## Child context and environment

Every child:

- starts a fresh session;
- disables skill discovery and prompt-template discovery;
- loads normal Pi context files such as `AGENTS.md` and `CLAUDE.md`;
- inherits the complete parent process environment, with capability-owned values applied afterward;
- resolves extension short names through the existing project, agent-directory, and configured extension roots.

`exec-shell` therefore inherits credentials and other environment values available to the parent. This extension is a capability router, not a credential sandbox.

## Files and structured output

Relative attachment paths resolve from the call cwd. Preflight follows symlinks and accepts readable regular files, including paths outside the workspace. Attached contents are sent to the selected provider and may appear in child output, spillover, or retained failure logs.

`output_schema` supports single-string JSON types, scalar `enum`/`const`, string annotations, object `required`/`properties`/boolean `additionalProperties`, and array `items`. References, composition, conditionals, tuple items, type arrays, bounds, malformed/non-JSON values, and unknown keywords are rejected before launch.

Structured output automatically adds the `structured-output` extension and tool, writes a temporary owner-only schema file, instructs the child to call the tool as its final action, captures and validates the value, and removes the schema file. This is the only automatic authority composition, so `capabilities: []` remains no-tools unless structured output is requested.

Results use `## <intent>` headings followed by capability/profile metadata. `details.structured` is input-aligned when any item requests structured output. The final tool result returns the combined child model `usage`, including usage consumed by failed or aborted children when Pi reported it, so Pi session totals and usage-aware extensions can include delegated work. Large combined output uses shared spillover and returns the exact path for `read`.

## UI

Subagent run/list/inspect/cancel/dismiss use contextual one-line summaries with status and uncertainty before optional names. Inspect/cancel/dismiss calls show the full requested ID; wake expansion and inspection retain it. Per-child output and retained evidence stay expanded; admission, cancellation requests and attention dismissal are distinct. The shared widget/notification uses singular `subagent` when typed progress identifies one child, otherwise `subagents`. New admissions use the child's bounded intent as their widget and wake label without a short ID by default; historical batch labels retain their original child count. Rendering never consumes or accepts results.

The direct run returns an admission receipt; use inspection for the retained result, including child status, usage, diagnostic paths and structured/prose output. Dynamic labels are control-normalized, bounded and width-aware; prompts and raw logs are not rendered in compact rows.

## Configuration

Settings are global/env-only under `extension:subagents`; project settings cannot widen policy. Environment values override global settings. An invalid capability ceiling denies all capabilities with a diagnostic rather than widening to defaults. Replace retired capability names in local settings and launch environments; see the [gateway migration guide](../mcp-gateway/README.md#migration-and-qualification). Use `/subagents-config` to inspect effective parsed configuration.

| Field                   | Default                    | Environment override                | Description                                                           |
| ----------------------- | -------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| `maxConcurrency`        | `4`                        | `SUBAGENTS_MAX_CONCURRENCY`         | Shared direct-child limit, clamped to `1..16`.                        |
| `profileFastModel`      | `openai-codex/gpt-6-luna`  | `SUBAGENTS_PROFILE_FAST_MODEL`      | Full `provider/model` selector for `fast`.                            |
| `profileFastEffort`     | `medium`                   | `SUBAGENTS_PROFILE_FAST_EFFORT`     | Reasoning effort coupled to `fast`.                                   |
| `profileBalancedModel`  | `openai-codex/gpt-6-sol`   | `SUBAGENTS_PROFILE_BALANCED_MODEL`  | Full selector for `balanced`.                                         |
| `profileBalancedEffort` | `medium`                   | `SUBAGENTS_PROFILE_BALANCED_EFFORT` | Reasoning effort coupled to `balanced`.                               |
| `profileStrongModel`    | `openai-codex/gpt-6-astra` | `SUBAGENTS_PROFILE_STRONG_MODEL`    | Full selector for `strong`.                                           |
| `profileStrongEffort`   | `high`                     | `SUBAGENTS_PROFILE_STRONG_EFFORT`   | Reasoning effort coupled to `strong`.                                 |
| `allowedCapabilities`   | all five built-ins         | `SUBAGENTS_ALLOWED_CAPABILITIES`    | Array in settings; comma-separated global ceiling in the environment. |

`allowedEffortLevels`, `allowedThinkingLevels`, `SUBAGENTS_ALLOWED_EFFORT_LEVELS`, and `SUBAGENTS_ALLOWED_THINKING_LEVELS` are removed and ignored with diagnostics. Configure effort directly on each profile; the selected model's runtime-supported effort levels remain authoritative.

The shipped routing uses GPT-6 Luna/medium for `fast`, GPT-6 Sol/medium for `balanced`, and GPT-6 Astra/high for `strong`. The Luna and Sol generation upgrade preserves reasoning effort as a migration baseline, following [OpenAI's migration guidance](https://developers.openai.com/api/docs/guides/latest-model). This is a policy choice, not a measured performance improvement. `strong` uses Astra/high to avoid a deliberate capability downgrade for demanding work delegated by an Astra implementer; independent context still shares possible model blind spots. Compare verified task success, rework, latency, and total usage before further tuning. Change one variable at a time when attributing improvements, while always checking model/effort compatibility; unsupported combinations fail closed.

```json
{
  "extension:subagents": {
    "maxConcurrency": 4,
    "profileFastModel": "openai-codex/gpt-6-luna",
    "profileFastEffort": "medium",
    "profileBalancedModel": "openai-codex/gpt-6-sol",
    "profileBalancedEffort": "medium",
    "profileStrongModel": "openai-codex/gpt-6-astra",
    "profileStrongEffort": "high",
    "allowedCapabilities": [
      "read-filesystem",
      "write-filesystem",
      "exec-shell",
      "read-mcp",
      "read-web"
    ]
  }
}
```

Changes are reloaded before direct execution and by every `runSubagent()` call. Workflow concurrency remains separately configured, but workflow profiles use this central policy.

## Logging

Every launched child writes combined stdout/stderr to a secure gzip staging file. Successful logs are deleted. Failed or aborted runs may retain an owner-only `.log.gz` under `${tmpdir()}/pi-retained-diagnostics`; results expose only the finalized path. Retention is lazy for seven days and shares a 1 GiB compressed quota with abnormal workflow recovery artifacts.

Logs may contain raw prompts, model/tool/process output, structured values, attached contents, environment-derived credentials printed by tools, and stderr. Compression is not sanitization or encryption. Inspect explicitly with `gzip -dc`; the extension never previews or sends retained contents automatically. Storage failure preserves the child outcome and adds a bounded diagnostic warning.

Background sidecars follow the shared service's session retention and capacity limits. Completed child results too large for partial snapshots use owner-only `pi-subagent-outcome-*` temporary directories with `result.json`; these are not automatically deleted. Full oversized batches use the shared spillover directory and its lazy seven-day retention. Retain referenced files with evidence you need beyond temporary-file lifetime. Storage failures are disclosed and must not be treated as complete result retention. These JSON artifacts may include raw model/tool output and structured values; they are not secret-filtered.

## Limitations

- No custom capability packs, named roles, caller-defined profiles, or reusable subagent prompts.
- No workspace-root enforcement for file writes, environment sanitization, or credential isolation for shell execution.
- No writable parallel coordination, worktrees, merging, or session inheritance; mutable calls are serialized to one child per request.
- Recursion defaults to one child level; cancellation remains abort-aware for queued and running work.

## Prior art

- [Claude Code subagents](https://docs.claude.com/en/docs/claude-code/sub-agents) — isolated child contexts and restricted tool surfaces.
- [Codex subagents](https://developers.openai.com/codex/subagents) — explicit parallel delegation and consolidation.
- [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) — Pi subagent orchestration patterns.
- [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) — parallel execution and live progress patterns.
