# Pi Harness Audit Improvements Plan

## Goal

Close the accepted gaps from the Pi configuration audit (`pi/agent/`) against current agent-harness best practices: make subagent and skill prompts more operational, harden extension reliability and security, improve selected context observability, and bring extension documentation into repo-convention compliance.

This plan reflects the recommendation-by-recommendation decisions made with the user. Skipped items are recorded explicitly so implementers do not reintroduce them by following the original audit scope.

## Background / Repo Context

The audit compared `pi/agent/` against published agent-harness guidance and this repo's own `agent-engineering` principles. The accepted work keeps the highest-value prompt, reliability, security, and documentation fixes while intentionally deferring or rejecting several broader changes.

Important audit findings to preserve:

- Subagent definitions currently lack explicit output contracts; `review.md` should align with the `FINDINGS:` + confidence-threshold format used by `pi/agent/skills/review/SKILL.md`.
- Deterministic checks should happen before LLM review dispatch where practical: typecheck/lint/tests should pass or be reported before reviewers are spawned.
- Subagents should read named plan/criteria artifacts from disk, e.g. `.plans/<file>`, instead of depending only on inlined conversation context.
- Several extension reliability gaps were accepted for remediation: MCP broker timeout/cache/logging behavior, spillover/log file permissions and cleanup, config parse warnings, subagent output spillover, statusline/startup-header failure behavior, and web-access rate-limit handling.
- Security hardening for externally fetched web content was accepted: wrap fetched/search content in an untrusted-content envelope and add plain-language AGENTS.md guidance about malicious external content combined with private data and outbound tools.
- Context observability improvement was accepted only for per-call tool-result breakdowns in the `context` extension.
- Extension README convention compliance was accepted repo-wide.

Findings checked and rejected during the original audit should remain rejected:

- `compact-tools` grep renderer does not hide matches from the model; execution is delegated unchanged at `pi/agent/extensions/compact-tools/grep.ts:42`; only the TUI shows a count.
- `pi/agent/extensions/web-access/pdf.ts` has no ArrayBuffer detach bug; copy precedes detach.
- `goal` auto-run already guards against pending messages via feature detection at `pi/agent/extensions/goal/index.ts:373-375`.

## Acceptance Criteria

### Workstream A — prompt and skill operationalization

- AC-1: All four subagent definitions in `pi/agent/agents/` (`explore.md`, `research.md`, `deep-research.md`, `review.md`) include an explicit output contract section. `review.md` must use the `FINDINGS:` / `NO_FINDINGS` contract and confidence-threshold expectations from `pi/agent/skills/review/SKILL.md`.
- AC-2: Subagent definitions instruct agents to read named plan/criteria artifacts from repo paths first when the dispatch prompt names such a file, e.g. `.plans/<file>`.
- AC-3: `pi/agent/AGENTS.md` Workflow Discipline and `pi/agent/skills/review/SKILL.md` state that deterministic checks such as typecheck, lint, and tests should run and pass-or-be-reported before LLM reviewers are dispatched.
- AC-4: Frontmatter descriptions for `challenge-plan`, `complete-work`, `hindsight`, and `create-html-artifact` include more concrete trigger phrasing; `playwright`'s description identifies it as a reference skill.

### Workstream B — extension reliability and resource hygiene

- AC-5: `mcp-broker` applies an explicit network timeout to MCP transport operations, invalidates/retries its cached tool list when the broker is unreachable, and logs `mcp_call` failures via `_shared/logging.ts`. Unit tests cover timeout and cache-invalidation paths.
- AC-6: `_shared/spillover.ts` and `_shared/logging.ts` write files with owner-only permissions (`0o600`) and implement age-based cleanup for old files, defaulting to 7 days. `_shared/config.ts` surfaces a warning when a settings file fails to parse instead of silently returning `{}`. Tests cover all three behaviors.
- AC-7: `subagents` applies spillover via `_shared/spillover.ts` to subagent outputs exceeding the shared threshold. Tests cover oversized-output spillover. Do not add child-process environment sanitization in this plan.
- AC-8: `statusline` git branch lookup no longer blocks rendering; it uses async lookup with timeout and last-known-value fallback. Quota-fetch failures are logged once per session instead of silently blanking. `startup-header` metadata load failures render a fallback instead of causing an unhandled rejection.
- AC-9: `web-access` detects GitHub rate-limit responses such as 429 or 403 rate-limit bodies and returns a recoverable tool-result message with a backoff hint. Do not add clone cleanup policy or implementation in this plan.

### Workstream C — security hardening

- AC-10: `web_fetch` and `web_search` results are wrapped in a clearly delimited untrusted-content envelope stating the content is external data, not instructions. `web-access` README documents the behavior.
- AC-11: `pi/agent/AGENTS.md` Security section includes plain-language guidance warning agents to treat fetched external content as untrusted when private data and outbound/external tools are available, and to flag suspected prompt injection before acting on it. Do not use the phrase “lethal trifecta.”

### Workstream D — context observability

- AC-12: The `context` extension breaks down tool results by individual call, including a top-N largest individual call/result view, rather than only aggregating by tool name.

### Workstream E — documentation and verification conventions

