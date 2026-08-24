# subagents Design

`subagents` provides one centrally enforced child-execution contract: caller-owned prompt and intent, fixed composable capabilities, and a configured routing profile that couples model selection with reasoning effort. It supports bounded read-only fan-out and serialized writable delegation without becoming a role or arbitrary preset system.

## Architecture

- `types.ts` owns the five capability names, three profiles, runtime-compatible effort values mapped to Pi thinking levels, the model-facing schema, and intent-first activity state.
- `config.ts` owns global/env-only concurrency, profile model/effort pairs, the capability ceiling, and `/subagents-config`.
- `capabilities.ts` is the fixed dependency-complete grant catalog and deterministic union resolver.
- `run.ts` is the policy boundary. It validates sanitized requests against config and Pi's live model registry, then translates them to an internal process invocation.
- `spawn.ts` is internal process machinery: CLI construction, extension resolution, recursion, environment inheritance, JSONL parsing, structured output, cancellation, spillover, and retained diagnostics.
- `index.ts` registers `spawn_agents`, performs complete atomic batch preflight, schedules direct calls, and combines results.
- `pool.ts`, `schema.ts`, `activity.ts`, `render.ts`, and `utils.ts` own concurrency, schema validation, progress, terminal-safe rendering, and extension short-name resolution.
- `api.ts` is the curated cross-extension surface documented in `API.md`.

No Markdown agent loader or named-agent runtime exists.

## Policy resolution

A sanitized request contains intent, prompt, capabilities, profile, optional files/output, cwd, cancellation/logging callbacks, and a trusted live model registry. It cannot specify raw tools, extensions, exact models, effort, environment, system prompts, skills/templates, context-file behavior, session inheritance, or recursion.

Resolution is fail-closed:

1. Load global/env-only `extension:subagents` configuration.
2. Validate non-empty intent/prompt and explicit capability/profile fields.
3. Reject unknown profiles and unknown or globally disallowed capabilities.
4. Map the profile to one configured `provider/model` selector and effort.
5. Resolve that selector through the supplied live Pi model registry.
6. Call Pi's runtime `getSupportedThinkingLevels()` for the selected model and reject unsupported configured effort without clamping.
7. Expand capabilities in fixed catalog order, deduplicating tools/extensions.
8. Build the internal spawn invocation.

The local compatibility union includes `max` even though the repository's development dependency types predate it. Runtime validation remains authoritative, so the installed Pi runtime may allow `max` when both configuration and the selected model support it.

## Capability invariants

The only capability names are `read-filesystem`, `write-filesystem`, `exec-shell`, `read-broker`, and `read-web`. Their grants are fixed in `capabilities.ts`. `write-filesystem` grants only `edit` and `write`; read and shell authority remain explicit. `read-broker` forces read-only/reject environment values after inherited process environment. Web and broker include only `read` as a spill-file dependency. Empty capabilities produce no tools or extensions.

Direct batch preflight rejects any multi-agent request containing `write-filesystem` or `exec-shell`, and a shared exclusive gate serializes separate mutable calls. This prevents concurrent mutable children but does not sandbox paths or credentials. Saved workflows impose a stricter caller boundary and reject both mutable capabilities.

Structured output is orthogonal policy composition. When requested, `spawn.ts` adds only the generic structured-output extension/tool and completion instructions. Callers cannot request it as a raw capability.

## Public/internal boundary

`api.ts` exports `runSubagent()` and sanitized types, outcomes, structured-output contracts, schema validation, and activity tracking. It does not export `spawnSubagent`, `SpawnInvocation`, loaders, raw tools, extension resolution, or process controls. Direct spawning and workflows both route through `runSubagent()`.

Keep `spawn.ts` import-local to this directory; colocated engine tests may import it directly. Never add a convenience export that lets another extension bypass capability, profile, configured-effort, or live-model validation.

## Direct batch lifecycle

`spawn_agents` preflights every item before gate acquisition. Errors are collected across required fields, policy, live model resolution/compatibility, attachments, and schemas. Any error launches zero children.

