# subagents

Pi extension for running isolated child Pi processes through one explicit execution policy. The model-facing tool is `spawn_agents`; other extensions use the sanitized [`runSubagent()` API](./API.md).

## Tool

### `spawn_agents`

Launch 1–16 independent subagents through a shared FIFO concurrency gate. Every item must be self-contained and explicit:

| Parameter                | Type     | Required | Description                                                              |
| ------------------------ | -------- | -------- | ------------------------------------------------------------------------ |
| `agents[].intent`        | string   | yes      | Short user-visible identity for the run.                                 |
| `agents[].prompt`        | string   | yes      | Complete task prompt; children do not receive conversation history.      |
| `agents[].capabilities`  | string[] | yes      | Explicit built-ins. `[]` is valid and launches a no-tools child.         |
| `agents[].profile`       | string   | yes      | `fast`, `balanced`, or `strong`; resolves a configured model and effort. |
| `agents[].files`         | string[] | no       | Readable regular files attached through Pi's native `@file` handling.    |
| `agents[].output_schema` | object   | no       | Supported JSON Schema subset for validated machine-readable output.      |

There are no roles, named agents, raw tools, extension lists, exact model IDs, caller-selected effort, environment overrides, skills, templates, or context-file controls in the request. Profiles are centrally configured routing bundles, not fixed model identities.

Profile selection is task-oriented: use `fast` for routine bounded work, `balanced` for substantial work, and `strong` for demanding self-contained work. Legacy stored calls map `small` to `fast`, `medium` to `balanced`, and `large` to `strong`; their caller-selected thinking value is discarded because configured profile effort is authoritative. Legacy `modelTier*` settings and `SUBAGENTS_MODEL_TIER_*` overrides remain deprecated model fallbacks with warnings when the corresponding profile model is unset.

## Built-in capabilities

Capabilities compose by deterministic catalog order. Tools and extensions are deduplicated.

| Capability         | Effective tools                                  | Extensions   | Additional policy                                                     |
| ------------------ | ------------------------------------------------ | ------------ | --------------------------------------------------------------------- |
| `read-filesystem`  | `read`, `ls`, `find`, `grep`                     | none         | Read-only filesystem inspection.                                      |
| `write-filesystem` | `edit`, `write`                                  | none         | Direct file mutation; does not imply read or shell authority.         |
| `exec-shell`       | `bash`                                           | none         | Full shell authority; commands can mutate files and systems.          |
| `read-broker`      | `mcp_search`, `mcp_describe`, `mcp_call`, `read` | `mcp-broker` | Forces `MCP_BROKER_READONLY=1` and `MCP_BROKER_APPROVAL_MODE=reject`. |
| `read-web`         | `web_search`, `web_fetch`, `read`                | `web-access` | `read` supports known spill-file paths returned by web tools.         |

`read-broker` also includes `read` for broker spill files. Neither web nor broker authority implicitly grants `ls`, `find`, or `grep`. Calls receive only requested capabilities, subject to the global ceiling. Custom capability packs are intentionally unsupported.

`write-filesystem` and `exec-shell` are mutable authority. Any `spawn_agents` request containing either capability must contain exactly one agent, and a shared exclusive gate serializes mutable children across concurrent tool calls. This is serialization, not sandboxing: file tools are not workspace-root restricted, and shell inherits the parent environment.

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

Preflight collects errors across the complete batch and launches no child when any item is invalid. It checks required text, capability names and global allowance, mutable-batch serialization, configured profiles, live model resolution, configured effort support, attachments, and output schemas. The check uses Pi's live model registry; profile names do not imply fixed models. Runtime-supported `max` effort works when globally allowed, configured for the profile, and supported by the selected model.

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

Results use `## <intent>` headings followed by capability/profile metadata. `details.structured` is input-aligned when any item requests structured output. Large combined output uses shared spillover and returns the exact path for `read`.

## UI

