# Monitor

`monitor` observes gateway conditions in fresh [code-mode](../code-mode/README.md) children without spending model turns while pending. The host schedules polls; only terminal attention produces a custom follow-up. [Loop](../loop/README.md) remains message-based model continuation. Neither primitive is a detached service or a completion judge.

## Tool and commands

One `monitor` tool supports:

- `start`: required `name` (1–80 characters), `description` (1–200), `source` (nonblank async JavaScript body, at most 256 KiB UTF-8), and `message` (1–2000). Labels/instruction must contain visible nonblank text. Optional `interval_ms`, `timeout_ms`, `poll_timeout_ms`, and `failure_limit` use the finite defaults below. Returns a stable UUID and effective limits. Duplicate active names are rejected after display normalization; control existing monitors by ID.
- `list`: compact summaries of active and recent terminal monitors.
- `get`, with `id`: bounded receipt with configuration, deadline, accounting, last validated evidence and its observation number, safe failure metadata, and notification state. Source is never echoed.
- `cancel`, with `id` or `id: "all"`: abort observation and suppress extension-owned pending notifications. Already handed/queued messages cannot be selectively retracted. Does not clear any Pi messages.

Unexpected/action-inapplicable fields, unknown IDs and invalid limits are errors without partial state changes. Concurrent registrations are admitted atomically. Cancellation does not roll back gateway effects. Canceling a registration tool before admission prevents registration; after registration, use `cancel` rather than expecting the tool-call signal to own the monitor lifetime.

Direct commands make no model calls:

- `/monitor` lists receipts; `/monitor <id>` inspects one.
- `/monitor-cancel <id|all>` cancels observations/pending notifications.
- `/monitor-config` inspects global/environment settings.

Control works without a TUI. RPC uses supported UI notifications and string-array widgets; headless command results go to stderr, while tool results remain normal structured results. Print/JSON modes still exit according to Pi's ordinary lifecycle; Monitor does not keep an unattended service alive.

## Observation protocol

Discover exact tools and schemas with `mcp_search` and `mcp_describe` first. The observer body has the same `mcp.call(name, args)` and `parallel(thunks)` as code mode. Each invocation receives a fresh interpreter, empty environment and no persistent state. Return **exactly** this JSON shape:

```js
return { decision: "wait", evidence: { state: "pending" } };
// Or: return { decision: "notify", evidence: { state: "failed" } };
```

`evidence` is any code-mode-valid JSON value, including `null`, serialized to at most 4096 characters. The complete serialized observation must fit 4196 characters. Oversized/malformed returns terminate instead of silently accepting a truncated decision. Valid evidence accompanying a caught host failure may be retained, but cannot change the host failure disposition. A receipt identifies which observation produced its latest valid evidence, which may precede the terminal failure.

Illustrative registration (replace fictional tools with discovered schemas):

```js
monitor({
  action: "start",
  name: "Example checks",
  description: "Watch an explicitly selected check",
  message: "Inspect the terminal check result and report the next action.",
  interval_ms: 30000,
  timeout_ms: 1800000,
  source: `
const result = await mcp.call("example.check", { id: "example" });
const state = result.structuredContent.state;
return { decision: state === "pending" ? "wait" : "notify", evidence: { state } };
`,
});
```

The first poll is scheduled promptly after registration. Subsequent polls start no earlier than one interval after the previous poll settles; there are no catch-up bursts and no overlapping polls for one monitor. Queue and execution time consume the immutable wall-clock lifetime. Per-poll limits are also bounded by current code-mode settings and the registration-time effective ceilings; tightening code-mode settings takes effect at the next poll, loosening never increases a registered monitor's ceilings.

## Authorization and failure safety

Any gateway tool available to ordinary code mode is available here, including **explicitly authorized repeated mutations**. Monitor adds no read-only filter or pinned allowlist. Gateway grants, fresh schema admission, active configuration, credential rotation, cancellation and per-call deadlines remain authoritative. Gateway permission is **not user approval**. Register only when the user requested monitoring, and obtain authority covering intended repeated mutations. The outer `monitor` tool is the Pi approval-hook boundary; there are no synthetic nested Pi hooks, automatic grants, approval polling, invocation retries or replay of uncertain observations.

