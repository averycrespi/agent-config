# Builtins

Preserve compact builtin tool rendering and compose active stock Pi tools through Script. Direct tool schemas and execution are unchanged; full direct output still reaches the agent. The adapter invokes stock Pi implementations, not arbitrary extension overrides.

## Compacted tools

All five tools use one contextual, unwrapped result line with a bold tool name, explicit outcome/count, muted metadata and optional plain-text target. Targets drop before status at narrow widths. Shell calls show `shell`, never the command body; file calls show cwd-relative paths and searches show bounded pattern/path labels.

| Tool   | Example settled result                                |
| ------ | ----------------------------------------------------- |
| `read` | `read · read · 24 output lines · file.ts`             |
| `bash` | `bash · exited successfully · 3 output lines · shell` |
| `ls`   | `ls · listed · 8 output lines · src`                  |
| `find` | `find · listed · 4 output lines · *.ts in src`        |
| `grep` | `grep · listed · 8 output lines · pattern in src`     |

Counts describe nonempty output lines, not a guessed match/file count when stock output contains context or diagnostics. Partial results retain explicit running state and existing elapsed timers. Errors retain closed stock classifications such as `failed · exit 7`, `failed · timed out`, `failed · aborted`, `not found` or `permission denied`, without previewing arbitrary output. Unrecognized diagnostics remain a generic failure with full details expanded. Stock truncation/limit indicators remain visible. Expand for bounded sanitized original text and diagnostics; full model-facing content and stock spill paths are unchanged. A display bound is disclosed rather than silently pretending to show the complete result.

## Configuration

No extension-specific settings, environment overrides, or slash commands. Script access requires its separate global provider allowlist; loading this extension neither grants permission nor activates tools.

## Logging

This extension writes no separate diagnostic logs. Stock shell tools may retain full truncated output in Pi's temporary output files and return `details.fullOutputPath`; these can contain raw command output and follow Pi's retention behavior. Script itself does not spill results. Explicit output and tool arguments may be retained in session history.

## Non-goals

Intentionally out of scope — this is a minimal, hand-rolled subset tailored to this configuration:

- **No MCP tool rendering.** MCP tools vary too widely to compact generically.
- **No edit / write diff customization.** Pi's built-in diff renderer is already reasonable.

## Script provider

### Availability

Namespace: `builtins`. Install/load this extension and Script for the agent-facing tool (trusted host API callers need only the Script library). Registration starts on `session_start`. Explicitly authorize adding `builtins` to Script's global `extension:script.allowedProviders` or `SCRIPT_ALLOWED_PROVIDERS`, then select it for each execution. Registration, selection, permission, and user approval are separate.

Discovery includes supported stock methods with a live `available` boolean. A method is callable only while its direct tool is active and present in Pi's tool inventory. Each dispatch rechecks availability, including queued work. Enabling/disabling direct tools takes effect without restarting. Unsupported PowerShell is omitted outside Windows. Missing shell/search executables still fail through Pi; discovery is not an executable-health probe.

### Methods

Each method accepts **one builtin argument object**, validated against the stock schema shown by Script discovery.

| Method                                     | Purpose                              | Guest result                                          |
| ------------------------------------------ | ------------------------------------ | ----------------------------------------------------- |
| `builtins.read({path, offset?, limit?})`   | Read text with Pi truncation         | Structured result; image content rejects              |
| `builtins.write({path, content})`          | Create/overwrite a file              | Structured result                                     |
| `builtins.edit({path, edits})`             | Apply exact replacements to one file | Structured result with diff/patch details             |
| `builtins.bash({command, timeout?})`       | Run a bounded shell command          | Structured result, optional truncation/spill metadata |
| `builtins.powershell({command, timeout?})` | Windows-only shell execution         | Same result contract as bash                          |
| `builtins.ls({path?, limit?})`             | List a directory                     | Structured result, optional limit/truncation details  |
| `builtins.find({pattern, path?, limit?})`  | Find files                           | Structured result, optional limit/truncation details  |
| `builtins.grep({pattern, ...options})`     | Search content                       | Structured result, optional limit/truncation details  |

