# subagents

Pi extension that exposes a single tool, `spawn_agents`, for delegating work to child Pi processes as focused subagents.

For programmatic integration from other extensions, see [API.md](./API.md).

## Tool

### `spawn_agents`

Launch one or more subagents in parallel. Each runs independently in its own context window with a fixed tool set determined by the agent type. Pass a single agent when delegating one task; pass multiple when you have independent tasks that can run concurrently. Results are returned as a combined document once all agents complete.

**Parameters:**

| Parameter         | Type   | Required | Description                                                     |
| ----------------- | ------ | -------- | --------------------------------------------------------------- |
| `agents`          | array  | yes      | List of agents to run concurrently (minimum 1)                  |
| `agents[].agent`  | string | yes      | Agent type: `explore`, `review`, `research`, or `deep-research` |
| `agents[].intent` | string | yes      | Short label shown in activity titles (3–6 words)                |
| `agents[].prompt` | string | yes      | Full task — brief the agent like a colleague who just walked in |

Agent types are loaded dynamically from `~/.pi/agent/agents/*.md` at startup. The built-in types are defined in `pi/agent/agents/` in this repo and symlinked via `make stow`. Custom agents can be added by dropping additional `.md` files in that directory — no code changes required.

The built-in types:

| Type            | Tools                | Extensions                 | Model           | Thinking |
| --------------- | -------------------- | -------------------------- | --------------- | -------- |
| `explore`       | read, ls, find, grep | —                          | inherits parent | medium   |
| `review`        | read, ls, find, grep | `mcp-broker`               | inherits parent | high     |
| `research`      | read, ls, find, grep | `mcp-broker`, `web-access` | inherits parent | medium   |
| `deep-research` | read, ls, find, grep | `mcp-broker`, `web-access` | inherits parent | high     |

All built-in agent types are read-only. `review` adds read-only broker access (MCP search, describe, and call restricted to tools annotated `readOnlyHint`). `research` is the faster default for external lookup, while `deep-research` is the slower, evidence-heavier option. Both `research` and `deep-research` add web search and fetch via the `web-access` extension. If you want a writable subagent, add a custom agent markdown file with a broader tool set.

**Returns** a single document with each agent's result under a `## <type> · <intent>` heading, separated by `---`. On failure, the agent's section contains a formatted error including exit code and stderr. If the combined text exceeds the shared spillover threshold, the full output is written to `${tmpdir()}/pi-extension-spillover/<toolCallId>.txt` and the tool returns a short `<persisted-output>` envelope with the path and preview.

## UI behavior

While running, `spawn_agents` shows a compact header followed by one-line agent rows:

```
Spawn agents · 1 done · 2 running · 0 failed · 18s

● explore: Find auth flows · 4 tool uses · 14s · read: src/auth.ts
✓ research: Check docs · 3 tool uses · 12.4k tokens · 18s
● review: Check config · 1 tool use · 3s · grep: config
```

The tool-call line itself is intentionally suppressed — its content would just repeat the intents already shown in the header and agent rows. Each row shows status, type, intent, stable stats, and the latest activity at the end. Recoverable child tool failures are shown as latest activity while the subagent continues; only terminal child outcomes count as failed. On failure, the row displays the first error line and a path to the persisted log file when available.

Activity widgets are removed when all subagents finish, error, or are aborted.

## System prompt injection

When loaded, the extension hooks `before_agent_start` to append delegation guidance to the system prompt — when to delegate, the shape of `spawn_agents` (single call covers both single-task and parallel-task cases), and the list of available agent types with their descriptions. This means the guidance only appears when the extension is actually active; it is not hardcoded in `AGENTS.md`.

## Configuration

This extension has no `extension:subagents` settings and does not register a `/subagents-config` command. Subagent types are configured by markdown files with YAML frontmatter; see [Agent file format](#agent-file-format). Agent files control the tool allowlist, extensions, model, thinking level, skill/template availability, and child-process environment.

| Field      | Default                         | Environment override  | Description                                                       |
| ---------- | ------------------------------- | --------------------- | ----------------------------------------------------------------- |
| `agentDir` | Pi's default agent directory    | `PI_CODING_AGENT_DIR` | Agent directory to search for `agents/*.md` subagent definitions. |
| agent file | `agents/<name>.md` under Pi dir | none                  | Markdown frontmatter and prompt body defining each subagent type. |

## Logging

Each child process writes raw stdout and stderr to a managed temp log while it runs. Successful subagent logs are deleted after the process exits. Failed or aborted subagents retain their log under `${tmpdir()}/pi-extension-logs/subagents/`, and the path is shown in the tool result and activity rendering.

Retained logs may contain raw subagent output, tool results, command output, and stderr. Spillover files may contain the full raw combined subagent response. Do not treat these artifacts as sanitized output. Managed logs and spillover files are written with owner-only permissions and old files are cleaned up lazily by the shared helpers.

## Notes

- `intent` is required for every agent and drives activity titles — keep it short and descriptive
- Requests are prevalidated before spawning; blank intents or unknown agent types return one recoverable tool error and no subagents are launched
- Each subagent starts with a fresh context; session inheritance is not supported through the tool
- `review`, `research`, and `deep-research` require the `mcp-broker` extension to be installed and discoverable. `research` and `deep-research` additionally require `web-access`
- Built-in agent types disable skills and prompt templates for tighter, role-specific behavior
- All agents in a single `spawn_agents` call run concurrently; result order matches input order

## Agent file format

Each agent is a markdown file with YAML frontmatter:

```markdown
---
name: explore
description: Read-only codebase research — finding files and answering questions
tools: read, ls, find, grep
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
name: review
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
