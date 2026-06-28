# structured-output

Generic Pi extension that registers a schema-backed final structured output tool when configured. It is safe to enable globally because it is a no-op unless a schema file is provided.

## Tool

### `structured_output`

Registered only when `schemaFile` resolves to a JSON object. The JSON object is used as the tool parameter schema.

The tool returns:

- `content`: `Structured output captured`
- `details.value`: the schema-validated tool parameters
- `terminate`: the configured `terminate` value

The tool name, label, description, and result details shape are fixed so other extensions can rely on a stable contract. Use the task prompt or schema property descriptions for task-specific instructions.

## Configuration

Settings are read from `extension:structured-output` in global and project Pi settings, then environment overrides are applied. Registering no `schemaFile` leaves the extension inactive and registers no agent tool.

| Field        | Default | Environment override               | Description                                                    |
| ------------ | ------- | ---------------------------------- | -------------------------------------------------------------- |
| `schemaFile` | unset   | `PI_STRUCTURED_OUTPUT_SCHEMA_FILE` | Path to a JSON schema file. Empty or unset means no-op.        |
| `terminate`  | `true`  | `PI_STRUCTURED_OUTPUT_TERMINATE`   | Whether `structured_output` returns a terminating tool result. |

Boolean environment overrides accept `1`/`true`/`yes` and `0`/`false`/`no`.

Example settings:

```json
{
  "extension:structured-output": {
    "schemaFile": "/tmp/final-answer.schema.json",
    "terminate": true
  }
}
```

Use `/structured-output-config` to inspect the effective parsed config.

## Usage

Enable the extension globally with no schema to keep it inert:

```json
{
  "extensions": ["structured-output"]
}
```

Run a one-off structured session by providing a schema file:

```sh
PI_STRUCTURED_OUTPUT_SCHEMA_FILE=/tmp/schema.json pi -e structured-output -p "Return the answer using structured_output."
```

Other extensions, such as `subagents` and `workflows`, can load this extension in child Pi processes and pass `PI_STRUCTURED_OUTPUT_SCHEMA_FILE` to capture machine-readable phase outputs.

## Logging

This extension does not retain logs or write temp output. When used by another extension, that caller owns any schema-file lifecycle, process logs, or retained output. Tool results may include raw structured values in `details.value`.

## Limitations

- No schema file means no tool is registered.
- The extension does not inject task-specific prompt guidance; callers should instruct the agent when and why to call `structured_output`.
- The schema file must contain a JSON object.
