# Pi Harness Architectural Review

An outside deep review of the Pi agent harness under `pi/agent/` — architecture, gaps, robustness, consistency, testing, docs, and how the design compares to the 2025–2026 state of the art. Investigation only; no code was changed. All 552 unit tests pass and `make typecheck` is clean at the reviewed commit.

## Executive summary

**The core architectural bets are correct, and the published evidence now proves it.** The meta-tool broker surface, read-mostly subagents as context firewalls, deterministic workflow-as-code orchestration, evidence-gated goal completion, and spill-to-disk output handling each independently match what Anthropic, OpenAI, and the research literature converged on in 2025–2026 — in several cases this repo shipped the pattern before the platform vendors productized it. This is not a config directory; it is a coherent, opinionated harness with an explicit philosophy (permissions outside the agent, deterministic code over LLM routing, evidence over vibes) that the code actually honors.

**The engineering discipline is the standout asset — and it has one missing feedback loop.** Fourteen of fourteen extensions carry a `DESIGN.md` with real invariants; 552 pure-logic tests cover locks, cron decisions, spawn plans, parsers, and renderers; the spawn-stub pattern makes process supervision testable. Published work on harness evaluation says almost nobody regression-tests personal scaffolding at all, so this repo is ahead of practice. But everything tested is _plumbing_. The load-bearing artifacts — skills, subagent briefs, injected prompt guidance, the goal completion rubric — have zero behavioral verification. The single highest-leverage addition is a small eval suite, not more unit tests.

**The weakest single component is `mcp_search`.** The broker design is validated (Anthropic measured 85% token reduction _and_ accuracy gains from deferred tool loading), but the literature is equally clear that retrieval is the bottleneck: keyword search over thousands of tools hits only ~56–64% recall in adversarial tests. `mcp_search` is a plain case-insensitive substring match, while the bash guard three files away already implements token-based relevance scoring. Unifying and upgrading this is cheap and directly attacks the documented failure mode.

**Durable state is thinner than the README language implies.** "Branch-scoped" goals are scoped to the Pi _session tree_ branch, not the git branch: start a fresh session on the same work and the goal is gone. Plan files under `.plans/` are the real durable artifact, and only `goal` deliberately survives compaction — `todo` does not. This is workable, but the naming oversells it and the compaction asymmetry is an unforced inconsistency.

**Scheduled-tasks is the most impressive and the heaviest subsystem.** It is a genuinely careful mini-scheduler — lease locks with stale recovery and PID adoption, an auditable run-lifecycle state machine, at-least-once semantics stated honestly. The costs worth discussing: roughly a third of all extension code serves it, every cron minute boots a full Pi process with _all_ extensions (including an MCP broker network prefetch), and detached runs fail silently unless someone asks the doctor.

## What this harness already does well

Calibration first, because most of this review's altitude comes from how high the floor is.

- **Doc discipline that survives contact with the code.** Every extension has README (usage contract) + DESIGN (change-safety contract), and spot-checking found _no material drift_ between DESIGN claims and implementation — the workflows DESIGN accurately describes its own sandbox as "a guardrail, not a complete JavaScript sandbox" (`workflows/DESIGN.md:31`), and scheduled-tasks DESIGN correctly documents at-least-once semantics, lock sequencing, and the dead-PID-adoption subtlety (`scheduled-tasks/DESIGN.md:199-213`).
- **Anti-fragile output handling.** The shared spillover helper (`_shared/spillover.ts`) writes oversized tool output to disk with a preview envelope, retrieval path, and explicit truncation byte count — exactly the convergent industry pattern, and it avoids the "silent truncation" anti-pattern that produced real bugs in other harnesses (GitHub Copilot CLI clipped MCP responses at 10KB before its offload could engage).
- **Evidence-gated completion.** `goal_update` accepts only `status="complete"` with bounded evidence, the injected prompt explicitly names proxy signals as insufficient (`goal/index.ts:110`), auto-run is budget-bounded with typed stop reasons, and `ask_user` is blocked during auto-run with a recovery instruction (`goal/index.ts:393-408`). This encodes "termination beats unbounded loops" better than most production harnesses.
- **Structured output as a hard phase boundary.** Subagent structured output fails the whole spawn if the tool wasn't called, errored, or failed validation — with stable error codes and diagnostics (`subagents/spawn.ts:392-451`). The Claude Agent SDK ships the same contract; this repo's version predates needing it.
- **Honest failure surfaces.** Errors return as tool text the model can read and recover from, failed subagents retain logs while successful ones delete them, broker errors are distinguished from transport errors, and recent commits show active hardening of RPC failure paths.
- **The skills are unusually good.** `plan`, `review`, and especially `agent-engineering` (a curated, cited literature synthesis with a bibliography and confidence flags) are of publishable quality. The subagent definitions correctly ratchet capability: read-only tools, `MCP_BROKER_READONLY=1`, approval-mode `reject`, skills disabled.

