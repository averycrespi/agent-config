# idle-compaction

Opt-in compaction of large, unattended **open terminal sessions**, using Pi's existing summarization pipeline. Requires Pi **0.87.0 or newer**. Disabled by default.

This can shrink the context sent on a later cold resume. Compaction itself costs tokens and loses some detail: it does **not** guarantee monetary savings, summary fidelity, a warm cache, or any particular provider cache expiry. The inactivity threshold is not evidence that a cache has expired.

## Commands

```text
/idle-compaction-enable
/idle-compaction-disable
/idle-compaction-status
/idle-compaction-config
```

All four commands are standalone and available through Pi's native command completion. The former `/idle-compaction` argument interface is removed; there are no compatibility aliases.

`-enable` and `-disable` save a **session-wide override**, retained across reload/resume and branch navigation, without changing global settings. A fork inherits metadata present in its copied history. Neither toggling nor reloading permits another attempt on an already-attempted unchanged conversation. Invalid configuration or saved metadata cannot be overridden on.

`-status` shows the effective switch, session override, thresholds, and last attempt time/outcome across the session. An attempt recorded as started without a valid completion callback is shown as **interrupted/unknown**, not successful and not retried. `-disable` prevents future initiation; it does not cancel an already-running native compaction.

`-config` displays the global/environment configuration loaded at session startup or reload, independently of the session override. Settings edits require a subsequent session start or reload to take effect. No tool or model-context status messages are registered or injected.

## Configuration

Configure `extension:idle-compaction` in the global Pi `settings.json` (normally `~/.pi/agent/settings.json`). **Project-local settings are deliberately ignored**: a project cannot opt sessions into paid unattended compaction. Environment overrides take precedence. Session overrides change only effective enablement.

| Field            | Default | Environment override              | Description                                                                                                  |
| ---------------- | ------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `enabled`        | `false` | `IDLE_COMPACTION_ENABLED`         | Global opt-in. Boolean environment values accept `1`/`true`, `0`/`false` (also `yes`/`no`).                  |
| `idleMinutes`    | `29`    | `IDLE_COMPACTION_IDLE_MINUTES`    | Continuous observed inactivity, greater than zero and at most 10080 minutes (one week); fractions supported. |
| `contextPercent` | `40`    | `IDLE_COMPACTION_CONTEXT_PERCENT` | Pi-reported usage must be **strictly greater** than this percentage, from 0 through 100.                     |

```json
{
  "extension:idle-compaction": {
    "enabled": true,
    "idleMinutes": 29,
    "contextPercent": 40
  }
}
```

Invalid merged values, malformed/unreadable global settings, and invalid environment overrides disable automatic action with a bounded warning. A missing global settings file uses defaults. Unknown keys are ignored and never displayed. Warnings do not echo raw configuration, file contents, or provider errors. Unknown/non-finite Pi usage skips the check rather than estimating it.

## Behavior and lifecycle

The 29-minute default leaves one minute before an assumed 30-minute cache TTL. [Monitor's default cycle ceiling](../monitor/README.md#configuration) is 28 minutes so attention can arrive first: admitted wake activity resets the idle interval, and queued messages block compaction. These independent clocks do not guarantee delivery ordering or provider cache retention; overrides and delayed timers can change the ordering.

- Runs only in terminal (`tui`) mode, never RPC, JSON, or print mode. It is not a closed-session or detached service.
- Terminal input, input/message/agent activity, user shell commands, model changes, observed UI prompt events, and lifecycle events reset a monotonic inactivity interval. Opening a session starts a fresh interval; there is no overdue catch-up after opening/resuming. A paused process may run its existing timer when resumed, subject to fresh eligibility checks.
- Before invocation it checks enablement, known usage, elapsed inactivity, `ctx.isIdle()`, pending messages, observed blocking extension prompts, and its own outstanding request. A second check runs immediately before saving an attempt and calling `ctx.compact()` without custom instructions. A best-effort before-compaction hook vetoes an owned request made stale during native admission.
- An attempt marker is saved **before** native invocation. At most one attempt occurs for each unchanged conversation in the session, including when navigating back before the marker. Completion, cancellation, failure, extension metadata, and configuration toggles do not reset this suppression. New conversation messages or a new branch summary can enable a later attempt.
- A skipped check does not poll. Subsequent observed activity can schedule another eligibility check; the extension never retries a recorded attempt. Pi's internal summarization/provider retry settings remain unchanged.
- Reload/shutdown and navigation invalidate extension timers and callback ownership. Terminal observers are removed on shutdown. Stale callbacks never write outcome metadata into the new branch/session. They do **not** cancel or roll back Pi's native work.

## Known native limitations — explicitly accepted

These are best-effort guards, **not atomic exclusion** of Pi operations:

1. **Blocking-UI visibility is incomplete.** Pi's `ui_prompt_start/end` hooks cover extension dialogs, not all built-in selectors and prompts. An unattended built-in dialog can remain open while this extension considers the session idle. Prompt notifications themselves are asynchronous. Turn idle compaction off if this is unacceptable.
2. **Native admission/cancellation is not operation-scoped.** `ctx.compact()` is fire-and-forget and begins an asynchronous abort/admission sequence. There is no public cancellation handle for this request, and TUI `ctx.abort()` does not cancel native compaction. Final checks and hooks cannot eliminate races after invocation or control later async hooks/other extensions. Ordinary input during native compaction uses Pi's native queueing. The extension does not intercept input, cancel user navigation, alter queues, patch Pi, or replace summarization.

Pi rejects tree navigation during active compaction, leaving the branch unchanged. Wait for completion or native cancellation before navigating. Complete blocking-UI exclusion is still **not guaranteed**. The extension's attempt, persistence, and callback safeguards remain enforced and tested. Use a single active writer for a session file; concurrent Pi processes sharing one session file are not coordinated by this extension.

## Persistence, logging, and troubleshooting

State is stored as `idle-compaction` custom metadata entries in Pi's normal session JSONL, outside model context. Records contain switches, conversation entry IDs, attempt timestamps, and fixed outcome names, not prompts or error text. They remain until the session is deleted; in-memory sessions retain them only for their lifetime. There are no separate retained logs or temporary output files.

If compaction does not start, inspect `/idle-compaction-status` and `/idle-compaction-config`: check terminal mode, opt-in/override, known usage above the threshold, observed activity, and whether this conversation already has an attempt. Pi may reject small/already-compacted sessions; that still consumes the attempt. Invalid saved metadata fails closed rather than risking a repeat attempt.

## Verification and design

[DESIGN.md](DESIGN.md) describes ownership and persistence invariants. Colocated tests cover deterministic timers, native preparation/hooks/history/usage, race boundaries, failure/cancellation, file-backed reload/resume, and native navigation rejection during active compaction. Native integration tests use real Pi session methods with fixture auth and summary generation, not live providers or a real interactive terminal. They establish neither summary fidelity nor monetary savings.