Default output shows the `spawn_agents` aggregate line followed by each agent on two width-bounded logical lines: the first shows status, intent, duration, and tool/token counts; the second starts with the profile, adds compact capabilities when present, and keeps volatile activity last. Capability labels are `fs`, `write`, `shell`, `broker`, and `web`; empty capability sets are omitted. Rows never render prompts, tool arguments, or raw retained logs. Expanding tool output adds finalized diagnostic paths and secondary errors without changing the default progress rows. Dynamic text is control-normalized, bounded, and width-aware.

## Configuration

Settings are global/env-only under `extension:subagents`; project settings cannot widen policy. Environment values override valid global settings. Use `/subagents-config` to inspect effective parsed configuration.

| Field                   | Default                      | Environment override                | Description                                                                                            |
| ----------------------- | ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `maxConcurrency`        | `4`                          | `SUBAGENTS_MAX_CONCURRENCY`         | Shared direct-child limit, clamped to `1..16`.                                                         |
| `profileFastModel`      | `openai-codex/gpt-5.6-luna`  | `SUBAGENTS_PROFILE_FAST_MODEL`      | Full `provider/model` selector for `fast`.                                                             |
| `profileFastEffort`     | `high`                       | `SUBAGENTS_PROFILE_FAST_EFFORT`     | Reasoning effort coupled to `fast`.                                                                    |
| `profileBalancedModel`  | `openai-codex/gpt-5.6-terra` | `SUBAGENTS_PROFILE_BALANCED_MODEL`  | Full selector for `balanced`.                                                                          |
| `profileBalancedEffort` | `high`                       | `SUBAGENTS_PROFILE_BALANCED_EFFORT` | Reasoning effort coupled to `balanced`.                                                                |
| `profileStrongModel`    | `openai-codex/gpt-5.6-sol`   | `SUBAGENTS_PROFILE_STRONG_MODEL`    | Full selector for `strong`.                                                                            |
| `profileStrongEffort`   | `high`                       | `SUBAGENTS_PROFILE_STRONG_EFFORT`   | Reasoning effort coupled to `strong`.                                                                  |
| `allowedCapabilities`   | all five built-ins           | `SUBAGENTS_ALLOWED_CAPABILITIES`    | Array in settings; comma-separated global ceiling in the environment.                                  |
| `allowedEffortLevels`   | `low`, `medium`, `high`      | `SUBAGENTS_ALLOWED_EFFORT_LEVELS`   | Array in settings; comma-separated ceiling for configured profile efforts, including `max` if allowed. |

The shipped profile efforts are evaluation starting points, not model-family guarantees. Change a profile's model and effort together, then compare verified task success, rework, latency, and cost; unsupported or globally disallowed combinations fail closed.

```json
{
  "extension:subagents": {
    "maxConcurrency": 4,
    "profileFastModel": "openai-codex/gpt-5.6-luna",
    "profileFastEffort": "high",
    "profileBalancedModel": "openai-codex/gpt-5.6-terra",
    "profileBalancedEffort": "high",
    "profileStrongModel": "openai-codex/gpt-5.6-sol",
    "profileStrongEffort": "high",
    "allowedCapabilities": [
      "read-filesystem",
      "write-filesystem",
      "exec-shell",
      "read-broker",
      "read-web"
    ],
    "allowedEffortLevels": ["low", "medium", "high"]
  }
}
```

Changes are reloaded before direct execution and by every `runSubagent()` call. Workflow concurrency remains separately configured, but workflow profiles use this central policy.

## Logging

Every launched child writes combined stdout/stderr to a secure gzip staging file. Successful logs are deleted. Failed or aborted runs may retain an owner-only `.log.gz` under `${tmpdir()}/pi-retained-diagnostics`; results expose only the finalized path. Retention is lazy for seven days and shares a 1 GiB compressed quota with abnormal workflow recovery artifacts.

Logs may contain raw prompts, model/tool/process output, structured values, attached contents, environment-derived credentials printed by tools, and stderr. Compression is not sanitization or encryption. Inspect explicitly with `gzip -dc`; the extension never previews or sends retained contents automatically. Storage failure preserves the child outcome and adds a bounded diagnostic warning.

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
