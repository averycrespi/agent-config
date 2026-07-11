# subagents

Pi extension that exposes a single tool, `spawn_agents`, for delegating work to child Pi processes as focused subagents.

For programmatic integration from other extensions, see [API.md](./API.md).

## Tool

### `spawn_agents`

Launch one or more subagents through a bounded concurrency queue. Each runs independently in its own context window with a fixed tool set determined by the agent type. Pass a single agent when delegating one task; pass multiple when you have independent tasks that can run concurrently. Each call accepts at most 16 agents. Results are returned as a combined document once all agents complete.

**Parameters:**

| Parameter                | Type     | Required | Description                                                                                     |
| ------------------------ | -------- | -------- | ----------------------------------------------------------------------------------------------- |
| `agents`                 | array    | yes      | List of agents to run concurrently (minimum 1, maximum 16)                                      |
| `agents[].agent`         | string   | yes      | Agent type: `explorer`, `reviewer`, `scout`, `researcher`, or `analyst`                         |
| `agents[].intent`        | string   | yes      | Short label shown in activity titles (3–6 words)                                                |
| `agents[].prompt`        | string   | yes      | Full task — brief the agent like a colleague who just walked in                                 |
| `agents[].thinking`      | string   | no       | `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`; overrides agent and parent thinking      |
| `agents[].files`         | string[] | no       | Readable regular files attached to this child using Pi's native `@file` handling                |
| `agents[].output_schema` | object   | no       | Supported JSON Schema subset that activates the existing validated structured-output child path |

Per-item model selection is intentionally unavailable. Agent definitions continue to own model selection, with the parent model used when an agent definition omits it.

Agent types are loaded dynamically from `~/.pi/agent/agents/*.md` at startup. The built-in types are defined in `pi/agent/agents/` in this repo and symlinked via `make stow`. Custom agents can be added by dropping additional `.md` files in that directory — no code changes required.

The built-in types:

| Type         | Tools                                                                           | Extensions                                  | Model         | Thinking |
| ------------ | ------------------------------------------------------------------------------- | ------------------------------------------- | ------------- | -------- |
| `explorer`   | read, bash, ls, find, grep                                                      | `extra-context`                             | GPT-5.6 Terra | medium   |
| `reviewer`   | read, ls, find, grep, mcp_search, mcp_describe, mcp_call                        | `extra-context`, `mcp-broker`               | GPT-5.6 Terra | high     |
| `scout`      | read, ls, find, grep, mcp_search, mcp_describe, mcp_call, web_search, web_fetch | `extra-context`, `mcp-broker`, `web-access` | GPT-5.6 Luna  | medium   |
| `researcher` | read, ls, find, grep, mcp_search, mcp_describe, mcp_call, web_search, web_fetch | `extra-context`, `mcp-broker`, `web-access` | GPT-5.6 Terra | high     |
| `analyst`    | read, bash, ls, find, grep, mcp_search, mcp_describe, mcp_call                  | `extra-context`, `mcp-broker`               | GPT-5.6 Terra | high     |

Built-in agent types are intended for read-only work, but the effective tool boundary is read-mostly because `explorer` and `analyst` include `bash` for local inspection and data reduction. Their prompts forbid filesystem mutations, installs, formatting, and file redirects, but `bash` is not mechanically read-only. Because Pi's `--tools` flag is an allowlist across built-in, extension, and custom tools, agent definitions that enable tool-providing extensions must also list those extension tool names. `reviewer` adds read-only broker access (MCP search, describe, and call restricted to tools annotated `readOnlyHint`). `scout` is the faster default for external lookup, while `researcher` is the slower, evidence-heavier option. Both `scout` and `researcher` add web search and fetch via the `web-access` extension. `analyst` distills noisy logs, traces, metrics, query results, or large local outputs into patterns, representative examples, hypotheses, and follow-up queries. If you want a writable subagent, add a custom agent markdown file with a broader tool set.

## When to delegate

Use subagents for read-mostly work that would otherwise expand the main context, require iterative searching, or benefit from an isolated second opinion:

- `explorer` — unfamiliar code, control/data-flow tracing, entry points, and broad local file reading
- `scout` — quick repo/web/remote lookup with lightweight verification
- `researcher` — deeper multi-source synthesis with explicit confidence and gaps
- `reviewer` — plans, diffs, branches, PRs, designs, and risk checks against criteria
- `analyst` — logs, traces, metrics, query results, and large noisy outputs