Valid read-only items retain input order while independently acquiring the shared abort-aware FIFO gate. Mutable requests contain exactly one item. Each launch creates an activity tracker, calls the sanitized API, settles structured/prose output, records diagnostics, releases capacity exactly once, and participates in ordered fan-in. Assistant usage events are accumulated per child and combined across the batch, including reported usage from failed or aborted children. The final `spawn_agents` tool result exposes that aggregate through Pi's top-level `usage` contract so session accounting and other extensions observe delegated model work. Combined output is intent-first and may spill through the shared helper.

Config reloads carry an invocation generation so an older asynchronous read cannot overwrite a newer direct concurrency limit. Project settings are excluded because overlapping calls from different cwd values share one host policy.

## Child process invariants

Every process launch:

- uses JSON prompt mode and a fresh no-session child;
- always passes `--no-skills` and `--no-prompt-templates`;
- never passes `--no-context-files`, preserving normal `AGENTS.md`/`CLAUDE.md` discovery;
- starts with `--no-extensions` and enables only capability-resolved paths plus structured output when requested;
- preserves existing short-name extension resolution and project-extension behavior;
- inherits `process.env`, applies capability environment values, then sets `PI_SUBAGENT_DEPTH` authoritatively;
- creates secure retained-log staging before launch;
- settles only after process cleanup.

Environment inheritance is deliberate; `exec-shell` is not a security sandbox and can mutate.

## Structured output

`schema.ts` validates the public supported subset before direct launch. `spawn.ts` writes an owner-only temporary schema, adds the structured tool and reminder contract, captures `details.value`, performs parent-side validation, and removes temporary files. Missing, incomplete, malformed, tool-error, schema-invalid, provider, process, and cancellation states remain distinct failures. Same-session reminders and provider-compatible root envelopes remain owned by `structured-output`.

## Activity and rendering

Default tool output includes the aggregate `spawn_agents` line and the per-agent progress inventory. Each agent uses two logical lines: stable identity and run statistics first, then compact execution policy with volatile activity last. The second line formats policy as `profile (capabilities)`, maps fixed capabilities to `fs`, `write`, `shell`, `broker`, and `web`, and omits empty capability sets. Expansion adds retained-log paths and secondary errors without replacing or duplicating the default progress rows. Tool arguments are never retained for display. Renderers strip controls, collapse dynamic line breaks, bound strings, and use the shared width-aware component. Prompts and bulky/raw tool values never enter result rendering; log paths remain expanded diagnostics.

## Recursion, cancellation, and diagnostics

`PI_SUBAGENT_DEPTH` provides recursion control. Direct and curated API calls default to one child level. Queued cancellation removes waiters without consuming capacity; running cancellation terminates the child and waits for close.

`spawn.ts` writes complete combined stdout/stderr to gzip staging with backpressure. Success discards staging. Failure/abort may publish a finalized owner-only log in the shared seven-day/1 GiB retained-artifact pool. Diagnostic failures never replace the primary child outcome and never expose incomplete paths. Spillover is separate and may also contain sensitive raw output.

## Non-goals

- Named agents, roles, caller-defined profiles, reusable prompts, dynamic capability definitions, or project-local capability packs.
- Writable parallel coordination, worktree coordination, or merge orchestration.
- Workspace-root enforcement, environment sanitization, credential isolation, or changing extension short-name resolution.
- Per-extension profile overrides, parent model/effort inheritance, or silent effort clamps.

## Change guidance

Preserve the curated API and fail-closed resolver. Any new capability must have a dependency-complete fixed grant, deterministic tests, user documentation, and explicit security analysis. Test policy before process machinery: exact grants, profile configuration precedence, live model resolution, configured effort support, mutable-call serialization, atomic direct preflight, child CLI invariants, structured output, cancellation, diagnostics, and hostile/narrow rendering. Do not broaden authority through caller-controlled raw fields.
