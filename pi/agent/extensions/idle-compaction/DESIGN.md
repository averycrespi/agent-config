# Idle compaction design

## Ownership and modules

`index.ts` binds Pi lifecycle events, one non-consuming terminal observer, and four standalone human commands (enable, disable, status, and configuration inspection). Native command registration supplies completion; no argument dispatcher or legacy alias is retained. Enable/disable persist the same session override, and all four commands account for activity. It loads configuration asynchronously using a generation guard so shutdown/replacement cannot be undone by a late load. Factories register handlers only; timers begin at session start. No agent tool, custom summarizer, model prompt, widget, cross-extension protocol, or background process is introduced.

`controller.ts` owns one timer, the latest context, observed prompt state, callback epoch, activity generation, and an optional in-flight native request. Clock injection makes timer boundaries deterministic; production uses monotonic elapsed time and wall-clock attempt timestamps. A timer version invalidates dispatched callbacks even after cancellation. Timer delays are bounded by validated configuration, and production timers are unref'd.

`config.ts` validates global settings/environment values, using shared merge, section extraction, boolean parsing, and inspection conventions. It intentionally avoids the shared file reader's permissive read-error fallback: opting into paid automatic work must fail closed for unreadable/malformed settings. No project-local configuration is consumed. Invalid values cannot be rescued by a session enable override. Config inspection returns only validated declared fields and fixed warnings, never raw inputs.

`state.ts` validates versioned custom entries and restores session-wide switches and attempted conversation identities. Unknown schema/corruption disables action without rewriting history. Session-file concurrency is owned by Pi; this extension provides no cross-process coordination.

## Conversation identity and durable attempts

A conversation identity is the ID of the newest message, custom context message, or branch summary on the active path. Since Pi entry IDs identify immutable nodes with a fixed ancestor path, the newest conversational node identifies that path without hashing private content. Compaction and all metadata entries are excluded. Thus success and metadata never rearm the same conversation, but genuine additional conversation content can.

Restoration reads **all session entries**, not merely the current branch. Otherwise `/tree` could navigate immediately before an attempt marker and repeat an already attempted conversation. The latest valid override is session-wide. An attempted-ID set includes every recorded outcome; last-attempt status reflects append order across the whole session. Fork behavior follows the history copied by Pi, not external state.

Before calling native compaction, append a `started` record. If persistence throws, stop automatic action; do not invoke compaction. Persisting and invoking have no intervening extension await, though native work yields internally. The conservative failure window is intentional: a process can die after saving the attempt but before making the request, leaving an interrupted/unknown attempt that is still not retried.

A completion callback may append a fixed outcome only if its flight, epoch, session ID, and conversational identity still match. Navigation/shutdown invalidates ownership. A still-started record restored without a live owner displays interrupted/unknown. No error strings, prompts, summaries, or configuration contents enter metadata. Never convert these custom records to `sendMessage()` output: that would change context and potentially rearm automation.

## Scheduling and native boundary

Activity clears the previous timer and establishes a new interval. Observed prompts and owned in-flight work suppress scheduling. At wake, eligibility reads current Pi state and usage twice, then records the attempt and invokes `ctx.compact` without instructions. A failed eligibility check does not poll; a later activity event may schedule a new check. Recorded attempts are never retried by the extension, even after toggles, failures, or successful manual compaction.

The before-compaction handler provides a best-effort veto for activity during an owned request's native admission. It is not a final host lock: hooks can await and another extension can act after it. Unowned native compaction is treated as activity; manual/automatic compaction terminal events also reset inactivity. Native `isIdle()` in the minimum supported Pi version includes compaction, avoiding automatic initiation during visible existing compaction.

The [README's accepted limitations](README.md#known-native-limitations--explicitly-accepted) are incomplete native UI observation and asynchronous admission with no operation-scoped cancellation. Pi 0.87 rejects tree navigation during active compaction; native integration coverage verifies rejection without branch mutation and subsequent completion on the original branch. Epoch checks still protect **extension metadata** across lifecycle changes, not native summary writes. Do not broaden `ctx.abort`, intercept queues/navigation, or monkey-patch Pi to manufacture a stronger guarantee.

## Verification seams

`test-support.ts` provides an injected clock and actual in-memory/file-backed SessionManager fixtures. `index.test.ts` exercises registered extension handlers and commands, checking observable compaction calls, unchanged model-context messages, metadata, observer cleanup, and stale callback suppression. `config.test.ts` covers opt-in, precedence, limits, sanitized warnings, and fail-closed reads.

`native.test.ts` runs actual AgentSession manual compaction, preparation, hook dispatch, history and usage persistence, and tree navigation. Auth/transport/summary generation are fixtures; the native pipeline and extension entrypoint are not. It verifies success, native abort/failure, admission-boundary input, and zero new turns. Navigation coverage asserts safe rejection during active compaction, unchanged history, original-branch completion, and return to idle. The partial AgentSession fixture initializes constructor-owned message provenance so the real finalized-context refresh runs; it must not stub that refresh or weaken completion assertions.
