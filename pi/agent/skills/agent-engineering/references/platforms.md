# Harness platforms: Pi and Codex

Use Pi for the extensible harness in this repository and Codex for OpenAI's coding-harness patterns. Keep model capabilities separate from platform support; check the installed release before relying on a specific API or command.

## Pi (`@earendil-works/pi-coding-agent`)

Pi is an opinionated minimal coding agent by Mario Zechner. Upstream, an extension is a TypeScript module; in this repo, extensions are organized as directory-based packages. Use the upstream Pi docs plus this repo's `AGENTS.md` for day-to-day extension conventions; this section captures harness-engineering-specific patterns.

Authoritative docs:

- [Extensions API (extensions.md)](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [SDK (sdk.md)](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
- [RPC (rpc.md)](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md)
- [Coding-agent README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md)
- [Examples](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)
- [CHANGELOG](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md)

Background reading:

- [Mario Zechner — Opinionated and Minimal Coding Agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/)
- [Armin Ronacher — Pi: The Minimal Agent](https://lucumr.pocoo.org/2026/1/31/pi/)

### Pi extension shape

Upstream, an extension entrypoint is a TypeScript module with a synchronous default-exported factory. In this repo that usually means an `index.ts` entrypoint inside `pi/agent/extensions/<name>/`:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // register tools, events, commands here
}
```

The factory receives the `ExtensionAPI` and registers tools (`pi.registerTool`), commands (`pi.registerCommand`), shortcuts/flags, events (`pi.on(event, ...)`), and UI (`pi.ui.setWidget`). Recent Pi versions also expose structured system-prompt options in `before_agent_start`, streaming-aware input events, exact automation session IDs, selective tool disablement, and RPC bash output that can stay out of model context.

### Pi-specific harness patterns

These showed up repeatedly across the Pi extensions surveyed for this skill:

1. **Tagged-output protocol > free text, ≤ JSON.** rmr's `<rmr:status>`, autonomous-dev's `STATUS:/PR_URL:/SUMMARY:` blocks. Models reliably emit tags inside markdown without escaping issues. JSON is more rigid; tags are more forgiving.
2. **Plan = intent, not diff.** Across rmr, roach-pi, agent-pi: "A good plan does NOT contain line-by-line diffs. The implementing agent decides the code-level details." Don't over-specify.
3. **Implementer prompt always says "don't gold-plate."** Universal failure mode. rmr-tackle: "Do NOT gold-plate. Implement what the plan asks for, elegantly, then stop." autonomous-dev-worker: "Keep PRs focused. Respect scope. Don't add unrelated features."
4. **Verify is parallelizable and benefits from diversity.** Single-pass verify is rarer than multi-pass.
5. **Termination is hard; cap + structured-output > free-text marker.** Ralph's text-match termination is fragile; tag-based or schema-based completion signals are robust.
6. **Worktrees are underused.** Only `roach-pi` uses them, and only for parallel subagents.
7. **Compaction is hostile to long pipelines.** Only `roach-pi` survives compaction by re-injecting workflow state; others assume single-shot or human-driven resume. Pi's `session_before_compact` / `session_compact` hooks are the right extension surface for making this durable.

### Pi gotchas

From this repo's `AGENTS.md` and the broader ecosystem:

- **Extensions run with full system permissions.** `extensions.md` explicitly warns. Only install trusted code, and enforce risky actions in tools rather than relying on prompt instructions.
- **`mock.method` from `node:test` can't replace ESM module exports** — they're non-configurable bindings. To stub something like `child_process.spawn`, wrap in an exported holder (`export const _spawn = { fn: _nodeSpawn }`). Call through `_spawn.fn(...)`. Tests then `mock.method(_spawn, "fn", stub)`. Reference pattern in this repo: `pi/agent/extensions/subagents/spawn.ts`.
- **RPC mode loses component-factory widgets** — only string arrays cross the RPC boundary. Design any widget you want RPC-portable as line arrays.
- **Events stream as JSON lines without an `id` field** (responses do); host code parsing the stream must not key on `id` for events.
- **Use `--exclude-tools` for least-privilege experiments.** Recent Pi releases can disable specific built-in, extension, or custom tools without removing the rest of the harness.
- **Use `InputEvent.streamingBehavior` for mid-stream steering.** Extensions can distinguish idle prompts, queued follow-ups, and live steering instead of guessing from UI state.
- **Use exact `--session-id` for automation.** Scripted runs can create or resume a project-local session deterministically.
- **Keep noisy RPC bash output out of context when appropriate.** RPC clients can pass `excludeFromContext` for output that should be visible to the caller but not fed back to the model.
- **`setWidget` cast pattern.** The typed signature is `pi.ui.setWidget`, but the in-repo convention — used by `pi/agent/extensions/todo/index.ts` — is `(pi as any).setWidget(...)` gated on `piAny.hasUI && typeof piAny.setWidget === "function"`. Match this when adding sticky widgets.
- **Tool schemas exposed to the agent are snake_case while internal task fields stay camelCase.** Map between them in the tool's `execute` body or validation breaks.
- **Atomic agent-tool mutations.** When an agent tool mutates shared state, collect ALL validation errors before rejecting, apply changes atomically with a single `notify()` on success, and return errors as tool result text (not `throw`) so the agent can read and recover.

### Cross-extension imports in this repo

Patterns specific to `pi/agent/extensions/`:

- Helpers shared across extensions go in `pi/agent/extensions/_shared/` (no `index.ts`, loader skips it).
- An extension can expose a curated public surface via `api.ts` that other extensions import from; `pi/agent/extensions/subagents/api.ts` is the current in-repo example.
- Module-level singletons are shared through Node's module caching, so shared state created once in a module will be seen by every importer.
- Keep public cross-extension imports intentional: prefer a small `api.ts` surface over importing deep internal files.

## Codex CLI

Use Codex's primary docs for its coding loop, layered `AGENTS.md` instructions, subagent configuration, and automation behavior. See [the Codex section in models.md](models.md#openai-codex-cli) for the retained platform baseline and documentation links. Do not assume Codex configuration or tool names transfer directly to Pi.

## Reusable skill design

Preserve the progressive-disclosure lesson from Anthropic's [Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills): expose concise routing metadata first, load the skill body when relevant, and retrieve supporting references as needed.

- Keep one skill focused on one coherent job.
- Describe triggering user intents and useful negative cases rather than listing features.
- Keep the core instructions short; put deep references, templates, examples, and scripts in supporting files.
- Record project-specific launch and verification recipes once so later sessions do not rediscover them.
- Enforce permissions and explicit-invocation requirements through the actual harness; do not assume frontmatter fields from another platform are supported.

## Tool and operations contracts

Platform choice does not remove the need for explicit tool contracts. For tools with side effects, document idempotency, retry safety, timeout/cancellation behavior, and whether the action is local, destructive, networked, or externally visible. For long-running workflows, persist phase state outside the conversation so sessions can be explained, resumed, or rolled back. See `operations-safety.md` for a checklist.

## Community references

- [dabit3 gist — How to Build a Custom Agent Framework with PI](https://gist.github.com/dabit3/e97dbfe71298b1df4d36542aceb5f158) — outside write-up on Pi as a stack.
- [awesome-pi-agent](https://github.com/qualisero/awesome-pi-agent) — curated index of Pi extensions/hooks/skills.