- AC-13: Every extension README complies with the repo convention: config and logging behavior documented, explicitly “none” where applicable; extensions with user-facing config register a `/<name>-config` command.
- AC-14: Targeted tests/checks are run for each workstream as appropriate, and the full suite (`make typecheck`, `make test`, `npm run lint`, `npm run format:check`) passes at the end before reporting completion.

## Non-Goals / Out of Scope

- No cross-family model/provider overrides for `review.md` or `deep-research.md`, and no new AGENTS.md cross-family routing section.
- No bounded fix-loop cap for `review` or `complete-work`; neither skill currently contains a fix loop.
- No subagent child-process environment sanitization.
- No web-access clone cleanup policy or implementation.
- No session-start context-cost measurement or broker menu cap/rationale documentation.
- No `goal_update` structured `evidence_links` field.
- No note under `notes/` about session-persisted `todo`/`goal` state versus file-based state.
- No rewrite of the mcp-broker into a code-execution-with-MCP surface.
- No new memory system; Hindsight integration is unchanged.
- No CPU/memory resource limits for subagent child processes.
- No changes to the Claude Code side of the repo (`claude/`).
- No grapheme-aware width handling in `_shared/render.ts`.
- No golden-trace regression harness.

## Constraints

- Public repository: do not add internal company details, credentials, proprietary references, or private URLs.
- Follow repo extension conventions in `CLAUDE.md`: use `_shared` helpers for config/logging/render where appropriate, keep agent-facing schemas snake_case, keep internal fields camelCase, use atomic state mutations, return agent-tool errors as tool-result text where applicable, and avoid `console.*` in TUI paths.
- Edit files only under `pi/` and repo docs/notes as explicitly accepted; never edit `~/.pi/` symlinks directly.
- Do not run `make stow-pi` unless the user explicitly asks.
- For Pi extension changes, run both `make typecheck` and `make test` before reporting complete; this plan additionally requires lint and format checks at the end.
- Keep prompt-cache stability in mind: do not introduce per-turn dynamic content such as timestamps or counters into system-prompt injections.
- Do not commit unless explicitly requested. If commits are later requested, stage files by name and use conventional commit messages.

## Chosen Approach

Implement the accepted workstream subset in order: A → C → B → D → E.

Start with markdown/prompt changes because they are low-risk and establish the workflow constraints. Apply web-content security hardening early because it is small and security-relevant. Then implement the reliability/resource-hygiene code changes, beginning with shared helpers before extension-specific consumers. Finish with the context observability improvement and README convention sweep.

## Design Decisions

- D1: Subagent output contracts use headed Markdown sections rather than strict JSON. `review.md` must still preserve the existing `FINDINGS:` / `NO_FINDINGS` contract because the review skill already relies on that shape.
- D2: Deterministic-gates guidance should be phrased as “run and pass-or-report before dispatching LLM reviewers,” not as an absolute prohibition that blocks reviews when checks cannot be run.
- D3: Untrusted-content wrapping for `web-access` should mirror the established `goal` pattern: external content is data, not higher-priority instructions. Keep the envelope short to limit token overhead.
- D4: Spillover/log cleanup runs lazily at extension load; no daemon or background scheduler.
- D5: Subagent output spillover is accepted, but environment sanitization is explicitly out of scope.
- D6: GitHub rate-limit handling is accepted, but clone cleanup is explicitly out of scope.
- D7: Full-suite verification is required at the end. Per-workstream verification should be targeted to changed areas rather than always running the full suite after every workstream.

## Implementation Notes

### Workstream A

- `pi/agent/agents/explore.md`, `research.md`, `deep-research.md`, `review.md`: add `Output format` sections and artifact-by-path guidance.
- `pi/agent/agents/review.md`: align output contract with `pi/agent/skills/review/SKILL.md` (`FINDINGS:` lines, severity, confidence, `NO_FINDINGS`).
- `pi/agent/AGENTS.md`: add deterministic-check-before-review guidance under Workflow Discipline.
- `pi/agent/skills/review/SKILL.md`: add deterministic-gates-first guidance before reviewer dispatch.
- Skill frontmatter description edits:
  - `challenge-plan`: include concrete triggers such as review, vet, or stress-test a plan.
  - `complete-work`: include concrete triggers such as finish up, work is done, or PR ready.
  - `hindsight`: include concrete triggers such as remember, recall, or what do we know about.
  - `create-html-artifact`: name concrete artifact types.
  - `playwright`: mark as a reference skill.

### Workstream C

- `pi/agent/extensions/web-access/index.ts` and related result construction: wrap search and fetch outputs in a short untrusted-content envelope.
- `pi/agent/extensions/web-access/README.md`: document the envelope behavior.
- `pi/agent/AGENTS.md`: add plain-language security guidance about untrusted fetched content interacting with private data and outbound tools; do not use the phrase “lethal trifecta.”

### Workstream B