Host traces survive guest catches and `wait`/`notify` returns. Only branded transient gateway discovery `transport_error`/`http_error` failures with every trace failed before dispatch, no partial execution and no unknown effects qualify for repetition. These consume a cumulative failure budget, never reset by successful waits. The guest must catch the transient error and return a valid observation; generic `script_error` always stops because its cause cannot be proven nondeterministic. Deterministic invalid source/config/schema/protocol, missing dependencies, unexpected errors, timeouts, any potentially dispatched failure, or inability to prove repeat safety terminate immediately. A terminal reason of `unsafe_failure` means agent attention is required, not that an upstream mutation definitely occurred. Safe codes and partial/unknown-effect flags are retained; `failure.code` preserves the host result code, `failure.codes` holds nested trace codes, and optional `failure.protocolCode` records a malformed observation without overwriting a host failure. Raw exception messages, arguments and responses are not.

A successful `wait` sends **zero conversation messages and zero model turns**. Custom receipt entries are state, not conversation messages. Terminal reasons are `condition`, `deadline`, `failure_limit`, and `unsafe_failure`. Notify/condition means **attention**, not success.

## Notification boundary

Terminal completions are serialized through a bounded extension-owned pending queue. Active capacity remains occupied through child cleanup and pending notification, preventing completion churn from exceeding the active ceiling. Deadline aborts active work and retains its final host failure metadata before handoff.

Each terminal monitor attempts at most one `pi.sendMessage` with `deliverAs: "followUp"` and `triggerTurn: true`: idle Pi wakes immediately; active Pi queues follow-up rather than steering. Pi controls batching and consumption, so this is not a promise of one model turn per terminal monitor. Evidence is explicitly untrusted; instructions, source, credentials and response payloads are not placed in widget/tool rows.

Notification receipts distinguish:

- `none`: still observing.
- `pending`: extension owns the notification and cancellation can suppress it.
- `handed_to_pi`: the synchronous public API returned; delivery/consumption is **not acknowledged**. This remains inspectable in receipts, not in the active-only widget.
- `handoff_unknown`: the attempt was recorded before calling Pi; the call threw or the process stopped before recording its return. No automatic retry.
- `suppressed`: canceled or invalidated before handoff.

Once handed to Pi, its queue cannot selectively retract a monitor message. Cancel reports this limitation without changing unrelated queues. An asynchronous Pi delivery failure can surface through Pi's extension-error reporting without a per-monitor acknowledgment. Neither absent history nor `hasPendingMessages()` proves delivery failure or permits replay.

## Configuration

Global `settings.json` under `extension:monitor` only; project settings are ignored. Environment overrides win. Settings are sampled when the session/branch initializes, not hot-updated for running monitors. Restart/reload is a user decision and invalidates existing monitors. Invalid JSON, non-object settings/extension sections, unreadable settings (except an absent file), null or invalid finite values disable registration. Settings inspection remains available.

| Field                | Default   | Environment override           | Description                                                                     |
| -------------------- | --------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `maxActive`          | `4`       | `MONITOR_MAX_ACTIVE`           | 1–16 occupied monitors, including cleanup/pending notification.                 |
| `maxConcurrentPolls` | `2`       | `MONITOR_MAX_CONCURRENT_POLLS` | 1–4 shared simultaneous observations.                                           |
| `intervalMs`         | `30000`   | `MONITOR_INTERVAL_MS`          | Default polling interval, 1000–3600000 ms.                                      |
| `timeoutMs`          | `1800000` | `MONITOR_TIMEOUT_MS`           | Default wall-clock lifetime, 1000–86400000 ms.                                  |
| `pollTimeoutMs`      | `30000`   | `MONITOR_POLL_TIMEOUT_MS`      | Default per-poll timeout, 1–300000 ms, tightened by code mode.                  |
| `failureLimit`       | `3`       | `MONITOR_FAILURE_LIMIT`        | 1–20 cumulative repeat-safe failures; reaching the limit terminates.            |
| `maxCalls`           | `8`       | `MONITOR_MAX_CALLS`            | 1–128 nested attempts per poll, tightened by code mode.                         |
| `maxCallConcurrency` | `2`       | `MONITOR_MAX_CALL_CONCURRENCY` | 1–16 nested simultaneous calls per poll, tightened by code mode.                |
| `receiptLimit`       | `32`      | `MONITOR_RECEIPT_LIMIT`        | 16–128 in-memory/restored receipts; evict oldest unoccupied registration first. |

