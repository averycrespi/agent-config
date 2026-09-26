# Coordinate design

Keep policy in agent guidance and effects in existing primitives. `index.ts` owns commands, role checks, request-local context and the three-action tool. `state.ts` uses the retained canonical index helper for atomic validate/readback persistence; it never reconstructs external acceptance from transcript history. `launch.ts` adapts one Markdown brief to the existing finite Herdr launch helper. The helper's explicit Coordinate mode accepts caller naming/path choices while retaining legacy behavior for existing runs.

## Ownership and effects

Exact session UUID plus canonical checkout/common directory bind a role. Coordinator records own assignments/control/acceptance; child records contain pointers only. Appended session entries do not authorize restoration or takeover. External active/disabled state survives navigation; active forks reject. One in-process mutation guard excludes concurrent commands/tool operations, while the canonical helper detects stale manual index edits. This is cooperative ownership, not hostile-process fencing.

All launch effects retain intent before dispatch and confirmed receipts after readback. Prepare validates identity/source/collisions and creates a worktree/workspace, ignored handoff and unprompted worker. Coordinate binds the exact returned child session and records reporting before submit. Two fresh process-local coverage inspections gate submission. A bounded transcript/state handshake distinguishes confirmed execution from uncertain submission. Partial outcomes retain resources; no continuation/retry/rollback is implemented. Legacy prepare/submit remains a recovery mechanic, not a competing saved definition.

## Narrow read-only integration

Mailbox and Monitor expose process-local inspection functions documented in their API files. Mailbox projects availability/pending count without contents. Monitor projects a receipt and a boolean match against the caller's expected canonical recipe source; no source is returned. Neither inspection mutates storage, registers jobs, handles reports or creates turns. Unknown receipts stay unknown after reload; restoration is Monitor-owned and never restarts observation. Coordinate uses the CONFIG-35 canonical default recurring recipe rather than building a second scheduler.

## Boundaries

The tool records explicit acceptance claims with exact head/result/evidence/release references; it cannot prove semantic evidence truth. Agents inspect evidence first. Manual report incorporation and control use the same external index and preserved helpers; no automatic ACK/answer/semantic acceptance engine is added. Status projects reported and verified fields separately, and truncation points to the complete record without discarding retained facts.

Context hooks run before each model request and remove only Coordinate's own prior custom reminder. Session pointers are retained once, not full reminders or delivery ledgers. Child guidance persists without enabling coordinator operations. No settlement hooks force reporting or turns. Rendering sanitizes identifiers and uses existing compact helpers; there is no widget, dashboard or configuration subsystem.
