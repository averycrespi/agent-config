# Subagents Fan-out Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use Skill(executing-plans) to implement this plan task-by-task.

**Goal:** Bound direct `spawn_agents` fan-out, make its concurrency operationally configurable without weakening the hard per-call safety ceiling, and expose selected engine capabilities—per-item thinking, file attachments, and structured output—without broadening the extension into writable or nested delegation.

**Architecture:** Keep `spawnSubagent` as the shared child-process engine. Add one extension-owned FIFO concurrency gate around direct `spawn_agents` launches, configured through the standard settings helpers and hard-clamped to 16. Reject batches larger than 16 before any launch. Widen the tool item schema once with `thinking`, `files`, and `output_schema`; do not expose raw model selection. Preserve input-order fan-in, collect-all-errors preflight validation, read-mostly tools, and fresh child sessions.

**Tech stack:** TypeScript Pi extension under `pi/agent/extensions/subagents/`, TypeBox schemas, shared config helpers, `node:test` + `tsx`, and existing child-process test stubs.

---

## Settled decisions

- The hard batch ceiling is fixed at `16` and is not configurable.
- Direct `spawn_agents` concurrency defaults to `4`, is configurable from `1..16`, and remains separate from workflow concurrency.
- Configuration uses global `extension:subagents.maxConcurrency`, `SUBAGENTS_MAX_CONCURRENCY`, and `/subagents-config`. Project settings do not control the extension-wide gate.
- There is no per-agent-type `max_concurrency` frontmatter.
- Per-item `thinking`, `files`, and `output_schema` are exposed.
- Per-item `model` is not exposed; agent definitions continue to own model selection.
- `files` may name any readable regular file. Relative paths resolve from `ctx.cwd`; absolute paths and symlinks to readable regular files are allowed. Pi owns native `@file` format, size, and context-window behavior.
- Cancellation preserves completed results, terminates running children through the existing signal path, and never launches queued children afterward.
- Structured output accepts only a recursively validated subset of JSON Schema. Unsupported types, keywords, and malformed schema definitions are rejected before any child launches.
- Public structured results use index-aligned envelopes that distinguish unrequested output, contract failure, and successful JSON values including `null`.
- Workflows keep their own worker scheduler, RPC policy, retries, timeout semantics, and result contract. This plan does not generalize the new pool for workflows.

## Existing seams to preserve

Paths are relative to the repository root. Edit `pi/`, never the stowed paths under `~/.pi/`.

- `pi/agent/extensions/subagents/types.ts`
  - `SpawnAgentItem` and `buildSpawnAgentsParams` define the model-facing item schema.
  - `AgentDefinition` already owns model and thinking defaults.
- `pi/agent/extensions/subagents/index.ts`
  - `validateSpawnAgentSpecs` is the atomic, collect-all-errors preflight gate.
  - `runSpawn` maps an agent definition and tool item to `SpawnInvocation`.
  - `runParallelSpawn` currently launches every item through unbounded `Promise.all`.
- `pi/agent/extensions/subagents/spawn.ts`
  - `SpawnInvocation` already accepts `files`, `thinking`, and `output`.
  - `buildArgs` already emits `--thinking` and native `@file` arguments.
  - Structured capture and contract validation already exist. Do not duplicate them in `index.ts`.
- `pi/agent/extensions/_shared/config.ts`
  - Use `readPiSettingsFiles`, `readExtensionSettings`, `mergeExtensionConfig`, and `registerConfigCommand`; intentionally ignore returned project settings because one extension-wide gate cannot safely have project-local ownership.
- `pi/agent/extensions/workflows/worker-source.ts`
  - Its scheduler runs JavaScript thunks inside a worker and has different failure semantics. It is reference material, not a reuse target.
- `pi/agent/extensions/subagents/api.ts`
  - Workflows already reuse the engine and activity tracker through this curated surface. Keep the new scheduler internal.

## Unified tool schema

The model-facing schema uses snake_case only where words are combined; internal engine fields remain camelCase.

| Tool field      | Type                  | Engine mapping                        | Semantics                                                      |
| --------------- | --------------------- | ------------------------------------- | -------------------------------------------------------------- |
| `agent`         | string                | agent lookup                          | Existing behavior                                              |
| `intent`        | non-empty string      | activity label                        | Existing behavior                                              |
| `prompt`        | string                | `SpawnInvocation.prompt`              | Existing behavior                                              |
| `thinking`      | optional enum         | `SpawnInvocation.thinking`            | Item → agent definition → parent Pi level                      |
| `files`         | optional string array | `SpawnInvocation.files`               | Any readable regular files; passed as native `@file` arguments |
| `output_schema` | optional object       | `SpawnInvocation.output = { schema }` | Opt-in validated structured result                             |

