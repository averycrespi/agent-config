# Harness platforms: Claude Code, the Claude Agent SDK, and Pi

Three platforms dominate the agent-config ecosystem in this repo: **Claude Code** (Anthropic's CLI/IDE harness), the **Claude Agent SDK** (the same harness as a programmable library), and **Pi** (`@earendil-works/pi-coding-agent`, an opinionated minimal harness). This document covers what each gives you, how to extend it, and the gotchas that bite harness builders.

## Claude Code

Claude Code is a deterministic harness around the Claude Agent loop. One retrospective estimated that ~98.4% of the codebase is non-LLM infra (per [Anthropic's Claude Code retrospective](https://newsletter.pragmaticengineer.com/p/how-claude-code-is-built)); treat that number as an illustrative retrospective claim, not a public API guarantee. The extension surface that you, as a harness engineer, work with is:

- **Hooks** — deterministic shell commands run on lifecycle events; useful as enforcement points for safety policy.
- **Skills** — instruction packages loaded on demand.
- **Subagents** — separate agent definitions with their own context window, invoked through the `Agent` tool.
- **Slash commands** — user-triggered or model-invocable named commands.
- **MCP servers** — external tool providers.
- **Settings** — JSON files configuring permissions, env vars, hooks, and providers.
- **Routines** — cron / API / GitHub-triggered scheduled runs.
- **Plugins** — bundles of all of the above as one installable unit.

### Hooks

Authoritative: [Hooks reference](https://docs.claude.com/en/docs/claude-code/hooks) and [Hooks getting-started guide](https://docs.claude.com/en/docs/claude-code/hooks-guide).

Hooks fire on lifecycle events across sessions, turns, tools, subagents, configuration, compaction, worktrees, MCP elicitation, and file watching. The load-bearing events for harness authors are `PreToolUse`/`PostToolUse`/`PostToolUseFailure`, `PermissionRequest`/`PermissionDenied`, `PostToolBatch`, `SubagentStart`/`SubagentStop`, `InstructionsLoaded`, `PreCompact`/`PostCompact`, `WorktreeCreate`/`WorktreeRemove`, and `SessionStart`/`SessionEnd`. Command hooks receive JSON on stdin; HTTP hooks receive JSON in the POST body; LLM hooks run as model prompts.

**Critical exit-code semantics that everyone trips over:**

- **Exit 0**: continue normally.
- **Exit 1**: log and _continue_. This does NOT block. ([dev.to "5 Hook Mistakes"](https://dev.to/yurukusa/5-claude-code-hook-mistakes-that-silently-break-your-safety-net-58l3))
- **Exit 2**: block. The action is canceled and the hook's stderr is shown to the model.

Use exit 2 when you actually want to stop something. Exit 1 is observability only. Prefer structured hook output such as `permissionDecision: "deny"` / `permissionDecisionReason` when the event supports it; it is clearer than encoding policy in process exit status.

When something _must_ run on every action, hooks or permission callbacks are the right tool — `CLAUDE.md` instructions are advisory and the model can ignore them. Hooks are deterministic.

**Common hook gotchas:**

- A single JSON syntax error in `settings.json` silently disables the entire settings file, including all hook configuration. No warning. ([Hooks Not Firing troubleshooting](https://claudelab.net/en/articles/claude-code/claude-code-hooks-not-firing-troubleshooting))
- Settings hierarchy precedence is **reversed from intuition**: managed > CLI > local > shared > user. A managed policy will quietly override your user config.
- Template variables like `{{tool.name}}` and `{{tool.input.file_path}}` appear literally in some hook contexts. ([Issue #2814](https://github.com/anthropics/claude-code/issues/2814))
- Some events ignore `matcher` silently (`UserPromptSubmit`, `PostToolBatch`, `Stop`, `WorktreeCreate`, etc.). Put argument-level filtering in the handler or in an event-supported `if` predicate.

### Skills

Authoritative: [Skills](https://docs.claude.com/en/docs/claude-code/skills), [Skill authoring best practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices), and [Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills).

The skill loading model is **progressive disclosure**:

1. At startup, only `name` + `description` from each `SKILL.md` frontmatter is loaded into the system prompt.
2. When the model decides a skill applies (based on the description), it reads the `SKILL.md` body via the Bash/Read tool.
3. Deeper bundled files (`references/*.md`, scripts) load only when the SKILL.md content directs to them.

**Implication**: the description is load-bearing. It's the _only_ signal the model has when deciding whether to invoke. Bad description = skill never invoked. Good description names the user intents that should trigger it.

**Skill-authoring rules from Anthropic's official guidance:**

- One skill, one job. Don't bundle unrelated capabilities.
- Description must answer "when to invoke" — name user intents, not features. Current Claude Code also supports `when_to_use`; combined routing text is capped in the skill listing, so put the key trigger first.
- Include negative cases when routing can be confused: "do not use when..." is often as important as "use when...".
- Use `disable-model-invocation: true` for skills that should only fire on explicit user request.
- Use `allowed-tools` / `disallowed-tools`, `model`, and `effort` frontmatter when the skill needs a narrower or different execution profile for one turn.
- Bundle deep reference material, templates, examples, and scripts in supporting files; keep `SKILL.md` itself short. Once loaded, the body stays in context across turns.

Claude Code ships bundled skills such as `/code-review`, `/batch`, `/debug`, `/loop`, `/run`, `/verify`, and `/run-skill-generator`. The `/run-skill-generator` pattern is harness-relevant: record the project-specific launch/verification recipe once as a skill so later agents stop rediscovering it.

This `agent-engineering` skill is itself an example of the pattern.

### Subagents

Authoritative: [Sub-agents](https://docs.claude.com/en/docs/claude-code/sub-agents) and [Subagents in Claude Code blog](https://claude.com/blog/subagents-in-claude-code).

Subagents are markdown files in `.claude/agents/*.md` (project) or `~/.claude/agents/` (user), can also be provided by managed settings, CLI JSON, or plugins, and are invoked through the `Agent` tool with a prompt and an optional subagent type. Each subagent runs in an isolated context window — the parent doesn't see what the subagent saw, only its final response. Claude Code includes built-in `Explore` (Haiku, read-only), `Plan` (read-only planning research), and `general-purpose` subagents.

**Key knobs:**

- `isolation: worktree` in the frontmatter creates a temporary git worktree for the subagent. **At the time of writing, issue reports say it silently no-ops outside a git repo** ([issue #39886](https://github.com/anthropics/claude-code/issues/39886)).
- At the time of writing, issue reports say worktree subagents branch from `origin/main`, not the parent's HEAD ([issue #50850](https://github.com/anthropics/claude-code/issues/50850)). Surprises workflows that assume the subagent inherits parent's branch state.
- Tools, disallowed tools, model, permission mode, MCP servers, hooks, max turns, preloaded skills, memory, effort, background execution, isolation, and color can be configured in subagent frontmatter or CLI JSON. Avoid the default-all surface for specialized agents when a narrower tool set is possible.
- The subagent's prompt should be self-contained — it has no access to prior conversation.

**When to use them:**

- Read-only fan-out: search, retrieval, review, classification.
- Anything verbose where you only need a summary.
- Anything that would pollute the parent context if inlined.
- Cross-family review only when an external orchestrator or bridge actually routes the review to a non-Claude model; ordinary Claude Code subagents should not be assumed to do this.

**When not to:**

- Anything that needs prior conversation context.
- Parallel writes to overlapping files.
- Cheap operations where the orchestrator decision is the hard part.

### MCP

Authoritative: [MCP](https://docs.claude.com/en/docs/claude-code/mcp).

Three configuration scopes:

- **Local** (default): in `~/.claude.json`, per-machine.
- **Project**: in `.claude/settings.json`, checked into the repo.
- **User**: in `~/.claude/settings.json`.

MCP tools surface to the model as regular tools with provider-prefixed names (e.g. `mcp__github__list_pull_requests`, or `mcp__mcp-broker__github_list_pull_requests` when GitHub is exposed through a broker server named `mcp-broker`). The Tool Search Tool (see `models.md`) becomes very useful when you have many MCP tools — defer-load avoids 30+ tool schemas in every system prompt.

### Settings.json

Authoritative: [Settings](https://docs.claude.com/en/docs/claude-code/settings).

Permission rule format: `Tool` or `Tool(specifier)` (e.g. `Bash(git diff:*)`). Evaluation order: **deny → ask → allow, first match wins**. This is critical when debugging permission prompts — a missing deny doesn't allow; a missing allow with a matching ask still asks.

Hierarchy (highest priority first):

1. Managed (admin-pushed)
2. CLI flags
3. `.claude/settings.local.json`
4. `.claude/settings.json`
5. `~/.claude/settings.json`

Use the `update-config` skill in this repo for non-trivial settings edits.

### Slash commands

Authoritative: [Slash commands](https://docs.claude.com/en/docs/claude-code/slash-commands).

Two flavors:

- `.claude/commands/*.md` — legacy-style prompt commands.
- Plugin commands — bundled in plugins.

New procedural work should usually be a skill: skills can be model-invoked, scoped with tools/model/effort, packaged in plugins, and progressively disclose supporting files. Keep commands for behavior that must be explicitly slash-invoked or that already exists as a stable command contract.

### Routines

Authoritative: [Routines](https://code.claude.com/docs/en/routines) and [Introducing routines blog](https://claude.com/blog/introducing-routines-in-claude-code).

Three trigger modes:

- **Cron-like schedules** (cron-syntax recurring runs).
- **Per-routine HTTP endpoint** with bearer token auth.
- **GitHub triggers** — `pull_request`, `release` events.

Per-tier daily caps (Pro 5, Max 15, Team/Enterprise 25). Each event is a fresh session — GitHub-triggered routines do NOT reuse sessions across events. Two PR updates = two independent runs with no cross-event state.

### Plugins and marketplaces

Authoritative: [Plugins reference](https://docs.claude.com/en/docs/claude-code/plugins-reference), [Plugin marketplaces](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces).

Plugins bundle skills, agents, hooks, MCP servers, LSP servers, background monitors, default settings, and executables on `PATH` as one installable unit. Use standalone `.claude/` configuration for one repo or personal experiments; use plugins for versioned/team/community distribution. Marketplace catalogs enable version pinning and automatic updates, and local plugin directories/URLs support test-before-publish workflows.

### Claude Code on the web

Authoritative: [Claude Code on the web](https://docs.claude.com/en/docs/claude-code/claude-code-on-the-web).

Cloud sessions at claude.ai/code, fresh VM per session, mobile monitoring. Useful for routines that should run in a clean environment.

## Claude Agent SDK

Authoritative: [Agent SDK overview](https://docs.claude.com/en/docs/agent-sdk/overview), [Agent loop](https://platform.claude.com/docs/en/agent-sdk/agent-loop), and the full [migration guide](https://docs.claude.com/en/docs/claude-code/sdk/migration-guide) for the Claude Code SDK → Claude Agent SDK rename.

The SDK is the Claude Code agent loop, programmable. Same loop, same built-in tools, same hooks model, same subagent shape — but you control the orchestration in code instead of via CLI flags.

Language-specific docs:

- [TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [TypeScript V2 preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview) (unstable session-based send/stream API)
- [Python reference](https://platform.claude.com/docs/en/agent-sdk/python)

Surface for harness work:

- [Subagents in the SDK](https://docs.claude.com/en/docs/agent-sdk/subagents) — programmatic vs filesystem-discovered agents, `.claude/agents/` auto-detect, isolation defaults.
- [Custom tools](https://docs.claude.com/en/api/agent-sdk/custom-tools) — register tools the agent sees.
- [MCP in the SDK](https://docs.claude.com/en/docs/agent-sdk/mcp) — wire MCP servers.
- [Permissions handling](https://docs.claude.com/en/docs/agent-sdk/permissions) — `canUseTool` callback or permission-prompt-tool pattern.
- [Slash commands in the SDK](https://docs.claude.com/en/docs/claude-code/sdk/sdk-slash-commands) and [Plugins in the SDK](https://docs.claude.com/en/docs/agent-sdk/plugins).

Reference implementations:

- [claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [claude-agent-sdk-python releases](https://github.com/anthropics/claude-agent-sdk-python/releases) — track API drift via release notes.
- [claude-cookbooks](https://github.com/anthropics/claude-cookbooks) — `patterns/agents/` has orchestrator-workers, evaluator-optimizer, parallelization examples directly applicable to harness design.
- [anthropic-quickstarts](https://github.com/anthropics/anthropic-quickstarts) — customer-support-agent and computer-use-demo as deployable references.
- [Apple Xcode + Claude Agent SDK](https://www.anthropic.com/news/apple-xcode-claude-agent-sdk) — reference integration showing what a third-party harness on top of the SDK looks like.

The SDK is the right choice when:

- You want the Claude Code loop but not the CLI shell.
- You need programmatic control over each turn (e.g. inspecting tool calls before they fire).
- You're embedding agent capabilities in a non-Anthropic product.

When the CLI is enough, use the CLI — fewer moving parts.

## Pi (`@earendil-works/pi-coding-agent`)

Pi is an opinionated minimal coding agent by Mario Zechner. Smaller surface than Claude Code and fast to iterate on. Upstream, an extension is a TypeScript module; in this repo, extensions are organized as directory-based packages. Use the upstream Pi docs plus this repo's `AGENTS.md` for day-to-day extension conventions; this section captures harness-engineering-specific patterns.

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

From this repo's `CLAUDE.md` and the broader ecosystem:

- **Extensions run with full system permissions.** `extensions.md` explicitly warns. Only install trusted code, and enforce risky actions in tools rather than relying on prompt instructions.
- **`mock.method` from `node:test` can't replace ESM module exports** — they're non-configurable bindings. To stub something like `child_process.spawn`, wrap in an exported holder (`export const _spawn = { fn: _nodeSpawn }`) and call through `_spawn.fn(...)`. Tests then `mock.method(_spawn, "fn", stub)`. Reference pattern in this repo: `pi/agent/extensions/subagents/spawn.ts`.
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

### Tool and operations contracts

Platform choice does not remove the need for explicit tool contracts. For tools with side effects, document idempotency, retry safety, timeout/cancellation behavior, and whether the action is local, destructive, networked, or externally visible. For long-running workflows, persist phase state outside the conversation so sessions can be explained, resumed, or rolled back. See `operations-safety.md` for a checklist.

## Picking a platform

A short decision guide:

| Need                                                             | Reach for                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| Day-to-day interactive coding with the option to extend behavior | Claude Code with custom skills, hooks, and `.claude/agents/` |
| Same loop but driven from your own code                          | Claude Agent SDK                                             |
| A custom multi-phase pipeline you'll iterate on rapidly          | Pi extension (faster turnaround, smaller surface)            |
| Integration into a non-Anthropic product (IDE, web app, CI)      | Claude Agent SDK                                             |
| Cron / API / GitHub-triggered runs                               | Claude Code routines                                         |
| Distributing a harness pattern to a team                         | Claude Code plugin                                           |

## High-quality community write-ups

If you want field experience beyond the official docs:

- [dev.to — Claude Code: Hooks, Subagents, and Skills (Complete Guide)](https://dev.to/owen_fox/claude-code-hooks-subagents-and-skills-complete-guide-hjm) — end-to-end harness-author tour.
- [DoltHub — Claude Code Gotchas](https://www.dolthub.com/blog/2025-06-30-claude-code-gotchas/) — frank field notes from a team that ran Claude Code in production.
- [Builder.io — 50 Claude Code Tips](https://www.builder.io/blog/claude-code-tips-best-practices) — cited compendium.
- [UX Planet — 7 Rules for Creating an Effective Claude Code Skill](https://uxplanet.org/7-rules-for-creating-an-effective-claude-code-skill-2d81f61fc7cd) — trigger-design rules.
- [Mellanon gist — Skills structure and activation](https://gist.github.com/mellanon/50816550ecb5f3b239aa77eef7b8ed8d) — practical activation-pattern reference.
- [Builder.io — Claude Code Routines Tutorial](https://www.builder.io/blog/claude-code-routines) — worked schedule/API/GitHub-trigger walkthrough.
- [WaveSpeedAI — Claude Code Agent Harness: Architecture Breakdown](https://wavespeed.ai/blog/posts/claude-code-agent-harness-architecture/) — reverse-engineered five-stage compaction (budget reduction → snip → microcompact → context collapse → auto-compact).
- [Jonathan Fulton — Inside the Agent Harness: How Codex and Claude Code Actually Work](https://medium.com/jonathans-musings/inside-the-agent-harness-how-codex-and-claude-code-actually-work-63593e26c176) — side-by-side harness comparison.
- [dabit3 gist — How to Build a Custom Agent Framework with PI](https://gist.github.com/dabit3/e97dbfe71298b1df4d36542aceb5f158) — one of the few outside write-ups on Pi as a stack.
- [awesome-pi-agent](https://github.com/qualisero/awesome-pi-agent) — curated index of Pi extensions/hooks/skills.