Results preserve `{content: [...], details?: {...}}` and any supplied JSON-compatible metadata. Only Pi's absent optional `details` and edit `firstChangedLine` are omitted; arbitrary non-JSON values fail strict validation. Content is untrusted file/process data, not instructions. Intermediate results stay in the guest unless explicitly returned; final output uses Script's untrusted framing. Stock truncation and Script IPC/explicit-output bounds still apply.

### Example

Discover before execution:

```js
script({
  action: "describe",
  description: "Inspect active builtin APIs",
  providers: ["builtins"],
});
```

Summarize a structured result instead of returning the entire file:

```js
script({
  action: "run",
  description: "Summarize package metadata",
  providers: ["builtins"],
  source: `
    const result = await builtins.read({path: "package.json"});
    const pkg = JSON.parse(result.content.map(block => block.text).join(""));
    return {name: pkg.name, scripts: Object.keys(pkg.scripts ?? {})};
  `,
});
```

Sequence authorized dependent mutations explicitly:

```js
script({
  action: "run",
  description: "Write and verify an example file",
  providers: ["builtins"],
  source: `
    await builtins.write({path: "example.txt", content: "before"});
    await builtins.edit({path: "example.txt", edits: [{oldText: "before", newText: "after"}]});
    return await builtins.read({path: "example.txt"});
  `,
});
```

A disabled `write` rejects with `capability_unavailable` before dispatch; catching it does not make the host run successful. Do not auto-enable tools or grant permissions to recover. An image-producing read rejects with `unsupported_image_use_direct_read`, without forwarding image/base64 data. Use the direct `read` tool to view the image instead; there is no automatic fallback or replay.

### Permissions and effects

Provider permission is not user approval. File writes, edits, and shell effects require the same applicable authorization as direct calls. Shell execution is broad host execution, **not a filesystem sandbox**. Builtins use the caller's execution-scoped cwd; shell session variables use its immutable session snapshot, never a mutable unrelated session. Host callers omitting session metadata get no inherited `PI_SESSION_*`/model metadata.

Nested calls do not synthesize ordinary Pi `tool_call` or `tool_result` hooks. In particular, the current MCP Gateway bash advisory **will not fire** for nested bash. User authorization and authenticated external-access instructions still apply: use MCP Gateway for authenticated external systems. This adapter does not inherit behavioral overrides, remote execution wrappers, path guards or custom hooks from other extensions; gate the outer Script call when required.

All methods, including mutations and shells, share Script's bounded concurrency. No adapter mutation serialization, transaction or rollback is added; stock Pi's own per-file queues remain unchanged. Callers must await dependent/overlapping operations. Successful writes can survive later failure or cancellation.

### Failure and lifecycle

Stock exceptions become sticky `builtin_failed` rejections with conservative unknown-outcome accounting; raw exception prose is not exposed. Image and missing-context rejections are known failures. Non-JSON or oversized results fail without lossy conversion, spill, or replay. Inspect host accounting even when guest code catches an error or returns JSON.

Script cancellation/deadlines propagate into Pi tools. Provider disposal, shutdown, and tree navigation abort selected runs and close queued admission; navigation installs a fresh registration, never revives old work. Late results cannot revise finalized receipts. Cancellation is not proof that a dispatched mutation had no effect. No automatic retries, grants, or replay. See [Script execution rules](../script/README.md#failures-and-lifecycle).

## Migration

This directory replaces `compact-tools`; remove old explicit loading paths and stale installed links before loading `builtins`. Do not load both directories. The repository's Stow source now contains only `builtins`; installation/linking and session reload remain explicit user actions, not effects of this rename. Existing compact rendering needs no settings migration. Script access is opt-in through its global allowlist; preserve any other allowed providers when adding `builtins`.

## Prior art

- [`pi-tool-display`](https://www.npmjs.com/package/pi-tool-display) — a full-featured extension with compact rendering for all built-in tools, MCP support, adaptive diffs, and configurable presets. The compact renderers are a deliberately smaller, hand-rolled subset focused on the built-in tools that are most verbose in this setup.