Do not add `model`, `max_depth`, `inherit_session`, tools, extensions, or writable-worktree controls.

## Task order

Task 1 (config, bounded scheduler, matching docs) → Task 2 (schema, pass-through, matching docs) → Task 3 (structured result shaping and matching docs) → Task 4 (guidance and cross-document consistency sweep).

---

### Task 1: Add bounded, configurable direct fan-out

**Files:**

- Create: `pi/agent/extensions/subagents/config.ts`
- Create: `pi/agent/extensions/subagents/config.test.ts`
- Create: `pi/agent/extensions/subagents/pool.ts`
- Create: `pi/agent/extensions/subagents/pool.test.ts`
- Modify: `pi/agent/extensions/subagents/types.ts`
- Modify: `pi/agent/extensions/subagents/index.ts`
- Test: `pi/agent/extensions/subagents/index.test.ts`

**Changes:**

1. Add constants in `types.ts`:

   ```ts
   export const DEFAULT_MAX_CONCURRENCY = 4;
   export const MAX_CONCURRENCY_CEILING = 16;
   export const MAX_AGENTS_PER_CALL = 16;
   ```

2. Add `config.ts` using the shared config helpers. Define:

   ```ts
   export type SubagentsConfig = { maxConcurrency: number };
   export const DEFAULT_SUBAGENTS_CONFIG = {
     maxConcurrency: DEFAULT_MAX_CONCURRENCY,
   };
   ```

   Configuration precedence is valid environment override → valid global setting → default. Read the global settings object from the agent settings file and deliberately ignore project settings. `SUBAGENTS_MAX_CONCURRENCY` is the environment override. A valid positive integer is clamped to 16 with a warning when necessary. An invalid environment value is ignored with a warning so a valid global setting survives; an invalid global value falls back to 4 with a warning.

3. Register `/subagents-config` with `registerConfigCommand`. Declare an empty `sensitiveFields` list because this configuration contains no secrets. The command must display the same global/env-only effective value regardless of `ctx.cwd`.

4. Add an internal FIFO concurrency gate in `pool.ts` with this contract:

   ```ts
   type Release = () => void;

   interface ConcurrencyGate {
     acquire(signal?: AbortSignal): Promise<Release | undefined>;
     setLimit(limit: number): void;
   }
   ```

   `acquire` returns `undefined` only when the signal aborts before admission; scheduler defects reject normally and must not be converted into cancellation. A successful acquisition returns an idempotent release closure, eliminating unmatched or double releases. The gate must:
   - enforce a positive integer limit;
   - preserve FIFO waiter order;
   - remove an aborted waiter without consuming a slot;
   - never exceed the current limit;
   - stop admitting new work after the limit is lowered until active work drops below the new limit; and
   - admit queued work immediately when the limit is raised and capacity becomes available.

   Keep the gate internal; do not export it from `api.ts`.

5. Create one gate in the extension entry point so overlapping `spawn_agents` calls share the same direct-subagent capacity. Before each execution, reload the global/env-only effective config and apply `maxConcurrency`; this permits explicit settings changes without introducing cwd ownership. Notify configuration warnings through `ctx.ui.notify` when UI is available.

6. Extend `validateSpawnAgentSpecs` with the fixed ceiling. A request containing more than 16 items accumulates a validation error and launches no children.

7. Change `runParallelSpawn` to acquire the shared gate before calling `runSpawn` and invoke the returned release closure in `finally`. Keep index-aligned `Promise.all` fan-in so result order remains input order. Initialize waiting state as `queued` and emit the initial combined update immediately; activity events replace queued state when a child starts.

8. If `acquire` returns `undefined`, synthesize an index-aligned aborted item result without calling `spawnSubagent`. Before emitting, set that item’s activity state to `phase: "aborted"`, `resolved: true`, a cancellation `errorMessage`, and an updated `lastUpdateAt`. Running children continue to receive the existing tool signal and terminate through `spawn.ts`. Completed results remain unchanged. Do not catch arbitrary gate errors as cancellation.

