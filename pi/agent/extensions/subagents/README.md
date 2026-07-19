# subagents

Pi extension for running isolated child Pi processes through one explicit execution policy. The model-facing tool is `spawn_agents`; other extensions use the sanitized [`runSubagent()` API](./API.md).

## Tool

### `spawn_agents`

Launch 1–16 independent subagents through a shared FIFO concurrency gate. Every item must be self-contained and explicit:

| Parameter                | Type     | Required | Description                                                           |
| ------------------------ | -------- | -------- | --------------------------------------------------------------------- |
| `agents[].intent`        | string   | yes      | Short user-visible identity for the run.                              |
| `agents[].prompt`        | string   | yes      | Complete task prompt; children do not receive conversation history.   |
| `agents[].capabilities`  | string[] | yes      | Explicit built-ins. `[]` is valid and launches a no-tools child.      |
| `agents[].model_tier`    | string   | yes      | `small`, `medium`, or `large`, resolved by central configuration.     |
| `agents[].thinking`      | string   | yes      | Explicit globally allowed and model-supported thinking level.         |
| `agents[].files`         | string[] | no       | Readable regular files attached through Pi's native `@file` handling. |
| `agents[].output_schema` | object   | no       | Supported JSON Schema subset for validated machine-readable output.   |

There are no roles, presets, named agents, raw tools, extension lists, exact model IDs, environment overrides, skills, templates, or context-file controls in the request.

## Built-in capabilities

Capabilities compose by deterministic catalog order. Tools and extensions are deduplicated.

| Capability        | Effective tools                                  | Extensions   | Additional policy                                                     |
| ----------------- | ------------------------------------------------ | ------------ | --------------------------------------------------------------------- |
| `read-filesystem` | `read`, `ls`, `find`, `grep`                     | none         | Read-only filesystem inspection.                                      |
| `exec-shell`      | `bash`                                           | none         | Full shell authority; commands can mutate files and systems.          |
| `read-broker`     | `mcp_search`, `mcp_describe`, `mcp_call`, `read` | `mcp-broker` | Forces `MCP_BROKER_READONLY=1` and `MCP_BROKER_APPROVAL_MODE=reject`. |
| `read-web`        | `web_search`, `web_fetch`, `read`                | `web-access` | `read` supports known spill-file paths returned by web tools.         |

`read-broker` also includes `read` for broker spill files. Neither web nor broker authority implicitly grants `ls`, `find`, or `grep`. Calls receive only requested capabilities, subject to the global ceiling. Custom capabilities and write/edit capabilities are intentionally unsupported.

## Example

```json
{
  "agents": [
    {
      "intent": "Trace request flow",
      "prompt": "Trace the request flow from the HTTP handler to persistence. Cite file:line evidence and do not modify files.",
      "capabilities": ["read-filesystem"],
      "model_tier": "medium",
      "thinking": "high"
    },
    {
      "intent": "Summarize supplied evidence",
      "prompt": "Synthesize the supplied context into three validated conclusions.",
      "capabilities": [],
      "model_tier": "large",
      "thinking": "high",
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

Preflight collects errors across the complete batch and launches no child when any item is invalid. It checks required text, capability names and global allowance, configured tiers, live model resolution, the selected model's supported thinking levels, attachments, and output schemas. The check uses Pi's live model registry; tier names do not imply model compatibility. Runtime-supported `max` thinking works when globally allowed and supported by the selected model.

## Child context and environment

Every child:

- starts a fresh session;
- disables skill discovery and prompt-template discovery;
- loads normal Pi context files such as `AGENTS.md` and `CLAUDE.md`;
- does not load `extra-context` solely because it is a subagent;
- inherits the complete parent process environment, with capability-owned values applied afterward;
- resolves extension short names through the existing project, agent-directory, and configured extension roots.

`exec-shell` therefore inherits credentials and other environment values available to the parent. This extension is a capability router, not a credential sandbox.

## Files and structured output

Relative attachment paths resolve from the call cwd. Preflight follows symlinks and accepts readable regular files, including paths outside the workspace. Attached contents are sent to the selected provider and may appear in child output, spillover, or retained failure logs.

`output_schema` supports single-string JSON types, scalar `enum`/`const`, string annotations, object `required`/`properties`/boolean `additionalProperties`, and array `items`. References, composition, conditionals, tuple items, type arrays, bounds, malformed/non-JSON values, and unknown keywords are rejected before launch.

Structured output automatically adds the `structured-output` extension and tool, writes a temporary owner-only schema file, instructs the child to call the tool as its final action, captures and validates the value, and removes the schema file. This is the only automatic authority composition, so `capabilities: []` remains no-tools unless structured output is requested.

Results use `## <intent>` headings followed by capability/tier/thinking metadata. `details.structured` is input-aligned when any item requests structured output. Large combined output uses shared spillover and returns the exact path for `read`.

