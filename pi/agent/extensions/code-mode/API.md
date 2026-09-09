# Code-mode host executor API

Trusted sibling extensions import `./api.ts`, not tool execute functions or internal runtime modules. No event bus, credentials or host objects enter guest JavaScript. Using this library requires an active MCP Gateway provider, not registration of the ordinary `code` tool.

## Exports

- `CodeLimits`: `{maxCalls, maxConcurrency, timeoutMs}`. Positive safe integers with hard maxima 128, 16 and 300000 respectively.
- `MAX_LIMITS`: those hard maxima.
- `getCodeLimits(pi, cwd, signal?)`: asynchronously validate current global/environment code-mode configuration and resolve exactly one active gateway. Returns limits without launching a child. Missing/invalid/conflicting dependencies reject. `cwd` does not authorize project settings.
- `executeCode(pi, cwd, source, limits, signal, deadlineMs)`: execute one fresh code-mode child. Requires cancellation and an absolute finite safe-integer wall-clock deadline. Caller limits are ceilings: effective limits are the minimum of these and current code-mode configuration. Per-execution time starts before configuration loading, and also respects the absolute deadline. The caller owns scheduling, lifetime and cleanup signal; no replay or model turn is synthesized.
- `RunResult`, `Trace`: bounded host execution receipts described below.
- `isRepeatSafeFailure(result)`: conservative whole-observation classification for host-produced results. Never call it on guest JSON. It grants neither permission nor user authority to repeat an operation.

```ts
import { executeCode, getCodeLimits } from "../code-mode/api.ts";

const limits = await getCodeLimits(pi, ctx.cwd);
const result = await executeCode(
  pi,
  ctx.cwd,
  'return { decision: "wait", evidence: null };',
  { ...limits, timeoutMs: Math.min(limits.timeoutMs, 30000) },
  controller.signal,
  Date.now() + 30000,
);
```

`executeCode` refreshes configuration and gateway access on every call. It returns a failed result (`invalid_config` or `executor_unavailable`) for invalid ceilings/configuration or missing dependencies, never silently relaxing isolation. The API does not install its own session lifecycle handlers: sibling owners must abort their signal on shutdown/navigation and ignore stale asynchronous results. A terminal runtime result waits for child process close; gateway operations that ignore abort are not awaited indefinitely and their effects may remain unknown.

## Result and failure contract

`RunResult` contains `status` (`success`, `failed`, `cancelled`, `timeout`), optional safe `code` and serialized explicit JSON `json`, `traces`, `partialExecution`, `effectsMayPersist`, and `outcomeUnknown`. There is no implicit presentation/spill: callers must bound/frame returned JSON before putting it in context/history. The existing 16 MiB IPC bound and 256 KiB source limit remain in force. Never expose raw guest/transport exceptions.

Each trace contains `id`, admitted `tool` (otherwise `(not dispatched)`), `state`, `dispatched`, queue-inclusive `startedMs`/`durationMs`, optional safe `code`, validated `reason`/`invocationId`, `outcomeUnknown`, and `repeatSafe`. `repeatSafe: true` is host-only evidence of a branded transient discovery HTTP/transport failure before dispatch without unknown effects. Other failures default to not repeat-safe. Even if one trace is repeat-safe, earlier successful/dispatched calls make the **whole observation unsafe to replay**.

`isRepeatSafeFailure` requires `nested_call_failed` execution with a guest return, at least one failed trace, every trace repeat-safe and undispatched, and no persisted/partial/unknown effects. Generic `script_error` never qualifies: the host cannot distinguish an unhandled gateway rejection from a deterministic throw after a caught gateway error. Catch a transient failure and return a protocol-valid value if the caller's bounded repetition policy should consider retrying. Deterministic source/config/schema/protocol errors, interrupted/unsettled calls, successful calls before a failure, and unbranded exceptions do not qualify. A guest catch or returned `wait`/`notify` cannot erase a host failure. Repetition policy and finite cumulative failure budget belong to the caller, not this API.

Gateway parity, grants, fresh schema admission, credential lifecycle and approval boundaries are unchanged. Any permitted tool may run, including explicitly authorized mutations. Gateway permission is not user approval; repeated mutation requires applicable user authority. The API provides no grants, approval polling, nested Pi approval hooks, retries or rollback. See [README](README.md) and [gateway API](../mcp-gateway/API.md) for the capability boundary and limitations.