Do not delegate when the task requires editing files, a deterministic command would answer faster, the work needs unstated conversation context, or the steps are tightly sequential. Put all independent branches in one `spawn_agents` call so they run concurrently; use a single-agent call for one isolated task.

### File attachments

Relative file paths resolve from the tool's current working directory; absolute paths are retained. Preflight follows symlinks and accepts any readable regular file, including files outside the workspace. It does not impose attachment-count, byte-size, or content-type limits. Pi owns native `@file` formatting, attachment sizing, and context-window behavior; the extension does not read or inline file contents.

Attached file contents are sent to the selected model/provider. They may also appear in child tool/model output, retained failure logs, or combined spillover files. Only attach data appropriate for those destinations.

### Supported output schemas

`output_schema` accepts a deliberately narrow, recursively validated JSON Schema subset:

- optional single-string `type`: `null`, `boolean`, `object`, `array`, `number`, `integer`, or `string` (type arrays are unsupported);
- non-empty `enum` arrays and `const` values containing JSON scalars only;
- string `title` and `description` annotations;
- for objects, unique-string `required`, recursively validated `properties`, and boolean `additionalProperties`; `additionalProperties: false` requires `properties`;
- for arrays, one recursively validated `items` schema.

Unknown keywords, structural keywords on the wrong type, malformed nested definitions, and non-JSON values are rejected atomically before any child launches. `$ref`, composition/conditional keywords, tuple items, nullable type arrays, and numeric or string bounds are not supported. Omit `output_schema` for normal prose behavior.

All accepted root types, including arrays, scalars, and `null`, are supported even when the selected provider requires function parameters to have an object root; the child extension applies and removes an internal provider envelope. Structured output still depends on the model making the required final tool call. Prefer `low` or `medium` thinking over `off` for machine-readable boundaries where tool-call reliability matters. Direct calls report missing or incomplete output as a contract failure and do not retry automatically.

**Returns** a single document with each agent's result under a `## <type> · <intent>` heading, separated by `---`. Prose-only section bodies are unchanged. A structured success renders the validated value as fenced, formatted JSON. On failure, including a structured-output contract failure, the agent's section contains a formatted error including available process diagnostics. If the combined text exceeds the shared spillover threshold, the full output is written to `${tmpdir()}/pi-extension-spillover/<toolCallId>.txt` and the tool returns a short `<persisted-output>` envelope with the path and preview.

When any item requests `output_schema`, `details.structured` is an input-aligned array:

```json
[
  { "requested": false },
  { "requested": true, "ok": true, "value": null },
  { "requested": true, "ok": false, "error": "contract failed" }
]
```

The envelope distinguishes prose items, successful JSON values (including `null`), and failed contracts. Missing or malformed structured tool calls, incomplete calls, tool errors, schema-invalid values, provider/process failures, and cancellation use the failed envelope. Provider-terminal errors are surfaced directly rather than being mistaken for successful empty output or a missing structured tool call. These failures increment aggregate `failed` and make `allOk` false even when the child process exited zero. Prose-only batches omit `details.structured` entirely.

## UI behavior

While running, `spawn_agents` shows a compact header followed by one-line agent rows:

```
Spawn agents · 1 done · 2 running · 0 failed · 18s

● explorer: Find auth flows · 4 tool uses · 14s · read: src/auth.ts
✓ scout: Check docs · 3 tool uses · 12.4k tokens · 18s
● reviewer: Check config · 1 tool use · 3s · grep: config
```

The tool-call line itself is intentionally suppressed — its content would just repeat the intents already shown in the header and agent rows. Each row shows status, type, intent, stable stats, and the latest activity at the end. Recoverable child tool failures are shown as latest activity while the subagent continues; only terminal child outcomes count as failed. On failure, the row displays the first error line and a path to the persisted log file when available.

Activity widgets are removed when all subagents finish, error, or are aborted.

## System prompt injection

When loaded, the extension hooks `before_agent_start` to append delegation guidance to the system prompt — when to delegate, the shape of `spawn_agents` (single call covers both single-task and parallel-task cases), and the list of available agent types with their descriptions. This means the guidance only appears when the extension is actually active; it is not hardcoded in `AGENTS.md`.

## Configuration

Direct `spawn_agents` calls share one extension-wide FIFO concurrency gate. The gate defaults to four running children and is hard-clamped to 16. Only the global Pi settings file and the environment control this gate; project `.pi/settings.json` values are deliberately ignored. A valid environment override wins over the global setting. Invalid environment values produce a warning and leave a valid global setting in effect; invalid global values fall back to the default.

