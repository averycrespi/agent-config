# Loop Extension Design

`loop` is a targetless liveness primitive. It owns bounded continuation scheduling and lifecycle state while leaving objectives, completion policy, progress interpretation, and verification to callers such as users, skills, or other extensions.

## Architecture

- `index.ts` wires session lifecycle, commands, branch restoration, settled-run scheduling, public API binding, shared events, persistence, and the widget.
- `state.ts` owns lifecycle transitions, running-time accounting, hard-ceiling validation, generation invalidation, snapshot parsing, and display-safe formatting.
- `tools.ts` registers the unified agent tool, validates action-specific parameters atomically, and maps snake_case tool fields to internal camelCase fields.
- `api.ts` is the curated cross-extension surface; `runtime.ts` binds it to the active session instance.
- `config.ts` loads and validates settings and environment overrides.
- `render.ts` produces the fixed-size, width-aware widget.

Lifecycle handlers and callers mutate state only through `createLoopStore()`. Mutation snapshots are cloned before exposure.

## State

There is at most one loop per active Pi session branch. Statuses are:

- `running`: active time accrues and successful settlement may claim a continuation.
- `yielded`: active time is paused; the next non-extension user input wakes it.
- `stopped`: active time is paused and only explicit resume may restart it.

Normal user input does not change a running loop. A stopped loop cannot yield because that would convert explicit-resume semantics into automatic wake semantics.

Continuation and running-time limits are absolute. Extend can only increase them, never resets counters, never resumes, and cannot exceed configuration ceilings. Resume checks current usage before transitioning. Each loop also persists a non-negative continuation delay bounded by configuration; older snapshots normalize to zero delay.

Each start and clear advances a generation. Scheduler callbacks compare the claimed loop generation before sending so stale work cannot revive or continue a replaced loop. Lifecycle mutations that make an existing wait stale abort its timer.

## Scheduling

`agent_end` records the latest terminal outcome. Aborts stop immediately. Provider errors remain pending so Pi may retry or compact and recover.

`agent_settled` is the scheduling boundary because Pi has no automatic retry, compaction recovery, or queued follow-up left. The scheduler then:

1. rejects duplicate settlement for the same recorded run;
2. stops on an unrecovered provider error;
3. defers when Pi reports pending messages;
4. verifies the loop is still running;
5. waits for the configured delay while active time continues to accrue;
6. rechecks generation, running state, idleness, pending messages, and limits;
7. atomically claims one continuation;
8. persists the incremented counter;
9. emits the mutation event;
10. sends one custom follow-up with `triggerTurn: true`.

The continuation's model-visible content contains the caller message and a stable control reminder. Exact counters remain out of that message to avoid budget-driven rushing, but are available through state inspection and the widget. Delay is deterministic scheduler state rather than prompt advice; polling guidance only tells the caller to select an interval and keep each continuation to one polling batch.

## Persistence

Mutations append `loop-state` custom entries. Tool results also carry the full snapshot, supporting restoration when the tool mutation itself is on the active branch.

Restoration scans only `ctx.sessionManager.getBranch()` and uses the latest valid snapshot. Persisted running loops normalize to stopped with `session_restored`; reloading or navigating must not spontaneously trigger work.

Compaction needs no custom summary. The loop has no objective to preserve in model context, state lives in custom entries, and each continuation rebroadcasts its caller-provided message.

## API and events

`api.ts` exposes one stable module-level proxy. `session_start` binds it to the current extension instance, and `session_shutdown` unbinds it. Captured state snapshots remain plain data; callers must not retain session-bound controller internals.

Typed API subscriptions and `pi.events` receive lifecycle events after state mutation and persistence. Control is intentionally shared: there is no owner or lease field. All callers use the same state machine and hard ceilings.

## UI

The informational widget uses key `loop` and `belowEditor` placement. It shows precise counters because the widget is user-facing, while continuation prompts omit them. Dynamic message and reason text is control-stripped, whitespace-collapsed, and width-truncated.

Tool rows follow the shared action grammar: a stable emphasized `loop` title, muted action-first summary, compact state result, and optional expanded transition. Start calls show bounds but never echo the continuation message. Renderers use `_shared/render.ts` for width-aware component reuse and sanitize dynamic reasons and errors before styling.

## Security and boundaries

Continuation messages and reasons are untrusted caller data. They remain custom-message content rather than system-prompt instructions. The extension performs no filesystem, network, shell, git, or external-service action itself.

Configuration ceilings apply equally to the tool, commands, and imported API. Raising a ceiling requires settings or environment changes outside the loop lifecycle surface.

## Non-goals

- Objective tracking or goal completion.
- Verification, evidence auditing, or task-state interpretation.
- Background work after process exit.
- Project-global or cross-session loops.
- Automatic restart after restoration.
- Token or cost enforcement.

## Change guidance

Keep state transitions and limit checks centralized in `state.ts`. Preserve delay-before-claim and claim-before-send ordering, post-delay lifecycle checks, timer cancellation, settlement deduplication, generation checks, stopped-versus-yielded semantics, shared ceilings, and safe restoration. Add state tests before lifecycle tests when changing transitions. Update README and API documentation for any user-facing or cross-extension contract change.
