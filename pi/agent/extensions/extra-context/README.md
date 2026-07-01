# extra-context

Loads user-configured additional context files into Pi's system prompt for every session.

Use this for personal or non-public instructions that should apply across projects without placing a private `AGENTS.md` inside this public configuration repo or a project checkout.

## Behavior

On `session_start`, the extension reads configured files and caches their contents for the session. On each `before_agent_start`, it appends the loaded files to the system prompt inside an `<extra_context>` block:

```xml
<extra_context>
Additional user-configured context files:

<extra_context_file path="/absolute/path/to/file.md">
...
</extra_context_file>
</extra_context>
```

The files are read by the extension, not by the agent through the `read` tool, so subagents can receive the same context when their agent definition loads the `extra-context` extension.

## Commands

```text
/extra-context-config
/extra-context-status
```

- `/extra-context-config` shows the effective parsed configuration.
- `/extra-context-status` shows loaded file paths, character counts, and diagnostics without printing file contents.

## Configuration

Settings live under `extension:extra-context` in Pi settings. Environment variables override settings when set.

| Field                 | Default | Environment override                  | Description                                                              |
| --------------------- | ------- | ------------------------------------- | ------------------------------------------------------------------------ |
| `enabled`             | `true`  | `EXTRA_CONTEXT_ENABLED`               | Enable context injection. Accepts `1`/`true` and `0`/`false` in the env. |
| `files`               | `[]`    | `EXTRA_CONTEXT_FILES`                 | Context files to load. Env form is a comma-separated list.               |
| `missingFileBehavior` | `warn`  | `EXTRA_CONTEXT_MISSING_FILE_BEHAVIOR` | How to handle unreadable files: `warn`, `ignore`, or `error`.            |

Paths may be absolute, `~`-prefixed, or relative to the session cwd. For cross-project private context, prefer an absolute or `~` path outside any git repository.

Example global settings:

```json
{
  "extension:extra-context": {
    "enabled": true,
    "files": ["~/.private/pi/AGENTS.private.md"],
    "missingFileBehavior": "warn"
  }
}
```

Example environment override:

```sh
export EXTRA_CONTEXT_FILES="$HOME/.private/pi/AGENTS.private.md"
```

## Subagents

The `subagents` extension launches child Pi processes with `--no-extensions` and only re-enables extensions listed in each agent definition. To provide extra context to a subagent, include `extra-context` in that agent file's `extensions:` frontmatter.

The built-in agent definitions in this repo load `extra-context` by default.

## Security and privacy

Do not put API keys, tokens, passwords, or other secrets in extra context files. Loaded content is sent to the model provider as prompt context and may appear in session exports, traces, retained logs from other extensions, or copied prompts.

`extra-context` never writes retained logs or temp files and `/extra-context-status` does not print file contents.