9. Update the concurrency/config sections of `pi/agent/extensions/subagents/README.md` and `DESIGN.md` in this task so the feature commit is self-consistent. Retain the existing agent-file and `PI_CODING_AGENT_DIR` documentation. State that `maxConcurrency` is global/env-only and that project settings are ignored for this field.

**Tests:**

- Config normalization: 1, 4, and 16 are retained; 99 clamps to 16 with a warning; invalid global values fall back to 4.
- A valid environment override takes precedence over the global setting; an invalid environment override is ignored with a warning and preserves a valid global setting.
- Project settings do not affect loading, and `/subagents-config` displays the same parsed value from different cwd values.
- Pool tests prove the limit, FIFO ordering, resizing up and down, queued abort removal, idempotent release, and rejection propagation distinct from cancellation.
- A 17-item tool request returns a recoverable validation error and makes zero child spawn calls.
- Overlapping `runParallelSpawn` calls sharing one gate never exceed the configured active count.
- Six items with concurrency 4 launch only four initially and return results in input order despite out-of-order completion.
- Cancellation preserves already completed output, aborts running children, returns terminal `phase: "aborted"` entries for queued work, emits updated activity, and records zero post-cancellation child launches.

**Acceptance criteria:**

- The fixed per-call ceiling is enforced atomically before launch.
- Direct subagent concurrency defaults to 4, is configurable from 1 through 16, and is shared across overlapping direct tool calls.
- Cancellation never launches queued work after abort.
- `make typecheck` and `make test` pass.

**Commit:** `feat(subagents): bound direct fan-out`

---

### Task 2: Expose thinking, readable files, and structured schemas

**Files:**

- Modify: `pi/agent/extensions/subagents/types.ts`
- Create: `pi/agent/extensions/subagents/schema.ts`
- Create: `pi/agent/extensions/subagents/schema.test.ts`
- Modify: `pi/agent/extensions/subagents/index.ts`
- Modify: `pi/agent/extensions/subagents/README.md`
- Modify: `pi/agent/extensions/subagents/DESIGN.md`
- Test: `pi/agent/extensions/subagents/index.test.ts`
- Test: `pi/agent/extensions/subagents/spawn.test.ts` only if existing argument tests do not already prove native `@file` and thinking emission

**Changes:**

1. Define the CLI-supported thinking levels:

   ```ts
   export const THINKING_LEVELS = [
     "off",
     "minimal",
     "low",
     "medium",
     "high",
     "xhigh",
   ] as const;
   ```

2. Widen `SpawnAgentItem` and `buildSpawnAgentsParams` once with:

   ```ts
   thinking?: ThinkingLevel;
   files?: string[];
   output_schema?: Record<string, unknown>;
   ```

   Do not add a model field. Tool descriptions must state that file contents are sent to the selected model/provider and may appear in retained logs or spillover output.

3. Give `validateSpawnAgentSpecs` access to `ctx.cwd` and append all item errors rather than failing fast:
   - thinking must be one of the six supported levels;
   - every file path must be non-empty;
   - resolve relative paths against `cwd`, while retaining absolute paths;
   - use filesystem metadata that follows symlinks and require a regular file;
   - verify read access before launch;
   - do not impose workspace containment, attachment count, byte-size, or content-type restrictions;
   - `output_schema` must pass the recursive supported-subset validator described below.

   Preserve atomic batch validation. If any item is invalid, launch no children. Accept the normal check/use race: Pi remains the final authority if a file changes after preflight.

4. Add `schema.ts` with a recursive schema-definition validator. It returns all path-qualified errors and accepts only:
   - one optional string `type` from `null`, `boolean`, `object`, `array`, `number`, `integer`, or `string`; reject type arrays;
   - `enum` as a non-empty array of JSON scalars (`null`, boolean, finite number, or string);
   - `const` as one JSON scalar;
   - annotation-only `title` and `description` strings;
   - for `type: "object"`, `required` as unique strings, `properties` as recursively validated schemas, and `additionalProperties` as a boolean; require `properties` when `additionalProperties` is `false` because that is the boundary the engine enforces;
   - for `type: "array"`, `items` as one recursively validated schema.

   Reject unknown keywords, structural keywords on the wrong type, non-JSON values, and malformed nested definitions. This validation protects the public tool from engine behavior that would otherwise ignore unsupported constraints. Do not advertise or accept nullable type arrays, `$ref`, composition keywords, numeric/string bounds, tuple items, or conditional schemas. Keep the existing programmatic `SpawnInvocation.output` API unchanged.

