# structured-output API

Programmatic integration surface for the `structured-output` extension.

Import from `api.ts`:

```ts
import {
  STRUCTURED_OUTPUT_EXTENSION_NAME,
  STRUCTURED_OUTPUT_TOOL_NAME,
} from "../structured-output/api.ts";
import type { StructuredOutputConfig } from "../structured-output/api.ts";
```

Anything not exported from `api.ts` should be treated as internal.

## Constants

### `STRUCTURED_OUTPUT_EXTENSION_NAME`

Stable extension short name: `structured-output`.

Use this when referring to the extension by name in docs, configuration, or extension resolution code.

### `STRUCTURED_OUTPUT_TOOL_NAME`

Stable tool name: `structured_output`.

Use this when consuming Pi JSON-mode `tool_execution_end` events from a child process. Structured values are returned in `event.result.details.value`.

## Types

### `StructuredOutputConfig`

Effective parsed config shape:

```ts
interface StructuredOutputConfig {
  schemaFile?: string;
  terminate: boolean;
}
```
