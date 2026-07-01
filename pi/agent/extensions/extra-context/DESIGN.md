# extra-context Design

`extra-context` injects additional user-configured context files into Pi's system prompt without requiring those files to live in the public agent config repo or a project checkout.

## Architecture

- `index.ts` owns configuration parsing, file loading, prompt formatting, command registration, and event handlers.
- The extension uses `_shared/config.ts` for settings merge behavior and `/extra-context-config`.
- `session_start` loads and caches configured file contents for the current session.
- `before_agent_start` appends the cached context block to the chained system prompt.

The extension is intentionally single-file because its state and behavior are small. If path handling or file loading grows, split those concerns before adding unrelated behavior.

## Configuration model

Configuration is read from `extension:extra-context` in global and project Pi settings, then overridden by environment variables. Paths are resolved at the extension boundary:

- absolute paths are normalized;
- `~` and `~/...` expand to the user's home directory;
- relative paths resolve against the session cwd.

The default `files: []` keeps the public repo free of private-path assumptions. Users should configure private paths locally or through environment variables.

## State and lifecycle

Runtime state is session-scoped:

- `files` contains loaded `{ path, content }` entries;
- `diagnostics` contains warnings/errors from the last load.

The extension does not persist state into the Pi session. A reload or new session rereads the configured files.

## Prompt contract

Injected context is wrapped as:

```xml
<extra_context>
Additional user-configured context files:

<extra_context_file path="...">
...
</extra_context_file>
</extra_context>
```

Only path attributes are XML-escaped. File contents are inserted verbatim so Markdown instructions remain readable to the model. Treat configured files as trusted user-controlled input; do not point this extension at untrusted generated files.

## Commands

- `/extra-context-config` reports effective parsed config via the shared config helper.
- `/extra-context-status` reports loaded paths, character counts, and diagnostics without file contents.

Do not add commands that print the loaded contents; that increases the chance of leaking private context into visible UI logs or copied output.

## Security and boundaries

This extension improves file placement safety, not secrecy. Loaded content is prompt context and is sent to the model provider. It may also be present in provider logs, session exports, or downstream tooling that captures prompts.

The extension does not write retained logs or temp files. Diagnostics should include paths and error messages only, never file contents.

## Non-goals

- Secret management or credential injection.
- Per-project policy enforcement.
- Dynamic file watching.
- Prompt redaction after provider submission.
- Automatic inheritance by subagents that did not explicitly load the extension.

## Change guidance

Keep the extension conservative and predictable. If adding new config fields, document them in the README table with environment overrides and update tests for parsing and prompt injection. If changing prompt formatting, update tests that assert the wrapper shape because subagents and users may rely on the visible boundaries.
