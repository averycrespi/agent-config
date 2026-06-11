# Context

Adds `/context`, a minimal token-blame command for the current Pi context window.

The command combines Pi's current context-usage reading, when available, with a local estimate of what the current session branch contributes. It uses a deliberately rough `Math.ceil(text.length / 4)` estimator so the output is useful for spotting large context sources without depending on provider-specific tokenizers.

## Commands

```text
/context
/context --details
```

Example output:

```text
Context usage: 82.4k / 200.0k tokens · 41%
Source: Pi-reported current usage + local current-branch blame estimate

Top token sources
1. Tool result: bash                            28.1k   34%  2 items
2. System prompt + project instructions         14.6k   18%  1 item

Largest individual tool results
1. bash (call_abc123)                           19.4k   24%
2. bash (call_def456)                            8.7k   11%
```

`/context` shows the largest grouped sources plus the top individual tool-result calls. `/context --details` shows every grouped source plus short examples for groups and individual calls.

## What it counts

- Current effective system prompt from `ctx.getSystemPrompt()`
- Current branch entries from `ctx.sessionManager.getBranch()`
- User messages
- Assistant messages, including tool-call arguments
- Tool results grouped by tool name
- Largest individual tool-result calls, including call IDs when available
- Compaction and branch summaries
- Custom context messages from extensions

If Pi reports more current context tokens than the local branch estimate can explain, the command shows the gap as `Unattributed provider/framing overhead`. This can include provider serialization, tool schemas, tokenization differences, or context not directly visible through the session branch.

## Configuration

This extension has no user-facing configuration.

## Logging

This extension does not write retained logs or temp output.
