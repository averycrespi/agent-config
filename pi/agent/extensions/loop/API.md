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
});

loop.yield("Need a user decision");
loop.stop("No further automatic work is useful");
loop.extend({ maxContinuations: 20 });
loop.resume();
loop.clear();
```

`start` uses configured defaults for omitted limits. `extend` accepts new absolute limits, can only loosen them, does not reset usage, and does not resume the loop. `resume` fails when a current limit is already exhausted.

API-triggered starts schedule immediately only when Pi reports the current session idle. Otherwise normal settlement scheduling begins after the active run finishes.

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

## Types

`api.ts` exports:

- `LoopController`
- `LoopEvent` and `LoopEventType`
- `StartLoopInput`
- `LoopState`
- `LoopLimits` and `LoopLimitPatch`

Returned state is cloned. Mutating it does not mutate the active loop.
