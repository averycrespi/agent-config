# context-usage Design

`context-usage` provides a lightweight token-blame command for the current Pi session branch. It is diagnostic only: it reads context state, estimates rough token contribution by source, and reports the largest contributors.

## Architecture

- `index.ts` contains the complete extension: context extraction, rough token estimation, grouping, report rendering, and `/context-usage` command registration.
- `createContextUsageExtension()` exists so tests can instantiate the extension with a fake Pi API.
- `renderContextReport()` is exported as pure formatting logic for direct testing.
- `index.test.ts` covers grouping, detailed rendering, largest tool-result ranking, and fallback behavior.

There is no persistent state, configuration, retained logging, or agent tool surface.

## Data sources

The command combines two kinds of context information:

- Pi-reported usage from `ctx.getContextUsage()`, when available.
- Locally visible branch content from `ctx.sessionManager.getBranch()` plus the effective system prompt from `ctx.getSystemPrompt()`.

The local estimate is intentionally approximate: `Math.ceil(text.length / 4)`. Do not replace this with provider-specific tokenization unless the design also handles model/provider differences and test stability. The command is meant to identify obvious context hogs, not produce billing-grade token counts.

## Blame model

The report groups visible context into stable human-readable buckets:

- system prompt and project instructions;
- user messages;
- assistant messages, including serialized tool-call arguments;
- tool results grouped by tool name;
- individual large tool-result calls;
- compaction and branch summaries;
- custom context messages from extensions;
- fallback buckets for unknown message or entry shapes.

If provider-reported usage is larger than the local branch estimate, the difference is reported as `Unattributed provider/framing overhead`. This is expected and can include tool schemas, provider serialization, tokenization differences, or context unavailable through the session branch API.

## Rendering contract

`/context-usage` should stay compact by default. It shows the largest grouped sources and top individual tool results. `/context-usage --details` expands to all groups and includes short examples.

Keep report output deterministic and plain text. It is shown through `ctx.ui.notify()`, so it should be readable in the TUI and useful in transcripts without relying on custom widgets.

## Safety and boundaries

The command may display previews of session content, including tool output. Keep previews short and single-line. Do not write context dumps to disk or add automatic upload/export behavior.

This extension should remain read-only. It must not mutate session entries, trigger compaction, edit context, or change model settings.

## Non-goals

- No exact tokenizer integration.
- No persisted metrics or history.
- No dashboard or visualization.
- No automatic compaction recommendations beyond showing large sources.
- No agent tool; the slash command is sufficient for interactive diagnostics.

## Change guidance

When adding support for new `SessionEntry` or content block shapes, update the grouping logic and tests together. Prefer conservative fallback serialization for unknown shapes so the command remains robust across Pi API changes. Keep the estimator and output stable unless the README is updated to explain a user-visible behavior change.