| Field            | Default | Environment override        | Description                                                                            |
| ---------------- | ------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `maxConcurrency` | `4`     | `SUBAGENTS_MAX_CONCURRENCY` | Global maximum direct children running concurrently; project settings ignored; `1..16` |

```json
{
  "extension:subagents": {
    "maxConcurrency": 4
  }
}
```

Use `/subagents-config` to inspect the effective parsed configuration and any warnings. Changes are reloaded before each direct tool execution. When overlapping calls finish asynchronous config reads out of order, only the newest-started reload may resize the shared gate. This setting does not change the fixed limit of 16 agents per call and does not control workflow concurrency.

Subagent types remain configured by markdown files with YAML frontmatter; see [Agent file format](#agent-file-format). Agent files control the tool allowlist, extensions, model, thinking level, skill/template availability, and child-process environment.

| Source     | Default                         | Environment override  | Description                                                       |
| ---------- | ------------------------------- | --------------------- | ----------------------------------------------------------------- |
| agent dir  | Pi's default agent directory    | `PI_CODING_AGENT_DIR` | Agent directory to search for `agents/*.md` subagent definitions. |
| agent file | `agents/<name>.md` under Pi dir | none                  | Markdown frontmatter and prompt body defining each subagent type. |

## Logging

Each child process writes raw stdout and stderr to a managed temp log while it runs. Successful subagent logs are deleted after the process exits. Failed or aborted subagents retain their log under `${tmpdir()}/pi-extension-logs/subagents/`, and the path is shown in the tool result and activity rendering.

Retained logs may contain raw subagent output, tool results, command output, structured values, attached file contents echoed through model/tool output, and stderr. Spillover files may contain the full raw combined subagent response. Do not treat these artifacts as sanitized output. Managed logs and spillover files are written with owner-only permissions and old files are cleaned up lazily by the shared helpers.

## Notes

- `intent` is required for every agent and drives activity titles — keep it short and descriptive
- Requests are prevalidated before spawning; batches over 16 return the ceiling error immediately, while in-range batches collect blank intents, unknown agent types, invalid thinking levels, invalid files, and unsupported schemas into one recoverable error; no invalid batch launches subagents
- Each subagent starts with a fresh context; session inheritance is not supported through the tool
- Built-in agents load `extra-context` so user-configured context files are available in child Pi processes
- `reviewer`, `scout`, `researcher`, and `analyst` require the `mcp-broker` extension to be installed and discoverable. `scout` and `researcher` additionally require `web-access`
- Built-in agent types disable skills and prompt templates for tighter, role-specific behavior
- Direct calls share the configured bounded queue, including overlapping calls; queued cancellation prevents launch, while completed results are preserved and running children receive the existing abort signal
- Result order matches input order regardless of launch or completion order

## Agent file format

Each agent is a markdown file with YAML frontmatter:

```markdown
---
name: explorer
description: Read-only codebase research — finding files and answering questions
tools: read, bash, ls, find, grep
extensions:
thinking: medium
disable_skills: true
disable_prompt_templates: true
---

System prompt body...
```

Fields: `name` (defaults to filename without extension), `description` (shown in the tool's agent list), `tools` (comma-separated), `extensions` (comma-separated, empty means none), `model` (inherits parent model if omitted), `thinking` (inherits parent thinking level if omitted), `disable_skills`, `disable_prompt_templates`, `env` (map of environment variables to inject into the child process — see example below).

The `env` field accepts an indented key/value map:

```markdown
---
name: reviewer
extensions: mcp-broker
env:
  MCP_BROKER_READONLY: "1"
---
```

Variable values are always strings. The map is merged into the child's environment before launch; unset keys in the map leave the parent environment unchanged.

## Prior art

- [Claude Code subagents docs](https://docs.claude.com/en/docs/claude-code/sub-agents) — specialized agents with isolated context windows, custom system prompts, tool restrictions, and reusable markdown definitions.
- [Codex subagents docs](https://developers.openai.com/codex/subagents) — explicit subagent workflows that spawn specialized agents in parallel and consolidate results.
- [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents) — slash commands (`/run`, `/chain`, `/parallel`), an interactive Agents Manager overlay, reusable chain files (`.chain.md`), and background/foreground execution modes
- [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) — parallel execution with configurable concurrency limits, a persistent live widget, mid-run steering, custom agent definitions via markdown, and cross-extension communication through event-based RPC