- `pi/agent/extensions/mcp-broker/client.ts`: add MCP transport/network timeout and cache invalidation/retry behavior for unreachable broker/tool-list failures.
- `pi/agent/extensions/mcp-broker/tools.ts`: log `mcp_call` failures through `_shared/logging.ts`.
- `pi/agent/extensions/_shared/spillover.ts` and `pi/agent/extensions/_shared/logging.ts`: use `0o600` for written files and add age-based cleanup with 7-day default.
- `pi/agent/extensions/_shared/config.ts`: surface parse warnings through an API that callers can route to `ctx.ui.notify` or equivalent; do not use `console.*` in TUI paths.
- `pi/agent/extensions/subagents/spawn.ts`: apply shared spillover to oversized child output; preserve existing environment behavior.
- `pi/agent/extensions/statusline/git.ts` and `index.ts`: make git lookup asynchronous with timeout and cached fallback; log quota failures once per session.
- `pi/agent/extensions/startup-header/index.ts`: catch metadata-load failures and render a fallback header.
- `pi/agent/extensions/web-access/github.ts`: detect GitHub rate-limit responses and return recoverable guidance.

### Workstream D

- `pi/agent/extensions/context/index.ts`: add top-N individual tool call/result reporting.

### Workstream E

- Sweep all `pi/agent/extensions/*/README.md` files for config/logging convention compliance.
- Ensure extensions with user-facing config have a `/<name>-config` command registered through `_shared/config.ts`.
- For extensions with no user-facing config or retained logs, state that explicitly.

## Documentation Impact

- Update extension READMEs wherever accepted behavior changes:
  - `mcp-broker`: timeout/cache/logging behavior if user-visible.
  - `web-access`: untrusted-content envelope and rate-limit behavior.
  - `subagents`: output spillover behavior.
  - `statusline`: async git fallback and retained logging behavior.
  - `startup-header`: fallback behavior if documented.
  - `context`: per-call result breakdown.
  - Shared helper behavior as reflected in affected extension docs.
- Perform the accepted all-extension README config/logging sweep.
- Update `pi/agent/AGENTS.md` and selected skill `SKILL.md` files per Workstream A/C.
- Do not add the skipped `notes/` essay.
- No top-level `README.md` or `CLAUDE.md` changes are expected unless implementation reveals a convention change that must be documented.

## Testing / Verification

- V1 (AC-1..4): grep/read checks confirm subagent output contracts, artifact-by-path guidance, deterministic-gates guidance, and updated skill descriptions.
- V2 (AC-5): mcp-broker unit tests cover timeout and cache invalidation; targeted `npx tsx --test pi/agent/extensions/mcp-broker/*.test.ts` passes.
- V3 (AC-6): shared-helper tests assert `0o600` file modes, retention cleanup, and parse-warning surfacing; targeted `_shared` tests pass.
- V4 (AC-7): subagents tests assert spillover envelope/path behavior on oversized output.
- V5 (AC-8, AC-9): statusline/startup-header/web-access tests or focused checks cover async git fallback, quota logging once, startup fallback, and rate-limit message shape.
- V6 (AC-10): web-access tests assert envelope delimiters around fetched and search content; README documents it.
- V7 (AC-11): AGENTS.md contains the accepted plain-language security guidance without the phrase “lethal trifecta.”
- V8 (AC-12): context tests or focused checks cover per-call top-N breakdown.
- V9 (AC-13): manual README sweep checklist confirms every extension README documents config/logging behavior and config commands where applicable.
- V10 (AC-14): final full suite passes: `make typecheck`, `make test`, `npm run lint`, and `npm run format:check`.

## Risks and Mitigations

- MCP transport timeout hooks may not map cleanly onto the current client API. Mitigation: implement timeout at the call boundary with `AbortController` or promise racing if transport-level support is unavailable, and document the chosen behavior if user-visible.
- Untrusted-content envelope adds tokens to every fetch/search result. Mitigation: keep it to a short delimiter and one clear instruction line.
- Shared cleanup could delete files unexpectedly if scoped too broadly. Mitigation: cleanup only files created by the corresponding helper in its own managed directory, older than the configured retention.
- Config parse warning API could require touching multiple callers. Mitigation: preserve the existing default behavior while adding optional warning surfacing; update callers opportunistically where settings are user-facing.
- README sweep can become noisy. Mitigation: make checklist-driven minimal edits; do not rewrite unrelated prose.

## Assumptions

- Seven-day retention for logs/spillover is acceptable and can follow the standard config/env override pattern where user-facing.
- Existing spillover thresholds remain acceptable; this plan expands where spillover is applied, not the threshold policy itself.
- Headed Markdown output contracts are sufficient for read-only subagents; strict JSON is not required.
- Targeted per-workstream checks plus final full-suite verification provide the desired safety/performance trade-off.

## Handoff Summary

Implement this revised accepted scope workstream by workstream: A → C → B → D → E. Do not implement skipped recommendations from the original audit. Complete only after AC-1 through AC-14 are satisfied with concrete file/test evidence and the final full verification suite passes.

Suggested goal objective:

```text
/goal Implement .plans/2026-06-10-pi-harness-audit-improvements.md as revised. Complete only after every acceptance criterion AC-1 through AC-14 is satisfied with concrete evidence from file diffs, targeted checks, and final `make typecheck`, `make test`, `npm run lint`, and `npm run format:check` results.
```