```json
{
  "extension:monitor": {
    "maxActive": 4,
    "maxConcurrentPolls": 2,
    "intervalMs": 30000,
    "timeoutMs": 1800000
  }
}
```

The former `terminalRows` setting and `MONITOR_TERMINAL_ROWS` environment override are ignored; terminal monitors are never displayed in the widget.

Default aggregate nested concurrency is at most 4 (2 polls × 2 calls); configured hard maximum is 64 (4 × 16), excluding ordinary code/direct MCP activity. Calls per observation are bounded; total calls also have a finite bound from minimum interval and maximum lifetime. There is no new gateway-global quota across unrelated tools.

## Visibility, lifecycle and retention

The shared widget is **below the editor**, with exactly one width-bounded line for **every active monitor** (`waiting` or `observing`), without headers, overflow rows, horizontal rules, icons, bold text, or animation. It follows the [below-editor status convention](../../../../.pi/skills/create-extension/SKILL.md#below-editor-status-widgets): muted lowercase `monitor`, accent-colored state, normal name/values, muted timing labels, and dim `·` separators. Nonzero failure-budget usage is warning-colored and precedes timing.

```text
monitor active · Build checks · next 12s · 18m left
monitor observing · Deployment · 7m 42s left
monitor active · Service health · failures 1/3 · next 8s · 12m left
```

Rows use a stable `active` label; only polls observed running for at least two seconds show `observing`. Waiting rows show the next-poll countdown, and active rows show remaining lifetime when space permits. Countdown refreshes run once per second; positive fractions round up, expired values clamp to zero, and durations use `12s`, `1m`, or `1m 12s`. Long names shorten before timing is sacrificed; narrower rows drop remaining lifetime before next-poll timing, preserving failure indicators ahead of both. Receipt states remain precise and unchanged.

All terminal states disappear immediately, including monitors still cleaning up or awaiting notification handoff; their receipts remain available through `/monitor` and tool list/get. While visible in the TUI, the widget is mounted once and repainted in place, so countdowns and poll transitions do not change its order relative to Loop or other widgets. When no monitors are active, the widget and its refresh timer are removed. Control sequences and gateway credential shapes are removed before styling. Names/descriptions are not general secret-safe containers: never put secrets in labels or instructions.

Monitors belong to the originating active session branch. Shutdown, reload, replacement and tree navigation abort observations, clear timers and invalidate pending extension-owned notifications. The before-tree hook stops conservatively when reached, even if a later handler cancels navigation; it never blocks navigation or appends history while Pi's tree preparation is in progress. Successful tree navigation rebuilds inspectable receipts for the destination branch only. No stale callback hands off in the new context.

Bounded `monitor:receipt-v1` custom entries preserve effective limits, consumed poll/call/failure accounting and latest evidence at registration, poll admission/settlement and terminal transitions. Each entry is bounded; Pi's append-only history is **not globally size-bounded** and grows with observations. Recovery walks at most the newest **4096 branch entries**, without materializing the entire branch, and restores at most the configured number of unique receipts from that window (ordered by their latest entry). Older receipts remain in Pi history but are omitted from restored list/get; an ID outside the recovery window may therefore be unknown after navigation/reload. Restoration never restarts observation or notification. `inFlight: true` on a recovery receipt means an observation began but its final accounting may be incomplete; it does not mean a worker is still running. Graceful shutdown can preserve this conservative interrupted marker. Abrupt termination may lose the most recent entry; neither recovery state nor cancellation proves rollback.

No separate logs, spills or source copies are written by Monitor. Source exists in memory only while active, but Pi retains original tool arguments (including source/instruction) in ordinary session history. Explicit evidence and receipts are also retained there until that history is deleted. Gateway credential redaction is not a general secret filter; observers must select appropriate evidence. Gateway/server audit retention is separate. History deletion is never automatic.

There is no worker after Pi exits, restart/resume/extend control, detached service, CI adapter or work-ticket adoption. The [supported executor API](../code-mode/API.md) preserves code mode's Node permission boundary and cleanup; it does **not** promise CPU/memory quotas, memory-exhaustion protection or hostile multi-tenant isolation.