## UI

Progress rows use intent as the primary identity and show capabilities, tier/thinking, status, duration, tool/token counts, and safe tool identity. They never render prompts, tool arguments, or raw retained logs. Expanded output includes finalized diagnostic paths. Dynamic text is control-normalized, bounded, and width-aware.

## Configuration

Settings are global/env-only under `extension:subagents`; project settings cannot widen policy. Environment values override valid global settings. Use `/subagents-config` to inspect effective parsed configuration.

| Field                   | Default                      | Environment override                | Description                                                                                            |
| ----------------------- | ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `maxConcurrency`        | `4`                          | `SUBAGENTS_MAX_CONCURRENCY`         | Shared direct-child limit, clamped to `1..16`.                                                         |
| `modelTierSmall`        | `openai-codex/gpt-5.6-luna`  | `SUBAGENTS_MODEL_TIER_SMALL`        | Full `provider/model` selector for `small`.                                                            |
| `modelTierMedium`       | `openai-codex/gpt-5.6-terra` | `SUBAGENTS_MODEL_TIER_MEDIUM`       | Full selector for `medium`.                                                                            |
| `modelTierLarge`        | `openai-codex/gpt-5.6-sol`   | `SUBAGENTS_MODEL_TIER_LARGE`        | Full selector for `large`.                                                                             |
| `allowedCapabilities`   | all four built-ins           | `SUBAGENTS_ALLOWED_CAPABILITIES`    | Array in settings; comma-separated global ceiling in the environment.                                  |
| `allowedThinkingLevels` | `low`, `medium`, `high`      | `SUBAGENTS_ALLOWED_THINKING_LEVELS` | Array in settings; comma-separated runtime levels in the environment, including `max` where supported. |

```json
{
  "extension:subagents": {
    "maxConcurrency": 4,
    "modelTierSmall": "openai-codex/gpt-5.6-luna",
    "modelTierMedium": "openai-codex/gpt-5.6-terra",
    "modelTierLarge": "openai-codex/gpt-5.6-sol",
    "allowedCapabilities": [
      "read-filesystem",
      "exec-shell",
      "read-broker",
      "read-web"
    ],
    "allowedThinkingLevels": ["low", "medium", "high"]
  }
}
```

Changes are reloaded before direct execution and by every `runSubagent()` call. Workflow concurrency remains separately configured, but workflow model tiers use this central policy.

## Logging

Every launched child writes combined stdout/stderr to a secure gzip staging file. Successful logs are deleted. Failed or aborted runs may retain an owner-only `.log.gz` under `${tmpdir()}/pi-retained-diagnostics`; results expose only the finalized path. Retention is lazy for seven days and shares a 1 GiB compressed quota with abnormal workflow recovery artifacts.

Logs may contain raw prompts, model/tool/process output, structured values, attached contents, environment-derived credentials printed by tools, and stderr. Compression is not sanitization or encryption. Inspect explicitly with `gzip -dc`; the extension never previews or sends retained contents automatically. Storage failure preserves the child outcome and adds a bounded diagnostic warning.

## Limitations

- No writable/edit capability, custom capability packs, roles, presets, or reusable subagent prompts.
- No environment sanitization or credential isolation for shell execution.
- No writable parallel coordination, worktrees, merging, or session inheritance.
- Recursion defaults to one child level; cancellation remains abort-aware for queued and running work.

## Prior art

- [Claude Code subagents](https://docs.claude.com/en/docs/claude-code/sub-agents) — isolated child contexts and restricted tool surfaces.
- [Codex subagents](https://developers.openai.com/codex/subagents) — explicit parallel delegation and consolidation.
- [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) — Pi subagent orchestration patterns.
- [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) — parallel execution and live progress patterns.