5. Change `runSpawn` to accept the complete item and map:

   ```ts
   files: spec.files,
   thinking: spec.thinking ?? agent.thinking ?? thinkingLevelFromPi(pi),
   output: spec.output_schema ? { schema: spec.output_schema } : undefined,
   ```

   Keep model selection unchanged as `agent.model ?? modelSelectorFromCtx(ctx)`.

6. Continue using native `@file` behavior in `spawn.ts`; do not read or inline file contents in the extension.

7. Update README parameter, file-disclosure, and supported-schema documentation in this task. Update DESIGN with the preflight schema-boundary invariant. Preserve existing agent-file, agent-directory, logging-location, and retention documentation.

**Tests:**

- All validation errors are collected for invalid thinking, blank paths, unreadable paths, missing paths, directories, and non-object schemas.
- Relative, absolute, and symlinked readable regular files pass validation.
- A thinking override reaches `--thinking`; omission retains agent-definition and parent fallback behavior.
- Files reach the child as native `@path` arguments.
- `output_schema` activates the existing structured-output tool and schema environment path.
- Schema tests cover every supported type/keyword, nested paths, unknown keywords, type arrays, misplaced structural keywords, malformed `required`/`properties`/`items`, non-JSON values, non-scalar `enum`/`const` values, and `additionalProperties: false` without `properties`.
- A batch containing any unsupported schema launches zero children and reports all schema-definition errors.
- The TypeBox schema does not expose `model`.

**Acceptance criteria:**

- The public tool exposes exactly `thinking`, `files`, and `output_schema` as new optional fields.
- File validation implements the deliberately broad readable-regular-file policy.
- Calls omitting all new fields preserve existing prose behavior.
- `spawn.ts` requires no new execution logic; the public tool rejects schemas outside the engine’s safe subset before calling it.
- `make typecheck` and `make test` pass.

**Commit:** `feat(subagents): expose controlled item options`

---

### Task 3: Surface structured results and contract failures

**Files:**

- Modify: `pi/agent/extensions/subagents/index.ts`
- Modify: `pi/agent/extensions/subagents/README.md`
- Modify: `pi/agent/extensions/subagents/DESIGN.md`
- Test: `pi/agent/extensions/subagents/index.test.ts`

**Changes:**

1. Add an explicit `details.ok` to each internal `runSpawn` result. This field is consumed by `runParallelSpawn`; do not claim it is directly exposed as an item-level public result because current fan-in does not return raw child details.

2. For structured success, render the validated value as fenced, formatted JSON in that item’s existing Markdown section and retain the raw value internally for aggregate shaping.

3. For structured failure, rely on `spawnSubagent`’s existing `ok: false` outcome and `formatSpawnFailure`; do not revalidate result values in `index.ts`.

4. Count failed items from internal `details.ok === false`, not exit-code heuristics. This ensures a process that exits zero but fails its structured contract still increments `failed` and makes `allOk` false.

5. When at least one item requested `output_schema`, expose an input-order `details.structured` array with this discriminated envelope:

   ```ts
   type StructuredItemResult =
     | { requested: false }
     | { requested: true; ok: true; value: unknown }
     | { requested: true; ok: false; error: string };
   ```

   A successful JSON `null` is therefore `{ requested: true, ok: true, value: null }`, not a sentinel. Schema-requested process failures, cancellation, missing tool calls, malformed values, and contract violations use the failed envelope. Omit `details.structured` entirely for prose-only batches.

6. Preserve existing section headers, separators, spillover behavior, and prose content when no schema is requested. Compatibility applies to visible prose content; aggregate structured envelopes are additive.

7. Update README result examples and DESIGN result-contract guidance in this task so this feature commit is self-consistent.

**Tests:**

- Structured success returns fenced JSON and an index-aligned success envelope, including a distinct successful `value: null` case.
- Missing, malformed, incomplete, invalid, and tool-error structured outcomes count as failures even with exit code zero and return failed envelopes.
- A mixed prose/structured batch distinguishes `{ requested: false }`, successful values, and failed contracts in input order.
- A prose-only batch has no `details.structured` key and unchanged section bodies.
- Internal failed and canceled item results set `details.ok: false`; public schema-requested failures expose `{ requested: true, ok: false, error }`.

**Acceptance criteria:**

