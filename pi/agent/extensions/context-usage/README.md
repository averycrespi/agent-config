# context-usage

Adds `/context-usage`, a minimal token-blame command for the current Pi context window.

Requires Pi **0.87.0 or newer**. The command combines Pi's current context-usage reading, when available, with a local estimate of the effective session context after compaction and context edits. It uses a deliberately rough `Math.ceil(text.length / 4)` estimator so the output is useful for spotting large context sources without depending on provider-specific tokenizers.

## Commands

```text
/context-usage
/context-usage --details
```

Example output:

```text
Context usage: 82.4k / 200.0k tokens · 41%
Source: Pi-reported current usage + local effective-context blame estimate

Top token sources
1. Tool result: bash                            28.1k   34%  2 items
2. System prompt + project instructions         14.6k   18%  1 item

Largest individual tool results
1. bash (call_abc123)                           19.4k   24%
2. bash (call_def456)                            8.7k   11%
```

`/context-usage` shows the largest grouped sources plus the top individual tool-result calls. `/context-usage --details` shows every grouped source plus short examples for groups and individual calls.

## What it counts

- Current effective system prompt from `ctx.getSystemPrompt()`
- Effective messages from `ctx.sessionManager.buildSessionProjection()`, honoring compaction boundaries and latest branch-relative `context_edit` omissions/replacements
- Current transcript-backed tool schemas, grouped by tool name after replaying additions/removals
- User messages
- Assistant messages, including tool-call arguments
- Tool results grouped by tool name
- Largest individual tool-result calls, including call IDs when available
- Latest compaction summary, retained conversation, and branch summaries (including Pi's summary framing)
- Custom context messages from extensions, even when hidden in the UI
- Context-visible shell executions; `!!` output is excluded

System messages and compaction checkpoints are not serialized as extra messages: the current prompt is counted once via `ctx.getSystemPrompt()`, and the replayed tool declarations once per current tool. Usage records, context-edit metadata, labels, and other bookkeeping do not contribute.

## Estimation limits

Pi's available usage total remains authoritative for the header and percentages, even when the local estimate is larger. If Pi reports more tokens than the estimate explains, the gap appears as `Unattributed provider/framing overhead`.

The local breakdown is heuristic, not a provider payload or billing measurement. It estimates current system/tool state rather than historical mid-conversation patches that some providers retain. Pending tool-loadout changes not yet persisted, request-time `context`/`context_with_system` hooks, forced prompt projection, provider payload rewrites, tokenization, and provider framing can differ. Images use small placeholders, not image-token estimates. These differences can make attribution under- or over-count Pi's total; percentages need not sum to 100%.

## Configuration

This extension has no user-facing configuration.

## Logging

This extension does not write retained logs or temp output.
