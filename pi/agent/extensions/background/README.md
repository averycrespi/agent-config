# Background

Observe conditions or continue an explicitly authorized task without model turns while waiting. Background owns host timers and typed subscriptions; each optional evaluator runs in a fresh [Script](../script/README.md) child. It is a session-bound supervisor, not a persistent JavaScript process, detached service, completion judge, or prompt-cache guarantee.

Background is the repository-supported observer and continuation primitive. See the [retirement inventory and safe transition guide](../../../docs/migrations.md#observer-retirement) before replacing historical jobs. Never register two schedulers for the same work.

## Tool and bounds

`background` exposes immutable `start`, `list`, `get`, and `cancel` actions. No update, pause, resume, extend, reconnect, retry, or automatic restoration of work exists.

Start requires:

| Field              | Meaning                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `name`             | Nonsecret display label, 1–80 characters; control characters are removed.                                               |
| `message`          | Authorized attention instruction, 1–2000 characters; never sent to an observed session.                                 |
| `providers`        | Explicit Script namespaces; `[]` permits pure computation. `trigger` and `state` are reserved evaluator argument names. |
| `cycle_timeout_ms` | Required attention deadline for each cycle: 1000–1,500,000 ms, hard capped at 25 minutes.                               |
| `lifetime_ms`      | Required total wall-clock lifetime: 1000–86,400,000 ms, including setup and time awaiting settlement.                   |
| `max_wakes`        | Required maximum handoff attempts: 1–100. One-shot default requires 1.                                                  |

Optional `recurring: true` enables recurrence. Select at least one trigger:

- `interval_ms` (1000–1,500,000) plus `source`: initial evaluation after subscriptions are established, then polling no sooner than one interval after the previous evaluation settles. Events can be combined with polling.
- `delay_ms` (1000–1,500,000): timer-only, no-code continuation. Incompatible with source, polling, and events. The first delay starts on admission; subsequent delays start after the awakened run settles.
- `events`: up to four `{provider, event, args}` subscriptions. Without source, any selected event requests attention. With source, the evaluator receives its safe payload and can implement a compound condition. Subscriptions activate on any selected source, not an implicit AND.

`source` is an async JavaScript body, at most 232 KiB UTF-8, reserving space for safely encoded trigger/state under Script's source ceiling. `state` is optional initial plain JSON, default `null`, at most 4096 bytes. Return `{decision: "wait" | "wake", evidence: JSON, state?: JSON}`. Evidence and replacement state are each at most 4096 UTF-8 bytes. Omit state to retain it; return `state: null` to replace it with null. `stop` is not an evaluator decision: agent/user cancellation and host lifecycle/failure/budgets own termination.

`list` returns compact receipts and permitted typed-event schemas; optional `providers` narrows discovery. `get` requires `id` and returns a bounded receipt, never source. `cancel` requires one job UUID and stops that job only. Invalid/action-inapplicable fields reject without partial registration. Canceling the registration tool before admission prevents registration; after admission its abort signal no longer owns the job. Use `cancel` then. Subscription setup failure rolls back staged subscriptions and admits no job; it does not undo external effects.

## Clocks, queues, and attention

The polling interval, cycle timeout, continuation delay, and total lifetime are distinct clocks. Setup counts toward the first cycle and lifetime. Subscriptions are installed before initial evaluation; accepted setup events precede the initial trigger. Receipts retain each provider's actual coverage boundary. There is no pre-registration catch-up claim.

Evaluations are serial within a job, with two shared execution slots across four occupied jobs. Up to 32 ordered event triggers are buffered per job. Overflow ends coverage and requests explicit failure attention; wake coalescing never replaces the event queue. Poll timers are coalesced: there are no missed-interval catch-up bursts, and completion of an event evaluation also postpones the next poll. Recurring observers continue accepting/evaluating events and polling while the agent works, including while attention awaits handoff or settlement. Timer-only continuation does not accumulate ticks during agent work.

Only a wholly successful evaluation commits state/evidence. Script's host accounting wins over guest catches and returned decisions. Failed JSON is discarded as uncommitted; previous committed state/evidence remains. Every evaluation failure terminates in v1, even a safe pre-dispatch failure. There are no retries, grants, approval polling, or replay. Successful external mutations are not rolled back by later failures or cancellation.

Attention distinguishes `condition`, `timeout`, `evaluation_failure`, `coverage_failure`, and `budget_exhausted`. Timeout requests attention even without a satisfied condition; it proves neither success nor failure of the watched task. The notification includes latest committed evidence, its age (or null when none exists), interrupted work/coverage gaps, possible effects, unknown outcomes, and whether recurrence remains enabled. A recurring cycle timeout does not cancel a bounded evaluation already running; handoff waits for its accounting. One-shot completion, cancellation, failure and lifetime exhaustion abort remaining work. Delivery eligibility is bounded, not guaranteed model consumption time or cache retention; blocking trusted host code can delay timers.

Background retains at most one cancelable pending attention per job while Pi is active. Repeated wakes coalesce; failure outranks timeout, which outranks a condition. Background never steers a turn. On idleness/settlement it persists an attempt, then calls Pi once with follow-up delivery. Dispositions are `pending`, `suppressed`, `handoff_unknown`, and `handed_to_pi`. A returned API call is **not consumption acknowledgment**. Missing history/queues never authorizes replay, and cancel never retracts unrelated Pi messages.

A unique wake ID is matched only against a positive custom `message_start` event. This establishes runtime admission, not provider/model consumption or semantic success. Only a later `agent_settled` rearms recurrence. Pi may batch messages; there is no promise of a dedicated turn per wake. Unrelated settlements do not rearm an unobserved wake. An uncertain/unobserved handoff is never resent; lifetime still terminates observation. Attention that cannot safely follow an unobserved handoff remains inspectable/cancelable rather than manufacturing acknowledgment. Final wake-count exhaustion stops without an extra over-budget notification. New attention after the cap—including evaluation or coverage failure while the awakened agent works—is retained with `suppressed` disposition and its new cause/accounting, separately from the already-handed notification.

## Examples

First inspect `script describe` and `background list` for real provider schemas. Examples use fictional domain calls where noted; substitute discovered names and validate their actual envelopes.

### Polling

```js
background({
  action: "start",
  name: "check",
  message: "Inspect the evidence and report the next action.",
  providers: ["mcp"],
  interval_ms: 30000,
  cycle_timeout_ms: 1200000,
  lifetime_ms: 1500000,
  max_wakes: 1,
  source: `
    const result = await mcp.call("example.check", {id: "example"});
    if (result.isError) throw new Error("failed check");
    const status = result.structuredContent?.status;
    if (!["pending", "passed", "failed"].includes(status)) throw new Error("invalid status");
    return {decision: status === "pending" ? "wait" : "wake", evidence: {status}};
  `,
});
```

### Cross-session events

With `sessions` permitted in Script's global allowlist, use Script's `sessions.list()` to discover exact incarnation UUIDs. Both sessions must load Background. Discovery does not launch/reload sessions or read transcripts. Replace the illustrative UUID below with a discovered one.

```js
background({
  action: "start",
  name: "worker",
  message: "Inspect the event; settlement is not task completion.",
  providers: ["sessions"],
  cycle_timeout_ms: 1200000,
  lifetime_ms: 1500000,
  max_wakes: 1,
  events: [
    {
      provider: "sessions",
      event: "lifecycle",
      args: [
        "11111111-2222-4333-8444-555555555555",
        ["agent_settled", "ask-user:input_requested"],
      ],
    },
  ],
});
```

The same provider accepts `"local"` for current-incarnation observation. Selectable events are `agent_start`, `agent_settled`, `session_shutdown`, `ask-user:input_requested` (request UUID only), and `ask-user:input_resolved` (UUID plus answered/cancelled/failed). Built-in hooks carry no content. Background bookkeeping events are deliberately excluded to avoid feedback loops. Settlement can occur while a child CI job is still pending; reconcile its checkpoint and external state, never infer task completion. Input attention grants no permission to answer for the user.

Background owns its same-user Unix transport at `/tmp/pi-background-events-<uid>/` (canonical `/private/tmp` on macOS). Mode-0700 directory, mode-0600 sockets, exact incarnation/nonce and increasing sequence checks apply. Coverage begins when target filters are installed before ACK; earlier events are excluded. Disconnect/replacement/invalid identity fails coverage without reconnect/replay. No transcripts, questions/options/answers, credentials, raw bus bindings or session control are exposed. This is cooperative same-user isolation, not hostile-process authentication. Discovery probes at most 128 entries with four probes in flight; transport allows 16 incoming sockets, a two-second handshake and an 8 KiB receive buffer. It never deletes stale/unrelated files.

### Settlement-based continuation

```js
background({
  action: "start",
  name: "bounded follow-through",
  message:
    "Do the next authorized step; cancel this job when no further work is useful.",
  providers: [],
  recurring: true,
  delay_ms: 5000,
  cycle_timeout_ms: 1200000,
  lifetime_ms: 3600000,
  max_wakes: 10,
});
```

Before requesting user input, cancel the continuation job and reconcile its receipt; do not leave recurrence waking while waiting for a decision. There is no yield/resume/extend. After real user input, start a fresh immutable registration only within existing authority and caller-retained remaining lifetime/wake allowance. Cancellation cannot retract a Pi-owned follow-up. Count attempted/unknown handoffs conservatively, never reset consumed workflow budgets. The first delay begins on admission; only subsequent delays follow positively correlated settlement. Evaluators return wait/wake, never terminate a recurring job; cancel when no useful authorized work remains.

### Compound polling and events with explicit state

```js
background({
  action: "start",
  name: "compound",
  message: "Inspect both observed conditions before proceeding.",
  providers: ["sessions", "mcp"],
  interval_ms: 30000,
  cycle_timeout_ms: 1200000,
  lifetime_ms: 3600000,
  max_wakes: 3,
  recurring: true,
  events: [
    {
      provider: "sessions",
      event: "lifecycle",
      args: ["local", ["agent_settled"]],
    },
  ],
  state: { settled: false },
  source: `
    const settled = state.settled || trigger.payload?.name === "agent_settled";
    const result = await mcp.call("example.check", {id: "example"});
    if (result.isError) throw new Error("failed check");
    const passed = result.structuredContent?.status === "passed";
    return {decision: settled && passed ? "wake" : "wait", evidence: {settled, passed}, state: {settled}};
  `,
});
```

## Authority, configuration, and retention

Only explicitly authorized monitoring/continuation may be registered. Repeated provider mutations are supported when applicable user authority covers them. Provider permission is not approval. Nested calls retain Script admission, redaction, cancellation, host traces, and isolation; no synthetic nested Pi tool hooks are emitted. Trusted providers must not expose secrets in schemas or payloads.

No Background settings or environment overrides exist; ceilings are fixed. Provider policy and evaluator limits come from [Script's global/environment configuration](../script/README.md#policy-and-configuration), never project settings. Enable only needed namespaces, for example `allowedProviders: ["sessions", "mcp"]`; editing/installing configuration and reloading a live session require separate authorization. Invalid Script policy fails closed. Event registration alone grants no permission. The optional session provider may be unavailable on unsupported/unsafe transports; timer-only jobs still work.

Hard bounds: 4 occupied jobs (including registration, cleanup and pending attention), 2 concurrent evaluations, 32 event triggers per job, 10,000 evaluations per job, 8 provider calls and 2 concurrent calls per evaluation, and 30 seconds per evaluation tightened by Script. Script's source/IPC/output and isolation limits still apply. At most 32 receipts are retained/restored, examining 4096 ancestors. Source is released when observation ends. Accounting retains the latest bounded trace plus cumulative counts/possible-effect flags, not an unbounded call log. Inspection output is capped at 48,000 bytes and fails rather than spilling/replaying when oversized.

Receipts include optional `endedAt`, the first host observation-stop timestamp. Later queued delivery or cancellation of pending attention does not move it. Active receipts have no end time. Older/restored interrupted receipts may lack it; callers must charge unknown intervals conservatively rather than infer an end from a deadline or notification. This supports caller-owned cumulative allowances without changing attention semantics.

Jobs belong to the originating session branch. Shutdown, reload, replacement and reached before-tree navigation invalidate observations and suppress extension-owned pending handoffs. Before-tree invalidation is conservative even if navigation is later canceled; no history is appended during tree preparation. Destination history restores **receipts only**, never subscriptions, children or notifications. Stale callbacks cannot wake another context. No work continues while Pi is closed, and timers/sockets do not keep a print/JSON process alive.

No standalone logs, source files or result spills are written. Ordinary Pi history retains original arguments, state, evidence and `background:receipt-v1` entries. Entries are individually bounded; append-only history is not globally bounded. Abrupt exit may lose final accounting, and old receipts can fall outside the restoration window. Providers can have their own audit/clone/spill retention. Generic JSON framing is not secret detection; choose evidence carefully.

## Tool display

Collapsed results summarize the requested action, not a generic inspection acknowledgment:

- `list`: `2 active · 5 retained`, `no active jobs · 7 retained`, or `no jobs`. Retained includes active and terminal receipts; pending follow-ups are counted separately. Expand for the named inventory.
- `get`: `CI check · polling · 0 wakes · 4 evaluations`, or a terminal reason such as `evaluation failed · script_error`. Counts report attempts, not watched-task success.
- `start`: `CI check · polling every 30s · timeout 20m`, `Reminder · scheduled · in 5s · timeout 20s`, or `Follow-through · every 5s after settlement · timeout 20m · max 2 wakes`. Event-only and combined polling/event jobs are distinguished. These are static registration summaries, not countdowns or completion claims.
- `cancel`: `CI check · cancelled` versus `CI check · already finished`. Uncertain effects, uncertain handoffs, and already-handed follow-ups remain visible; cancellation does not retract Pi-owned messages or roll back effects.

Expand single-job results for identity, accounting summaries and handoff disposition. Custom rows never expose source, arguments, state, evidence, or raw exception text. Names are nonsecret display labels, sanitized and width-bounded. Failed requests retain the action/target context.

## Widget and qualification

One stable, width-bounded row per visible job appears below the editor. Identity comes before descriptive activity and labeled timing:

```text
background · CI check · polling · next check 3s · timeout 12s
background · Worker · watching events · timeout 15m
background · Follow-through · continue in 5s · timeout 20s · wakes 0/2
background · CI check · timed out · follow-up queued
background · Follow-through · awaiting settlement · wakes 1/2 · expires 50s
```

`next check` is the next poll, not a model wake. `timeout` is the current attention deadline; `expires` is total lifetime, shown instead when it ends sooner or while awaiting settlement. An in-flight evaluation shows `checking` without a stale next-check countdown. Pending attention shows its cause and `follow-up queued` rather than a misleading ticking clock. Neither condition attention nor a finished receipt proves watched-task success.

Activity uses accent, pending attention/settlement warning, failures error; there is no green activity state, source, payload or evidence. Narrow rows drop the redundant `background` prefix, shorten long names, and drop secondary telemetry while preserving identity and primary state when space permits. Pending attention remains visible until handoff/suppression even after observation ends. Finished/canceled rows disappear after handoff/suppression. TUI mounts once and repaints in place at most once per second for countdowns; RPC uses string arrays and headless mode makes no UI calls. Older receipts without trigger metadata remain inspectable without guessing a polling/continuation mode.

Tests qualify deterministic scheduling, actual Script children/providers, local event-bus and cross-process Unix transport fixtures, restoration, and controlled TUI/RPC/headless contexts. They do not qualify a live interactive session, actual model consumption, real external mutations, suspend/clock jumps, or provider prompt-cache behavior. Nothing is installed or reloaded by tests. See [DESIGN.md](DESIGN.md) and [API.md](API.md).