- Structured contracts are observable and affect aggregate success correctly.
- Prose-only callers retain their existing visible result contract.
- `make typecheck` and `make test` pass.

**Commit:** `feat(subagents): surface structured results`

---

### Task 4: Update guidance and extension documentation

**Files:**

- Modify: `pi/agent/extensions/subagents/index.ts`
- Modify: `pi/agent/extensions/subagents/README.md`
- Modify: `pi/agent/extensions/subagents/DESIGN.md`
- Modify: `pi/agent/extensions/subagents/API.md` only if descriptions of existing exported engine outcomes need clarification
- Test: `pi/agent/extensions/subagents/index.test.ts`

**Changes:**

1. Update injected delegation guidance:
   - at most 16 agents are accepted per call;
   - execution uses a bounded queue rather than launching every item simultaneously;
   - `thinking`, `files`, and `output_schema` are optional;
   - `model` is intentionally controlled by agent definitions;
   - use structured schemas only when machine-readable fan-in is needed.

2. Audit the README changes landed with Tasks 1–3 as one coherent user contract. It must contain this settings row while retaining existing agent-file and `PI_CODING_AGENT_DIR` guidance:

   | Field            | Default | Environment override        | Description                                                                            |
   | ---------------- | ------- | --------------------------- | -------------------------------------------------------------------------------------- |
   | `maxConcurrency` | `4`     | `SUBAGENTS_MAX_CONCURRENCY` | Global maximum direct children running concurrently; project settings ignored; `1..16` |

   Keep the JSON example and `/subagents-config` documentation from Task 1.

3. Confirm the README separately documents the fixed 16-item batch ceiling, broad file-data boundary, native Pi attachment handling, supported schema-definition subset, structured result envelopes, and contract failures.

4. Audit DESIGN lifecycle and invariants established in Tasks 1–3:
   - atomic preflight validation;
   - one extension-owned resizable FIFO gate controlled only by global settings/environment;
   - queued cancellation removes waiters, sets terminal aborted activity, and prevents launch;
   - input-order result preservation;
   - recursive rejection of unsupported public schemas;
   - no per-agent concurrency policy;
   - no process-wide coupling with workflows;
   - no raw model override;
   - structured output remains default-off.

5. State explicitly that workflows continue to reuse `spawnSubagent` and the activity tracker through `subagents/api.ts`, but retain their worker-side scheduler and policy boundary. Do not add workflow refactoring to this implementation.

6. Keep logging documentation accurate. The extension adds configuration but no new log locations or retention behavior; attached file contents and structured values may still appear in existing retained artifacts.

**Acceptance criteria:**

- Guidance, README, and DESIGN contain no stale claims about unbounded `Promise.all`, programmatic-only structured output, no settings, per-agent caps, project-level concurrency, workspace-only files, nullable sentinels, or raw model overrides.
- Global/env-only configuration, invalid override behavior, command, file disclosure, cancellation, supported schema-definition subset, and structured envelopes are documented.
- Existing agent-file, `PI_CODING_AGENT_DIR`, logging-location, and retention documentation remains present.
- `make typecheck`, `make test`, and `npm run format:check` pass.

**Commit:** `docs(subagents): finalize bounded fan-out guidance`

---

## Final verification

Run from the repository root:

```bash
make typecheck
make test
npm run lint
npm run format:check
```

Then inspect:

```bash
git diff --check
git status -sb
```

Confirm every explicit requirement against concrete evidence:

- 17-item atomic rejection;
- global/env-only configurable and clamped shared direct pool;
- invalid environment override preserves valid global configuration;
- no queued launch after cancellation and terminal aborted activity;
- input-order results;
- thinking/files/schema exposure with no model field;
- broad readable-regular-file behavior;
- recursive rejection of schemas outside the supported subset;
- structured contract failures reflected in aggregates and unambiguous result envelopes, including successful JSON `null`;
- updated user and maintainer documentation with existing configuration/logging guidance preserved.

## Deliberately deferred

- Sharing a scheduler between subagents and workflows
- Refactoring workflow RPC, retry, timeout, budget, journal, or result semantics
- A policy-neutral invocation/result adapter unless implementation produces clear, repeated host-side duplication
- Process-wide concurrency across extensions
- Per-agent-type throttles
- Raw model selection from `spawn_agents`
- Nested delegation or session inheritance
- Writable agents, worktrees, branch management, or automatic merge/recombination
- Reducer/synthesis fan-in
