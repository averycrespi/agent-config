# Loop Extension API

Import the stable API from `api.ts` rather than internal modules:

```ts
import { loop } from "../loop/api.ts";
```

The API operates on the one shared loop for the active Pi session branch. Calls throw when no loop runtime is active, an operation is invalid for the current state, input is invalid, or a configured hard ceiling would be exceeded.

## Operations

```ts
loop.get();

loop.start({
  message: "Run the next bounded workflow step.",
  maxContinuations: 10,
  maxActiveMinutes: 60,
  delaySeconds: 15,
});

loop.yield("Need a user decision");
loop.stop("No further automatic work is useful");
loop.extend({ maxContinuations: 20 });
loop.resume();
loop.clear();
```

`start` uses configured defaults for omitted limits and delay. A nonzero delay waits before every automatic continuation, including the first continuation from an idle API start. The wait counts toward active running time. `extend` accepts new absolute limits, can only loosen them, does not reset usage, and does not resume the loop. `resume` fails when a current limit is already exhausted.

API-triggered starts begin scheduling only when Pi reports the current session idle. Otherwise normal settlement scheduling begins after the active run finishes.

## Events

Subscribe through the typed API:

```ts
const unsubscribe = loop.subscribe((event) => {
  if (event.type === "exhausted") {
    // event.loop is the stopped snapshot
  }
});
```

Event types are `started`, `continued`, `yielded`, `stopped`, `resumed`, `extended`, `cleared`, and `exhausted`. `event.loop` is absent after clearing.

The extension emits the same payload on Pi's shared event bus under `loop:<type>`, for example `loop:yielded`. Use the imported API for typed direct coordination and `pi.events` for loose coupling.

### Coverage and privacy

The existing inventory covers creation (`started`), continuation accounting (`continued`), yielding (`yielded`), ordinary stops (`stopped`), explicit or user-input wake (`resumed`), limit increases (`extended`), clearing (`cleared`), and exhausted limits (`exhausted`). No duplicate publisher or additional Loop event is needed for these transitions. Names, payloads, and typed subscriptions remain unchanged. Restoration normalizes persisted running state to stopped without replaying mutation events.

Payloads include the Loop snapshot, which can contain caller instructions and reasons. **Do not forward whole Loop events across a process or trust boundary.** Select only the safe fields needed by the consumer. Event publication is not task-completion evidence; `agent_start`, `agent_settled`, and `session_shutdown` remain built-in Pi hooks, not renamed extension events.

## Types

`api.ts` exports:

- `LoopController`
- `LoopEvent` and `LoopEventType`
- `StartLoopInput`, including optional `delaySeconds`
- `LoopState`, including effective `delaySeconds`
- `LoopLimits` and `LoopLimitPatch`

Returned state is cloned. Mutating it does not mutate the active loop.
