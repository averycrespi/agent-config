# workflows extension

The `workflows` extension provides a foreground `workflow` tool for deterministic JavaScript orchestration scripts. A workflow can fan out read-mostly subagents, collect their results, and return a compact final answer while streaming progress updates.

This is a Phase 1 MVP. It is for research, review, audit, and exploration workflows, not parallel implementation or workspace mutation.

## Tool

### `workflow`

Parameters:

| Field    | Required | Description                                                                                             |
| -------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `script` | Yes      | Raw JavaScript workflow source. It must start with literal `export const meta = { name, description }`. |
| `args`   | No       | Any JSON value exposed to the script as the `args` global.                                              |

The tool returns the workflow result text. During execution, the tool UI shows the workflow phase, aggregate counts, recent `log(...)` messages, and compact one-line rows for each subagent: status, agent type, intent, stable stats, latest activity at the end, and failure log paths when available. Large final output is persisted through the shared spillover helper and replaced with a preview envelope that includes the temp file path.

## Script format

Every script must start with literal metadata and call `agent()` at least once:

```js
export const meta = {
  name: "repo-audit",
  description: "Fan out focused repository audits",
};

export async function run() {
  phase("inspect");
  const topics = args?.topics ?? ["tests", "docs", "security"];
  const results = await parallel(
    topics.map(
      (topic) => () =>
        agent(`Audit the repository for ${topic} issues.`, {
          agent: "explore",
          intent: topic,
        }),
    ),
  );
  return results;
}
```

Supported globals:

| Global     | Description                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`    | Runs one read-mostly subagent: `agent(prompt, { agent?, intent?, output? })`. Defaults to `explore`; when `output: { schema }` is provided, resolves to the parsed structured value instead of Markdown text. |
| `parallel` | Runs an array of thunks with bounded concurrency and preserves input ordering.                                                                                                                                |
| `pipeline` | Runs sequential stages for each item, using `parallel` across items.                                                                                                                                          |
| `phase`    | Sets the current progress phase.                                                                                                                                                                              |
| `log`      | Adds a progress log entry.                                                                                                                                                                                    |
| `args`     | The optional JSON `args` value from the tool call.                                                                                                                                                            |
| `cwd`      | Current working directory string.                                                                                                                                                                             |

## Structured subagent output

Use `output` when workflow fan-in needs machine-readable data from a subagent. The workflow runtime asks `subagents` to load the generic `structured-output` extension in the child process, captures the `structured_output` tool result from Pi JSON events, validates it against the provided JSON Schema subset, and resolves `agent()` to the parsed value.

```js
export const meta = {
  name: "repo-map",
  description: "Collect structured repository findings",
};

export async function run() {
  const findingSchema = {
    type: "object",
    required: ["files", "summary"],
    properties: {
      files: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
    additionalProperties: false,
  };

  return await agent("Find auth entrypoints", {
    agent: "explore",
    intent: "auth map",
    output: { schema: findingSchema },
  });
}
```

Without `output`, `agent()` keeps the original behavior and resolves to the subagent's final text. If structured output is requested but the child does not call the output tool, or the value fails validation, the agent call fails; inside `parallel()`, that branch is logged and becomes `null` like other branch failures.

Supported parent-side validation covers plain JSON Schema `type`, `required`, `properties`, `items`, `enum`, `const`, and `additionalProperties: false`. The child Pi tool still receives the full schema as its tool parameter schema.

## Safety restrictions

Scripts are parsed before execution. The MVP rejects:

- imports, re-exports, dynamic `import()`, and `require`
- filesystem, network, worker, process, global, buffer, and timer APIs
- nondeterminism such as `Date.now`, `new Date`, and `Math.random`
- scripts without a syntactic `agent()` call

Script execution runs in a separate killable Node worker. The worker receives only the MVP globals above. The subagent wrapper always uses `inheritSession: "none"`, does not pass arbitrary environment variables, propagates cancellation, and permits only read-mostly built-in agent types: `explore`, `research`, `deep-research`, and `review`.

## Configuration

There is no user-facing configuration in Phase 1, and there are no environment variable overrides.

## Logging and retained output

The extension does not keep a workflow run database. Progress logs and per-subagent activity snapshots live only in the tool result details for the active call. Subagent failures may produce retained logs through the `subagents` extension. Large workflow final output is written by the shared spillover helper under the system temp directory and may contain raw model/tool output. Spillover files are owner-readable and cleaned best-effort by the shared helper after its retention window.

## Limitations

- Foreground tool calls only; no background manager or `/workflows` navigator.
- No journaled resume or saved workflow library.
- No writable workflow mode or git worktree isolation.
- No model tiers, retries, or quality-helper standard library.

## Troubleshooting

- `script must start with...`: make metadata the first statement, before comments that parse as statements or any setup code.
- `workflow must call agent()`: include a syntactic `agent(...)` call in the script.
- `agent type ... is not allowed`: use one of the read-mostly built-in agents listed above.
- `workflow worker exited`: check for a thrown script error, infinite loop, or cancellation.

## Prior art

- [Claude Code dynamic workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) — model-authored JavaScript orchestration for fan-out subagent work, the core interaction pattern this MVP adapts to Pi.
- [Michaelliv/pi-dynamic-workflows](https://github.com/michaelliv/pi-dynamic-workflows) — Pi workflow extension that influenced the MVP shape: raw JavaScript scripts, globals such as `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, and foreground progress.
- [@quintinshaw/pi-dynamic-workflows](https://pi.dev/packages/@quintinshaw/pi-dynamic-workflows) — Pi package demonstrating later-stage ideas such as background runs, navigators, journaling, saved workflows, model tiers, retries, and worktree isolation. Those are intentionally out of scope for this Phase 1 implementation.