## The broker surface: validated bet, one weak link

The three-meta-tool design (`mcp_search` / `mcp_describe` / `mcp_call` plus a namespace menu injected at agent start, `mcp-broker/index.ts:59-93`) is a hand-rolled instance of what both Anthropic (Tool Search Tool) and OpenAI (deferred tool loading) later shipped natively. Anthropic's numbers justify it decisively: ~85% context reduction and _accuracy improvements_ (Opus 4: 49% → 74% on internal MCP evals) from keeping large tool catalogs out of context. The namespace menu is precisely OpenAI's recommended middle ground — names visible upfront, schemas on demand. The prompt-cache-stability rationale in `mcp-broker/DESIGN.md:14-16` is correct and rarely articulated this clearly.

Three findings:

1. **`mcp_search` is a substring filter** (`mcp-broker/tools.ts:279-289`). Third-party stress tests of Anthropic's tool search measured only 56% (regex) / 64% (BM25) retrieval accuracy at scale, and academic work (RAG-MCP, ToolRet) shows retrieval quality directly caps end-to-end task success. Meanwhile `guard.ts:105-127` already implements tokenized relevance scoring for the same catalog. **Improve (high value, low effort):** replace substring matching with token-overlap scoring (promote the guard's scorer to a shared module), rank results, and return top-N with scores. Full BM25 or embeddings are not needed at hundreds of tools; tokenization is.
2. **Read-only mode is client-side and annotation-trusting.** `isReadOnly` strictly requires `readOnlyHint === true` (`client.ts:27-29`) and `callBrokerTool` re-checks names against the filtered list on every call (`tools.ts:119-131`) — good defense-in-depth against stale/injected tool names. But MCP annotations are spec-designated _hints_; the guarantee only holds because the broker is a trusted first-party. That trust assumption is worth one sentence in the DESIGN so a future third-party broker doesn't silently inherit it. **Fix (docs only).**
3. **The generic `mcp_call` deliberately defeats per-tool client policy** — a client-side allowlist can't distinguish `github.get_file_contents` from `github.merge_pull_request` inside one tool's JSON payload. In mainstream harnesses this would be a hole; here it is the _point_ — enforcement lives at the credential-holding broker (per `notes/moving-permissions-out-of-the-harness.md`), which is where the industry's capability-broker literature is heading. This is a case where the repo is deliberately ahead of the mainstream. No action; keep stating the reliance explicitly.

**Consider:** Anthropic's "code execution with MCP" pattern (agents write code against tool APIs; 98.7% token reduction on chained calls, intermediate results never touch context) is the successor to meta-tools for multi-call pipelines. The workflows extension is structurally close to it already — a Phase 2+ option worth tracking rather than adopting now.

## Orchestration: the right Phase 1, and what Phase 2 should be

