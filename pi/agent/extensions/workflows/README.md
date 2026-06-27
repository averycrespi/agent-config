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

The tool returns the workflow result text. During execution, the tool UI shows the workflow phase, aggregate counts, recent `log(...)` messages, and per-subagent activity using the same style as `spawn_agents`: agent type, intent, recent tool activity, running/done/error status, tool-use counts, tokens, duration, and failure log paths when available. Large final output is persisted through the shared spillover helper and replaced with a preview envelope that includes the temp file path.

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

| Global     | Description                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------- |
| `agent`    | Runs one read-mostly subagent: `agent(prompt, { agent?, intent? })`. Defaults to `explore`. |
| `parallel` | Runs an array of thunks with bounded concurrency and preserves input ordering.              |
| `pipeline` | Runs sequential stages for each item, using `parallel` across items.                        |
| `phase`    | Sets the current progress phase.                                                            |
| `log`      | Adds a progress log entry.                                                                  |
| `args`     | The optional JSON `args` value from the tool call.                                          |
| `cwd`      | Current working directory string.                                                           |

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
- No structured result schema support.
- No writable workflow mode or git worktree isolation.
- No model tiers, retries, or quality-helper standard library.

## Troubleshooting

- `script must start with...`: make metadata the first statement, before comments that parse as statements or any setup code.
- `workflow must call agent()`: include a syntactic `agent(...)` call in the script.
- `agent type ... is not allowed`: use one of the read-mostly built-in agents listed above.
- `workflow worker exited`: check for a thrown script error, infinite loop, or cancellation.

## Prior art

- `pi-dynamic-workflows` influenced the MVP shape: raw JavaScript scripts, globals such as `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, and foreground progress.
- `@quintinshaw/pi-dynamic-workflows` demonstrates later-stage ideas such as background runs, navigators, journaling, saved workflows, model tiers, retries, and worktree isolation. Those are intentionally out of scope for this Phase 1 implementation.
