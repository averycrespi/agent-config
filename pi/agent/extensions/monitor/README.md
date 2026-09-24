# Monitor

Observe conditions or continue an explicitly authorized task without model turns while waiting. Monitor owns host timers and typed subscriptions; each optional evaluator runs in a fresh [Script](../script/README.md) child. It is a session-bound supervisor, not a persistent JavaScript process, detached service, completion judge, or prompt-cache guarantee.

Monitor is the repository-supported observer and continuation primitive. See the [Background-to-Monitor cutover](../../../docs/migrations.md#background-to-monitor) and [retirement inventory and safe transition guide](../../../docs/migrations.md#observer-retirement) before replacing historical jobs. Never register two schedulers for the same work.

## Tool and bounds

`monitor` exposes immutable `start`, `list`, `get`, and `cancel` actions. No update, pause, resume, extend, reconnect, retry, or automatic restoration of work exists.

Start requires:

| Field              | Meaning                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `name`             | Nonsecret display label, 1–80 characters; control characters are removed.                                               |
| `message`          | Authorized attention instruction, 1–2000 characters; never sent to an observed session.                                 |
| `providers`        | Explicit Script namespaces; `[]` permits pure computation. `trigger` and `state` are reserved evaluator argument names. |
| `cycle_timeout_ms` | Required attention deadline per cycle: 1000–`maxCycleTimeoutMs` ms (default ceiling: 28 minutes).                       |
| `lifetime_ms`      | Required total lifetime: 1000–`maxLifetimeMs` ms (default ceiling: 24 hours), including setup and awaiting settlement.  |
| `max_wakes`        | Required maximum handoff attempts: 1–100. One-shot default requires 1.                                                  |

Optional `recurring: true` enables recurrence. Select at least one trigger:

- `interval_ms` (1000–`maxCycleTimeoutMs`) plus `source`: initial evaluation after subscriptions are established, then polling no sooner than one interval after the previous evaluation settles. Events can be combined with polling.
- `delay_ms` (1000–`maxCycleTimeoutMs`): timer-only, no-code continuation. Incompatible with source, polling, and events. The first delay starts on admission; subsequent delays start after the awakened run settles.
- `events`: up to four `{provider, event, args}` subscriptions. Without source, any selected event requests attention. With source, the evaluator receives its safe payload and can implement a compound condition. Subscriptions activate on any selected source, not an implicit AND.

`source` is an async JavaScript body, at most 232 KiB UTF-8, reserving space for safely encoded trigger/state under Script's source ceiling. `state` is optional initial plain JSON, default `null`, at most 4096 bytes. Return `{decision: "wait" | "wake", evidence: JSON, state?: JSON}`. Evidence and replacement state are each at most 4096 UTF-8 bytes. Omit state to retain it; return `state: null` to replace it with null. `stop` is not an evaluator decision: agent/user cancellation and host lifecycle/failure/budgets own termination.

`list` returns compact receipts and permitted typed-event schemas; optional `providers` narrows discovery. `get` requires `id` and returns a bounded receipt, never source. `cancel` requires one job UUID and stops that job only. Invalid/action-inapplicable fields reject without partial registration. Canceling the registration tool before admission prevents registration; after admission its abort signal no longer owns the job. Use `cancel` then. Subscription setup failure rolls back staged subscriptions and admits no job; it does not undo external effects.

## Clocks, queues, and attention

The polling interval, cycle timeout, continuation delay, and total lifetime are distinct clocks. `interval_ms` is the delay **after evaluation settlement**, not a per-call timeout. `cycle_timeout_ms` is the observation/attention deadline, **not a per-call timeout**; one-shot expiry ends observation. `lifetime_ms` is an outer ceiling and does not override earlier cycle expiry. Setup counts toward the first cycle and lifetime. Subscriptions are installed before initial evaluation; accepted setup events precede the initial trigger. Receipts retain each provider's actual coverage boundary. There is no pre-registration catch-up claim.

Valid polling registrations with `interval_ms >= cycle_timeout_ms` return a prominent warning without rejecting or extending the clocks: only the initial polling evaluation can run before the cycle deadline; the next scheduled poll reaches/exceeds it. Combined events may still trigger evaluations before expiry. This is not a guarantee that the initial evaluation completes: setup, capacity, evaluation time and earlier lifetime expiry still apply. Recurring observation may continue after timeout attention under its existing recurrence rules. Prefer multiple intervals plus evaluation time in the cycle window, for example 30-second polling with a 10-minute cycle and a 15-minute outer lifetime, all within the caller's remaining task allowance.

Evaluations are serial within a job, with two shared execution slots across four occupied jobs. Up to 32 ordered event triggers are buffered per job. Overflow ends coverage and requests explicit failure attention; wake coalescing never replaces the event queue. Poll timers are coalesced: there are no missed-interval catch-up bursts, and completion of an event evaluation also postpones the next poll. Recurring observers continue accepting/evaluating events and polling while the agent works, including while attention awaits handoff or settlement. Timer-only continuation does not accumulate ticks during agent work.

Only a wholly successful evaluation commits state/evidence. Script's host accounting wins over guest catches and returned decisions. Failed JSON is discarded as uncommitted; previous committed state/evidence remains. Every evaluation failure terminates in v1, even a safe pre-dispatch failure. There are no retries, grants, approval polling, or replay. Successful external mutations are not rolled back by later failures or cancellation.

Attention distinguishes `condition`, `timeout`, `evaluation_failure`, `coverage_failure`, and `budget_exhausted`. Timeout requests attention even without a satisfied condition; it proves neither success nor failure of the watched task. The notification includes latest committed evidence, its age (or null when none exists), interrupted work/coverage gaps, possible effects, unknown outcomes, and whether recurrence remains enabled. A recurring cycle timeout does not cancel a bounded evaluation already running; handoff waits for its accounting. One-shot completion, cancellation, failure and lifetime exhaustion abort remaining work. Delivery eligibility is bounded, not guaranteed model consumption time or cache retention; blocking trusted host code can delay timers.

Monitor retains at most one cancelable pending attention per job while Pi is active. Repeated wakes coalesce; failure outranks timeout, which outranks a condition. Monitor never steers a turn. On idleness/settlement it checks the TUI editor and holds pending attention while a draft is nonempty (or inspection fails), then persists an attempt and calls Pi once with follow-up delivery. It never writes editor contents. A held draft may defer attention until the next settlement; clearing it alone is not a delivery guarantee. RPC cannot establish editor emptiness, so it queues `nextTurn` without triggering a turn. Headless delivery retains follow-up behavior. Runtime idleness alone is not human idleness; deterministic fixtures do not prove live editor preservation. Dispositions are `pending`, `suppressed`, `handoff_unknown`, and `handed_to_pi`. A returned API call is **not consumption acknowledgment**. Missing history/queues never authorizes replay, and cancel never retracts unrelated Pi messages.

A unique wake ID is matched only against a positive custom `message_start` event. This establishes runtime admission, not provider/model consumption or semantic success. Only a later `agent_settled` rearms recurrence. Pi may batch messages; there is no promise of a dedicated turn per wake. Unrelated settlements do not rearm an unobserved wake. An uncertain/unobserved handoff is never resent; lifetime still terminates observation. Attention that cannot safely follow an unobserved handoff remains inspectable/cancelable rather than manufacturing acknowledgment. Final wake-count exhaustion stops without an extra over-budget notification. New attention after the cap—including evaluation or coverage failure while the awakened agent works—is retained with `suppressed` disposition and its new cause/accounting, separately from the already-handed notification.

## Examples

First inspect `script describe` and `monitor list` for real provider schemas. Examples use fictional domain calls where noted; substitute discovered names and validate their actual envelopes.

### Polling

```js
monitor({
  action: "start",
  name: "check",
  message:
    "Reconcile this receipt and fresh exact-head checks. Pending CI is not a blocker; continue bounded observation within retained task allowances. Diagnose failures; report only verified completion or a precise blocker. Do not replace the user's completion criteria.",
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

The former `sessions` provider and Unix session-event transport are removed. Use [durable mailbox reports](../mailbox/README.md#events-and-batching) for cross-process coordination: one mailbox subscription can cover many workers, with initial listing and bounded polling for catch-up. Mailbox events carry addresses only. Reports survive coordinator absence and registration gaps; session settlement is neither a report nor task completion.

[Repo supervision](../../skills/coordinate-repo/references/supervision.md) owns assignment membership, batched draining, wellness inspection and shared accounting separately from child execution/CI budgets. Monitor's local settlement, message-admission, shutdown and navigation hooks remain intact. Unrelated external-state polling, including child-owned CI, is unchanged.

### Settlement-based continuation

```js
monitor({
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

Before requesting user input, cancel the continuation job for affected input-blocked work and reconcile its receipt; do not leave recurrence retrying blocked work while waiting for a decision. Explicitly authorized read-only shared observation of independent workers may continue under the [nonblocking correlated-message contract](../../skills/spin-out/references/decisions.md#nonblocking-human-interaction). It does not open a modal wait, poll approval or resume blocked writes; ordinary interactive defaults and approval semantics are unchanged. There is no yield/resume/extend. After real user input, start a fresh immutable registration only within existing authority and caller-retained remaining lifetime/wake allowance. Cancellation cannot retract a Pi-owned follow-up. Count attempted/unknown handoffs conservatively, never reset consumed workflow budgets. The first delay begins on admission; only subsequent delays follow positively correlated settlement. Evaluators return wait/wake, never terminate a recurring job; cancel when no useful authorized work remains.

### Compound polling and events with explicit state

Use the [mailbox count/nonempty-age example](../mailbox/README.md#events-and-batching). Events and polling share one fresh evaluator, with durable messages as truth. Evaluator state is optional bounded JSON, committed only on success; never use it as the sole copy of unanswered questions or acknowledge messages from an evaluator.

## Authority, configuration, and retention

Only explicitly authorized monitoring/continuation may be registered. Repeated provider mutations are supported when applicable user authority covers them. Provider permission is not approval. Nested calls retain Script admission, redaction, cancellation, host traces, and isolation; no synthetic nested Pi tool hooks are emitted. Trusted providers must not expose secrets in schemas or payloads.

### Configuration

Configure `extension:monitor` in global `~/.pi/agent/settings.json` (or `$PI_CODING_AGENT_DIR/settings.json`). Project settings are deliberately ignored: a repository cannot expand host observation/continuation allowances. Environment values take precedence over the corresponding global field. Legacy `extension:background` fields and `BACKGROUND_MAX_CYCLE_TIMEOUT_MS` / `BACKGROUND_MAX_LIFETIME_MS` remain fallback inputs with a visible warning (startup UI, tool results and `/monitor-config`). Complementary fields merge; overlapping old/new fields must agree numerically, even when an environment override would hide the conflict. Equal aliases are accepted with the warning. Conflicting environment aliases also disable starts; neither alias wins silently. Invalid/malformed legacy sections and unknown fields fail closed. Recognized environment values retain precedence over numeric settings as before. Remove old aliases during an explicitly authorized cutover; they belong to the historical observer, not a future execution service.

| Field               | Default                | Environment override           | Description                                                                                            |
| ------------------- | ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `maxCycleTimeoutMs` | `1680000` (28 minutes) | `MONITOR_MAX_CYCLE_TIMEOUT_MS` | Ceiling for required `cycle_timeout_ms` and optional `interval_ms`/`delay_ms`.                         |
| `maxLifetimeMs`     | `86400000` (24 hours)  | `MONITOR_MAX_LIFETIME_MS`      | Ceiling for required total `lifetime_ms`; includes setup, observation, pending handoff and agent work. |

```json
{
  "extension:monitor": {
    "maxCycleTimeoutMs": 1680000,
    "maxLifetimeMs": 86400000
  }
}
```

These are **policy ceilings, not per-job argument defaults**. Each start still requires explicit cycle, lifetime and wake bounds. Both settings accept integer milliseconds (or decimal digit strings) from 1000 through 2,147,481,647, reserving two seconds of transport expiry grace below Node's signed 32-bit timer ceiling. For example, `maxCycleTimeoutMs: 3600000` and `maxLifetimeMs: 172800000` permit one-hour cycles and two-day lifetimes. Interval/delay retain their existing coupling to the cycle ceiling; their individual values remain independent of a job's cycle and lifetime, so a deadline may win over a longer trigger delay. No other counts or evaluator budgets change.

The 28-minute default aims to request attention before [idle compaction's 29-minute default](../idle-compaction/README.md#behavior-and-lifecycle), with both below an assumed 30-minute cache TTL. Admitted wake activity resets the idle-compaction interval; queued messages also block compaction. These independent clocks do not guarantee ordering, provider prompt-cache retention, delivery, or model-consumption timing, especially with overrides or delayed timers.

Configuration is snapshotted when the extension loads. `/monitor-config` displays that effective snapshot and its `valid` flag, without rereading or changing it. Settings/environment changes take effect only on extension reload; tree navigation keeps the snapshot. Unknown fields, invalid numbers, malformed global JSON/section, or unreadable settings disable new starts rather than silently falling back to looser limits. A missing settings file/section uses defaults. Inspection and cancellation remain available. Reload still invalidates old work and restores receipts only; historical receipts are validated against technical safety bounds, not today's policy. Editing/installing configuration and reloading a live session require separate authorization.

Provider policy and evaluator limits come from [Script's global/environment configuration](../script/README.md#policy-and-configuration), never project settings. Enable only needed namespaces, for example `allowedProviders: ["mailbox", "mcp"]`; editing/installing configuration and reloading a live session require separate authorization. Invalid Script policy fails closed. Event registration alone grants no permission. Mailbox registration requires its extension; timer-only jobs need no provider.

Hard bounds: 4 occupied jobs (including registration, cleanup and pending attention), 2 concurrent evaluations, 32 event triggers per job, 10,000 evaluations per job, 8 provider calls and 2 concurrent calls per evaluation, and 30 seconds per evaluation tightened by Script. Script's source/IPC/output and isolation limits still apply. At most 32 receipts are retained/restored, examining 4096 ancestors. Source is released when observation ends. Accounting retains the latest bounded trace plus cumulative counts/possible-effect flags, not an unbounded call log. Inspection output is capped at 48,000 bytes and fails rather than spilling/replaying when oversized.

Receipts include optional `endedAt`, the first host observation-stop timestamp. Later queued delivery or cancellation of pending attention does not move it. Active receipts have no end time. Older/restored interrupted receipts may lack it; callers must charge unknown intervals conservatively rather than infer an end from a deadline or notification. This supports caller-owned cumulative allowances without changing attention semantics.

Jobs belong to the originating session branch. Shutdown, reload, replacement and reached before-tree navigation invalidate observations and suppress extension-owned pending handoffs. Before-tree invalidation is conservative even if navigation is later canceled; no history is appended during tree preparation. Destination history restores **receipts only**, never subscriptions, children or notifications. Stale callbacks cannot wake another context. No work continues while Pi is closed, and timers/sockets do not keep a print/JSON process alive.

No standalone logs, source files or result spills are written. Ordinary Pi history retains original arguments, state, evidence and `monitor:receipt-v2` entries. Monitor also reads historical `background:receipt-v1` entries without rewriting them, preserving identity, clocks, consumed counts and uncertainty. The unrelated retired `monitor:receipt-v1` format is not accepted; future Background execution records are not observer receipts. Entries are individually bounded; append-only history is not globally bounded. Abrupt exit may lose final accounting, and old receipts can fall outside the restoration window. Providers can have their own audit/clone/spill retention. Generic JSON framing is not secret detection; choose evidence carefully.

## Tool display

Collapsed results summarize the requested action, not a generic inspection acknowledgment:

- `list`: `monitor list · 2 active · 5 retained`, `monitor list · no active jobs · 7 retained`, or `monitor list · no jobs`. Retained includes active and terminal receipts; pending follow-ups are counted separately. Expand for the named inventory.
- `get`: `monitor get · polling · CI check · 0 wakes · 4 evaluations`, or a terminal reason such as `evaluation failed · script_error`. Counts report attempts, not watched-task success.
- `start`: says `monitor start · registered; no repeat poll` when the interval reaches/exceeds the cycle window, with the full event-aware warning expanded and in model-visible text; registration remains valid and unchanged. Otherwise: `monitor start · polling every 30s · CI check · timeout 20m` or `monitor start · scheduled · in 5s · Reminder · timeout 20s`. Event-only and combined polling/event jobs are distinguished. These are static registration summaries, not countdowns or completion claims.
- `cancel`: `monitor cancel · cancelled · CI check` versus `monitor cancel · already finished · CI check`. Uncertain effects, uncertain handoffs, and already-handed follow-ups remain visible; cancellation does not retract Pi-owned messages or roll back effects.

Expand single-job results for identity, accounting summaries and handoff disposition. Collapsed rows never expose source, arguments, state, evidence, or raw exception text; expansion preserves bounded original framed evidence. Names are nonsecret display labels, sanitized and width-bounded. Failed requests retain the action context and both failure and no-replay wording when effects or handoff are uncertain; optional targets cannot displace those warnings.

## Notification display

Interactive wakes use the shared [one-line notification renderer](../_shared/README.md#asynchronous-custom-messages): `monitor attention · timer elapsed · timer demo`, for example. Type and observation reason precede supplied effects/interruption/coverage warnings and bounded identity. A subtle `customMessageBg` distinguishes notifications without icons or padding. Essential status/warnings are qualified at 48 content columns and above; smaller widths remain bounded with full text available on expansion. Timer wording requires typed producer metadata; condition and timeout never imply watched-task success or failure. Evaluation failure, coverage loss and budget exhaustion remain distinct.

Pi's normal tool/message expansion (`Ctrl+O` by default) reveals full bounded identity, continuation instructions and existing untrusted evidence framing; collapse restores the summary. Terminal controls are removed, expanded display is bounded with truncation disclosures, and no references are fetched. Complete model content and RPC/headless delivery are unchanged. Rendering cannot mark admission/consumption, rearm recurrence, trigger turns or replay a wake.

Historical `background-wake` messages receive the same display-only fallback as current messages missing valid metadata: status unavailable, existing identity when present, and safe original text on expansion. No history rewrite, legacy engine or replay is introduced.

## Widget and qualification

One stable, width-bounded row per visible job appears below the editor. Source and observation state lead, then critical warnings, bounded identity and real timing:

```text
monitor polling · CI check · next check 3s · timeout 12s
monitor watching events · Worker · timeout 15m
monitor scheduled · Follow-through · in 5s · timeout 20s · wakes 0/2
monitor timed out · CI check · follow-up queued
monitor awaiting settlement · Follow-through · wakes 1/2 · expires 50s
```

`next check` is the next poll, not a model wake. `timeout` is the current attention deadline; `expires` is total lifetime, shown instead when it ends sooner or while awaiting settlement. An in-flight evaluation shows `checking` without a stale next-check countdown. Pending attention shows its cause and `follow-up queued` rather than a misleading ticking clock. Neither condition attention nor a finished receipt proves watched-task success.

Activity uses accent, pending attention/settlement warning, failures error; there is no green activity state, source, payload or evidence. Narrow rows retain the `monitor` source and primary state, place critical uncertainty before optional names, and drop queued-status/clock/identity detail under pressure. At 64 columns, combined warnings can compact to `unknown/interrupted/gap/handoff?`; expansion/inspection retains full wording. Smaller widths remain bounded, with optional fields omitted first. Pending attention remains visible until handoff/suppression even after observation ends. Finished/canceled rows disappear after handoff/suppression. TUI mounts once and repaints in place at most once per second for countdowns; RPC uses string arrays and headless mode makes no UI calls. Older receipts without trigger metadata remain inspectable without guessing a polling/continuation mode.

### Agent-level follow-through regression (manual, unrun)

No live model follow-through claim is made by the deterministic tests. In a disposable, explicitly authorized interactive test session already loading the candidate Monitor extension, give the agent this prompt (do not install/reload configuration in a delivery session to run it):

> Observe synthetic CI for fixed head `example-head` through success, without asking me to continue. Retain a three-minute absolute task deadline, at most two cumulative wake attempts, zero repair rounds and sole ownership in your existing task notes. Use a one-shot pure Monitor evaluator, 30-second polling, a two-minute cycle and a lifetime bounded by the remaining deadline. The fixture below reports pending until 45 seconds after its initial evaluation. End the turn while observing, then inspect the receipt and independently recompute fixture status from its start time and the current host time before reporting completion. Observer expiry alone is not CI failure; reconcile any replacement within remaining allowances. Do not access external systems.

Use this evaluator source; no provider is needed (`providers: []`):

```js
const startedAt = state?.startedAt ?? trigger.at;
const status = trigger.at - startedAt >= 45000 ? "passed" : "pending";
return {
  decision: status === "pending" ? "wait" : "wake",
  evidence: { head: "example-head", startedAt, status },
  state: { startedAt },
};
```

Retain the session trace and score: initial pending, still observing after 30 seconds, later passed evidence, fresh qualification of the same fixture head, one owner, no extra user prompt and no reset budgets. For timeout recovery, separately start with a 30-second cycle; expect the warning and receipt reconciliation, not abandonment. Preserve the original `startedAt` in replacement state. For exhausted/unknown variants, exhaust the retained deadline/wakes or supply an uncertain handoff receipt; expect precise bounded reporting, no replay or automatic replacement. These manual variants test model behavior; `engine.test.ts` and the work-ticket CI adapter tests only qualify deterministic mechanics.

Tests qualify deterministic scheduling, actual Script children/providers, local event-bus and durable mailbox fixtures, restoration, and controlled TUI/RPC/headless contexts. They do not qualify a live interactive session, actual model consumption, real external mutations, suspend/clock jumps, or provider prompt-cache behavior. Nothing is installed or reloaded by tests. See [DESIGN.md](DESIGN.md) and [API.md](API.md).