The subagents → structured-output → workflows stack is clean layering: workflows imports only `subagents/api.ts` (verified), policy lives in one wrapper (`runtime.ts:339-472`), the worker boundary is killable, and `parallel`/`parallelSettled`/`pipeline` take thunks so the runtime owns concurrency. The read-mostly agent allowlist matches both Cognition's "writes stay single-threaded" consensus and Anthropic's orchestrator-worker guidance. Prior art is honestly cited (`workflows/README.md:126-130`).

Findings, in priority order:

1. **The 10-minute whole-workflow timeout with no per-agent timeout is the practical ceiling** (`workflows/types.ts:16`). A fan-out including one `deep-research` agent (thinking: high, web access) can plausibly exceed 10 minutes; when it does, the _entire_ workflow and all sibling results die. Claude Code's equivalent runs in the background with per-agent controls. **Improve:** add a per-agent timeout (so one hung child fails one branch, not the run) and make the workflow timeout configurable via the standard `extension:workflows` settings pattern — the extension currently has no config surface at all.
2. **No result caching or resume.** Every workflow failure discards all completed subagent work. The state of the art (Claude Code workflows, LangGraph checkpointers) caches completed agent results and re-runs only the remainder. Because subagent results are already captured as text/structured values keyed by a deterministic request sequence, journaling them to the session (via `appendEntry`, the same pattern goal/todo use) would be cheap relative to its value. **Add (Phase 2 priority #1):** journal per-agent results; on re-run of an identical script, replay cached results.
3. **The worker sandbox is escapable, and that's fine — say so louder.** `new Function("return this")()` defeats the variable shadowing in `worker-source.ts:6-16`; the AST bans in `parser.ts` stop accidents, not adversaries. Given the scripts are model-authored, a prompt-injected model could reach `process.env` inside the worker. This is _consistent_ with the repo's own philosophy — the real boundary is the outer sandbox — but the README's "Safety restrictions" section (`workflows/README.md:92-101`) reads stronger than the mechanism. **Fix (docs):** one sentence stating the sandbox is anti-footgun, not anti-adversary, and that secret isolation relies on the environment sandbox.
4. **Dead validation code.** `parser.ts:118-120` rejects _all_ import declarations, making the `FORBIDDEN_MODULES` specifier check at `parser.ts:146-152` unreachable. Similarly, `subagents/utils.ts:62` contains a tautological condition (`rootLooksLikeFile || !rootLooksLikeFile`). Neither is a bug today; both will confuse the next maintainer into thinking module-level filtering exists. **Fix (trivial).**
5. **The hand-rolled JSON-schema validator** (`subagents/spawn.ts:281-380`) supports only `type/required/properties/items/enum/const/additionalProperties`. A workflow schema using `minItems` or `pattern` silently passes parent-side validation while the child enforces it — an asymmetry that is documented (`workflows/README.md:90`) but will eventually bite a fan-in. **Consider:** compiling the schema with the already-present typebox instead.

## Durable state: rename it or make it true

The session-entry persistence pattern shared by goal and todo is genuinely elegant: state mutations append typed entries, and restore replays `ctx.sessionManager.getBranch()` (`goal/index.ts:86-104`, `todo/index.ts:87-113`), so state follows session forks and tree navigation for free. Two gaps:

1. **"Branch-scoped" means session-tree branch, not git branch.** `README.md:31` ("branch-scoped goals") and `pi/README.md:31` invite the git reading; a goal does not survive starting a new session on the same git branch. Contrast the direction of travel elsewhere: Claude Code tasks persist in the home directory across sessions; beads keys durable work items to a merge-safe store. For a plan-file-driven workflow (`/goal Implement .plans/...`) the current design is arguably _right_ — the plan file is the durable artifact, the goal is the session's grip on it — but that argument should be made explicitly. **Fix (docs) or Consider (feature):** either rename/clarify to "session-scoped, fork-safe," or persist active goals to a repo-local file keyed by git branch and restore on session start.
2. **Compaction asymmetry.** Goal contributes a compaction summary preserving objective, status, and the completion rule (`goal/index.ts:474-485`); todo contributes nothing, so a compaction can silently drop the model's working task list even while the widget still shows it to the human. **Improve (small):** register the same `session_before_compact` hook in todo, mirroring goal.

**Memory** is deliberately externalized to Hindsight through the broker plus a detailed skill — a defensible choice that keeps the harness stateless. The gap is that all capture is model-initiated: nothing runs at session end to consolidate what was learned. The industry pattern (Claude Code auto-memory, Letta sleep-time compute) is converging on _offline_ consolidation. **Consider:** a small session-end or scheduled-task reflection pass that proposes Hindsight retentions — notably, `scheduled-tasks` is already the perfect substrate for it.

**Context feedback to the model is deliberately absent, and should stay that way.** `/context-usage` is user-invoked blame tooling; the statusline shows usage to the human, not the model. Given the documented "context anxiety" failure mode (models taking shortcuts when told they're near limits), this restraint is correct and now evidence-backed.

## Scheduled-tasks: excellent core, heavy shell

The scheduler core would pass review as production infrastructure: exclusive-create lock files with compare-before-delete release, stale recovery keyed to the _adopted runner's_ PID rather than the tick's (`scheduled-tasks/DESIGN.md:212`), claim-snapshot isolation so editing a task file can't alter claimed work, coalescing (not replaying) catchup semantics, and honest at-least-once documentation. The test file is 3,289 lines and earns them.

Three judgment-call findings:

1. **Every cron tick boots a full Pi with all extensions.** The managed crontab invokes `pi --mode json --no-session -p '/scheduled-tasks-tick'` (`cron.ts:16-28`) once per minute. That loads every extension — including mcp-broker's `session_start` prefetch, which makes a network call to the broker _every minute_ (`mcp-broker/index.ts:42-50`), plus web-access, subagents, and the rest. The claimed-runner supervisor (`scheduler.ts:599-658`) repeats this, so each scheduled run involves three Pi processes of which two need only this one extension. **Improve:** add `--no-extensions -e <scheduled-tasks-path>` to the tick and claimed-runner invocations. One-line change to the spawn plans; removes a per-minute network dependency and most of the boot cost.
2. **Detached runs fail silently.** A failed scheduled run writes durable artifacts, but nothing _tells_ anyone. The established pattern is a lifecycle hook firing a webhook (ntfy/Slack-style) on terminal failure. **Add:** an optional `notifyCommand` or webhook URL in task frontmatter/config, invoked best-effort on `failed`/`timeout`/`launch_failed`. This is the missing half of "recurring autonomous execution magnifies small unsafe defaults."
3. **Is the weight justified?** Roughly a third of the harness's TypeScript serves scheduled tasks. The steelman (in DESIGN) is strong — autonomy magnifies small unsafe defaults, and the alternative (bare crontab entries running `pi -p`) has no locking, no artifacts, no doctor. I land on: justified, _provided_ the run-frequency stays low and the notification gap closes; otherwise it's a beautifully-locked mailbox nobody checks.

## Consistency and maintainability

Small items, all clear wins:

- **Two typebox packages coexist.** `todo/tools.ts:3` and `scheduled-tasks/tools.ts:3` import from `typebox` (v1.x) while seven other files import `@sinclair/typebox` (v0.34) — two different major-version libraries for the same job (`package.json`). This works today and will produce a baffling type error someday. **Fix:** standardize on one.
- **The repo's own convention doc has drifted.** `CLAUDE.md:114` documents the atomic-mutation convention via "`task_list_set`'s `reconcile`" — a tool that doesn't exist anywhere in the repo (the todo tool has no reconcile). **Fix:** re-anchor the example to the real `todo` tool.
- **Duplicated formatters.** `goal/state.ts:479-494` reimplements `formatDuration` (with different rounding) and `formatTokenCount` despite `_shared/render.ts:126` and `subagents/render.ts:19-23` existing. **Improve:** promote one canonical pair to `_shared`.
- **`callBrokerTool`'s session-retry path duplicates ~70 lines** of the success path (`mcp-broker/tools.ts:173-248`). Extract a helper; the retry wrapper should be ~10 lines.
- **GitHub clone cache never cleans up or refreshes.** `web-access/github.ts` clones to `/tmp/pi-github-repos` with no retention pass (unlike the logging and spillover helpers, which both self-clean) and reuses any existing clone forever (`github.ts:270`). It also shells out to `gh api` for repo size (`github.ts:152-166`) in an environment whose own guard teaches that `gh` isn't authenticated — the graceful `null` fallback makes it benign, but a plain `fetch` to the public API would be consistent. **Fix:** add retention cleanup; **Improve:** replace `gh` with `fetch`.

## Testing: strong floor, missing ceiling

What exists is above published practice: 552 pure-logic tests, spawn stubbed via the exported-holder pattern (`subagents/spawn.ts:24-26`), lock/cron/lifecycle edge cases covered, render formatters tested. The two real blind spots:

1. **No behavioral evaluation of anything the model reads.** Skills, injected guidance (`subagents/index.ts:300-306`), the goal completion rubric, subagent briefs, and the review FINDINGS format contract are all unverified against a live model. Anthropic's skill-authoring guidance is explicit: build evals before skills (≥3 scenarios, baseline without the skill). The harness-evaluation literature's core 2026 finding — scaffold choices move benchmark scores as much as model choices — cuts both ways: if the scaffold matters that much, untested scaffold changes are untested model-behavior changes. **Add (top priority):** a small eval suite — even 5–10 golden scenarios run manually before skill/prompt changes (does `/review` produce parseable FINDINGS lines? does a subagent honor read-only? does goal auto-run stop at budget?). Perfection is not the bar; _any_ behavioral regression signal is.
2. **No end-to-end child-process test.** Everything that crosses the `pi` binary boundary (JSONL event shapes, `--fork` semantics, structured-output capture from real events) is mocked. One opt-in integration test gated on `PI_E2E=1` would catch Pi-version drift in event schemas — the single most likely external breakage vector, since the whole orchestration stack parses another program's JSONL.

## Prioritized recommendations

Clear wins, ranked by leverage-per-effort:

| #   | Type    | Recommendation                                                                                                      |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Add     | Behavioral eval suite (5–10 golden scenarios) for skills, subagent contracts, and goal auto-run semantics           |
| 2   | Improve | `mcp_search`: token-overlap ranking (reuse `guard.ts` scorer), ranked top-N results                                 |
| 3   | Improve | Scheduled tick/runner: `--no-extensions -e <scheduled-tasks>` to stop per-minute full boots and broker prefetch     |
| 4   | Add     | Failure notifications for detached scheduled runs (webhook/command on terminal failure)                             |
| 5   | Improve | Workflows: per-agent timeout + configurable workflow timeout via standard extension config                          |
| 6   | Fix     | Standardize on one typebox package                                                                                  |
| 7   | Improve | Todo compaction summary hook, mirroring goal                                                                        |
| 8   | Fix     | `web-access` clone cache retention/refresh; replace `gh api` size check with `fetch`                                |
| 9   | Fix     | Doc drift: `CLAUDE.md` `task_list_set` example; "branch-scoped" → "session-scoped, fork-safe"; sandbox honesty note |
| 10  | Fix     | Dead code: unreachable `FORBIDDEN_MODULES` check, tautology in `subagents/utils.ts:62`; dedupe formatters           |

Judgment calls, worth discussing rather than doing:

- **Workflow resume/journaling** (cache per-agent results in session entries) — the highest-value Phase 2 feature, and cheaper than the DESIGN's non-goals list implies because structured results already exist. I'd pull it forward.
- **Git-branch-durable goals** — only if fresh-session-same-branch is a real workflow; otherwise the plan-file-is-the-artifact position is defensible and should just be written down.
- **Automated memory consolidation** via a scheduled reflection task — high ceiling, but manual retain keeps memory auditable, which fits the repo's ethos.
- **Code-execution-over-MCP** as the broker's successor surface for chained calls — track, don't build.

## The steelman

Most of the above assumes the harness should converge toward what platform vendors ship. The opposite view deserves stating: this harness's value is precisely that it is _smaller_ than Claude Code — Pi's own thesis is that frontier models need less scaffolding, not more, and stripped harnesses now beat heavy ones on Terminal-Bench. Under that lens, resisting workflow persistence, background execution, auto-memory, and richer state is not lag; it is the point. Every feature above adds surface the model must understand and the maintainer must keep true. The Phase 1/Phase 2 boundaries in the DESIGN docs show this restraint is deliberate, and the review's "Add" items should clear a high bar: the eval suite and scheduled-run notifications clear it because they protect the existing investment; the rest are legitimately optional.

Two caveats on this review's own confidence: the behavioral claims about skills steering the model are untested here for the same reason they're untested in the repo — no eval harness existed to run; and the state-of-the-art comparisons rest partly on vendor self-reports (Anthropic's tool-search accuracy numbers, token-reduction figures) that have not been independently reproduced.

## References

- [Anthropic — Advanced tool use / Tool Search Tool](https://www.anthropic.com/engineering/advanced-tool-use) — deferred tool loading: ~85% token reduction, accuracy gains on MCP evals (Opus 4: 49% → 74%).
- [Arcade.dev — Testing Anthropic tool search against 4,027 tools](https://arcade.dev/blog/anthropic-tool-search-4000-tools-test) — 56–64% retrieval accuracy; retrieval as the bottleneck.
- [Anthropic — Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) — the successor pattern to meta-tools for chained calls (98.7% token reduction).
- [RAG-MCP (arXiv 2505.03275)](https://arxiv.org/abs/2505.03275) and [ToolRet (arXiv 2503.01763)](https://arxiv.org/abs/2503.01763) — semantic retrieval over tool catalogs; tool retrieval is hard and caps downstream success.
- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — compaction, structured note-taking, subagent isolation.
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) — orchestrator-worker evidence: 90.2% gain, ~15× tokens, checkpoint resume.
- [Cognition — Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) and [Multi-Agents: What's Actually Working](https://cognition.com/blog/multi-agents-working) — read-parallel/write-serial consensus.
- [Claude Code — sub-agents](https://code.claude.com/docs/en/sub-agents) and [workflows](https://code.claude.com/docs/en/workflows) — resumable subagents, per-agent result caching, workflow-as-code reference point.
- [Claude Agent SDK — structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs) — schema-forced final results with typed retry errors.
- [Anthropic — Agent skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — evaluation-driven skill development.
- [Stop Comparing LLM Agents Without Disclosing the Harness (arXiv 2605.23950)](https://arxiv.org/pdf/2605.23950) — harness variations move scores as much as model differences.
- [Why Do Multi-Agent LLM Systems Fail? (MAST, arXiv 2503.13657)](https://arxiv.org/abs/2503.13657) — most multi-agent failures are system-design failures.
- [Inkeep — Context anxiety](https://inkeep.com/blog/context-anxiety) — why the harness is right not to inject usage pressure into model context.
- [Mario Zechner — Pi coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) and [cross-harness compaction research](https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f) — the platform's minimal-harness philosophy and compaction design.
- [Amp — Handoff, not compaction](https://ampcode.com/news/handoff) — the strongest counter-position to auto-compaction.
- [Steve Yegge — Beads](https://github.com/steveyegge/beads) — durable, merge-safe agent work-item state; contrast for session-scoped goals.
- [Simon Willison — The lethal trifecta](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/) — the threat model behind the broker architecture.
- [moving-permissions-out-of-the-harness](./moving-permissions-out-of-the-harness.md), [the-case-for-subagents](./the-case-for-subagents.md), [plan-execute-review](./plan-execute-review.md) — this repo's own design notes, which this review largely confirms against external evidence.
