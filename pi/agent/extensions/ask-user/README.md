# ask-user

Pi extension that provides an `ask_user` tool for interactive multiple-choice decisions, with an opt-in nonblocking mode for parent-managed children.

## Tools

### `ask_user`

Ask the user a multiple-choice question and return their answer. Use when multiple valid approaches exist with meaningfully different trade-offs. Keep the prompt brief and scannable; do not paste long design sections or walls of text into `context`. Do not use for trivial confirmations.

**Parameters:**

| Parameter     | Type    | Required | Description                                                              |
| ------------- | ------- | -------- | ------------------------------------------------------------------------ |
| `question`    | string  | yes      | The question to ask; keep it focused and concise                         |
| `context`     | string  | no       | Brief framing shown above the options; summarize, don't paste long text  |
| `options`     | array   | yes      | 2–5 choices, each with a `label` (required) and `description` (optional) |
| `recommended` | integer | no       | 0-indexed option to mark as "(Recommended)"                              |

An "Other (type your own)" option is always appended automatically — do not include one in `options`.

**Returns** one of:

- `"User selected: 2. Option Name"` — chosen option with its 1-based index
- `"User wrote: <text>"` — free-text answer via the Other path
- `"User cancelled — no option selected."` — user pressed Escape or the tool call was aborted

Interactive `details` contain `cancelled`; successful answers also include `answerLabel`, `answerIndex`, and `isCustom`. Parent-managed calls instead return `status: "decision_required"`, a fresh `requestId`, `mode: "parent"`, `cancelled: false`, `answerSupplied: false`, and `approvalSupplied: false`, with no answer fields. Check the discriminator before treating a non-cancelled result as an answer. This is neither a user selection nor cancellation. See [API.md](API.md#parent-managed-result).

## UI behavior

Renders a custom TUI widget at the bottom of the terminal:

- Options are numbered (1, 2, 3…) and navigated with ↑↓ arrows
- Enter selects the highlighted option
- Selecting "Type something." opens an inline editor; Escape returns to the list without cancelling
- Escape from the option list cancels the prompt
- The recommended option is labelled "(Recommended)"
- Option descriptions appear below their label in muted text
- Context (if provided) appears between the question and the options
- While the prompt is open, the extension emits balanced `herdr:blocked` events so an installed Herdr integration reports the agent as blocked; the event is harmless when no listener is installed

With the environment mode unset, non-interactive execution (`!ctx.hasUI`) returns an error immediately. Parent mode works without UI.

## Extension events

`ask-user:input_requested` and `ask-user:input_resolved` on `pi.events` correlate actual input waits with a generated request UUID and `answered`, `cancelled`, or `failed` outcome. They omit question/answer content and grant no authority to answer for the user. Parent-managed results and invalid mode configuration emit neither input events nor Herdr blocked signals. Invalid requests, pre-abort, headless mode, and RPC's unsupported custom UI do not announce a wait. Existing Herdr signaling is preserved. See [API.md](API.md) for types, timing, privacy, and subscription examples.

## Configuration

`PI_ASK_USER_MODE` is an environment-only launch setting, captured when the extension loads; it deliberately has no settings-file field or config command. Unset preserves existing interactive behavior. The only configured value is the exact string `parent`; any other value (including empty or whitespace) rejects calls with an explicit configuration error, without opening UI or echoing the value. Reconcile invalid launch configuration with the parent/operator; do not bypass the mode.

For a parent-managed child process:

```bash
PI_ASK_USER_MODE=parent pi
```

Valid, unaborted calls return immediately with a decision-required result and guidance: resolve from existing evidence within authority where possible; otherwise report the request ID, question/options/recommendation, evidence and blocked work with assignment/revision, run/session/incarnation and ticket identity when applicable to the parent. Checkpoint and yield when no authorized independent work remains, retaining sole ownership. Do not retry the same question or bypass the mode. The extension neither sends the request to another session nor answers it, and keeps no pending inbox.

[Work-stack](../../skills/work-stack/SKILL.md) and [repo coordination](../../skills/coordinate-repo/SKILL.md) set this only for managed child processes and reuse the [shared decision protocol](../../skills/spin-out/references/decisions.md). It retains requests in child checkpoints, uses ordinary `agent_settled` attention, and validates correlated continuation. Concurrent coordinators announce pending questions in ordinary conversation without entering a modal tool wait, so unrelated results can be reconciled. This workflow contract does not add an inbox or an asynchronous answer API to ask-user. Human-facing parents and standalone spin-outs retain ordinary tool defaults. This is coordination, not a security boundary or approval mechanism; it does not intercept other UI tools. No installation or live reload is implied.

## Logging

This extension does not write retained logs or diagnostic files.

## Prior art

- [ghoseb/pi-askuserquestion](https://github.com/ghoseb/pi-askuserquestion/) — Pi extension for structured single-select, multi-select, multi-question, and free-text user questions inspired by Claude Code's AskUserQuestion tool.
- [edlsh/pi-ask-user](https://github.com/edlsh/pi-ask-user) — searchable single/multi-select options, freeform responses, and a bundled skill that prompts agents to seek input on architectural trade-offs
- [mitsuhiko/agent-stuff answer.ts](https://github.com/mitsuhiko/agent-stuff/blob/main/pi-extensions/answer.ts) — extracts embedded questions from assistant responses using an LLM, then presents a sequential multi-line editor UI for answering each one
- [jayshah5696/pi-agent-extensions ask-user](https://github.com/jayshah5696/pi-agent-extensions/tree/main/extensions/ask-user) — supports free-form text, single-select, and multi-select question formats, plus a non-interactive print mode for asynchronous answering
- Claude Code's `AskUserQuestion` tool — built-in interactive question tool in the Claude Code CLI
