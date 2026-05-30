# Bibliography

Annotated source index. Use this to find primary sources for any claim made in the rest of the skill, or to dig deeper on a topic.

Sections:

1. [Lab publications and primary write-ups](#1-lab-publications-and-primary-write-ups)
2. [Model-specific guides](#2-model-specific-guides)
3. [Platform docs (Claude Code, Agent SDK, Pi)](#3-platform-docs)
4. [Pi extension repos](#4-pi-extension-repos)
5. [Research papers](#5-research-papers)
6. [SWE-bench and benchmarks](#6-swe-bench-and-benchmarks)
7. [Production case studies](#7-production-case-studies)
8. [Engineering blog posts and write-ups](#8-engineering-blog-posts-and-write-ups)
9. [Evidence labels and maintenance](#9-evidence-labels-and-maintenance)
10. [Curated lists](#10-curated-lists)

Citations marked with **[caveat]** have a known limitation flagged inline. Treat with appropriate skepticism.

---

## 1. Lab publications and primary write-ups

These are the load-bearing references. Read them directly when you need to ground a design decision.

- [Anthropic — Effective Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) — Names the three load-bearing techniques: compaction, structured note-taking, just-in-time retrieval. Subagents in Claude Code are deliberately constrained to _answering questions, not writing code_.
- [Anthropic — Building Effective AI Agents](https://www.anthropic.com/research/building-effective-agents) — The Schluntz/Zhang piece. Pattern catalog: orchestrator-workers, evaluator-optimizer, parallelization, etc.
- [Anthropic — Building Effective AI Agents: Architecture Patterns and Implementation Frameworks (PDF)](https://resources.anthropic.com/hubfs/Building%20Effective%20AI%20Agents-%20Architecture%20Patterns%20and%20Implementation%20Frameworks.pdf) — Long-form companion to the above.
- [Anthropic — 2026 Agentic Coding Trends Report (PDF)](https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf) — Industry survey on agentic coding adoption and patterns.
- [Anthropic — Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) — Tool Search Tool, Programmatic Tool Calling, Tool Use Examples.
- [Anthropic — Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) — Progressive disclosure model for skills; description quality drives invocation.
- [Anthropic — April 23 postmortem on Claude Code quality reports](https://www.anthropic.com/engineering/april-23-postmortem) — Recent engineering writeup; useful for understanding what failure modes Anthropic itself instruments.
- [Cognition — Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents) — The 2025 piece that became consensus. Single most-cited source on why code-orchestrator beats multi-agent debate.
- [Cognition — Devin 2.0 Architecture](https://cognition.ai/blog/devin-2) — Interactive Planning, Devin Wiki, the specific changes that doubled PR merge rate (34% → 67%).
- [Cognition — Devin Annual Performance Review 2025](https://cognition.ai/blog/devin-annual-performance-review-2025) — "Performs worse when you keep telling it more after it starts." Foundational for "spec is immutable once implementation begins."
- [Pragmatic Engineer — How Claude Code Is Built](https://newsletter.pragmaticengineer.com/p/how-claude-code-is-built) — Retrospective citing ~98.4% of Claude Code as deterministic infra. Reference for "code orchestrator, not LLM orchestrator."
- [OpenAI — Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/) — Three engineers, five months, ~1M LOC, 1,500 merged PRs with zero hand-written code. Coined "harness engineering" as a discipline.
- [OpenAI — Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) — Canonical OpenAI write-up on the Codex loop. **[caveat: 403'd during research; pull manually]**
- [Mario Zechner — What I Learned Building an Opinionated and Minimal Coding Agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) — Pi's design philosophy.
- [Armin Ronacher — Pi: The Minimal Agent](https://lucumr.pocoo.org/2026/1/31/pi/) — External perspective on Pi.
- [Armin Ronacher — What is Plan Mode?](https://lucumr.pocoo.org/2025/12/17/what-is-plan-mode/) — On the planning-as-a-phase pattern.
- [Geoffrey Huntley — Ralph](https://ghuntley.com/ralph/) — The original "Ralph Wiggum" iterative refinement pattern.
- [Nader Dabit — How to Build a Custom Agent Framework with PI](https://nader.substack.com/p/how-to-build-a-custom-agent-framework) — Practitioner walkthrough.
- [Zvi — Claude Code, Codex, and Agentic Coding 7: Auto Mode](https://thezvi.wordpress.com/2026/04/15/claude-code-codex-and-agentic-coding-7-auto-mode/) — Recent commentary.

## 2. Model-specific guides

- [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview) — Authoritative model spec sheet.
- [What's new in Claude Opus 4.8](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-8) — Current Opus guidance: `high` default effort, adaptive-thinking-only thinking mode, fast mode, lower prompt-cache minimum, refusal stop details.
- [Introducing Claude Opus 4.8](https://www.anthropic.com/news/claude-opus-4-8) — Release post.
- [What's new in Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7) — Still useful for migration caveats inherited by 4.8: no sampling params, no explicit thinking budgets, tokenizer changes.
- [Best practices for using Claude Opus 4.7 with Claude Code](https://claude.com/blog/best-practices-for-using-claude-opus-4-7-with-claude-code) — Remove "double-check" scaffolding; don't overuse `max` effort.
- [Building with extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) — Interleaved thinking automatic on 4.6/4.7/4.8; tool-use constraints; pin thinking config.
- [Anthropic system cards index](https://www.anthropic.com/system-cards) — Safety system-card index; re-check current Opus/Sonnet/Haiku cards before making deployment claims.
- [GPT-5 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide)
- [GPT-5.1 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5-1_prompting_guide)
- [GPT-5.2 Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5-2_prompting_guide) — `<planning>` block (compaction-discardable); strict JSON schemas; tighter scope discipline.
- [GPT-5.4 Prompt Guidance](https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5.4) — "Bias to action" default; per-plan-item closure.
- [GPT-5.5 Prompt Guidance](https://developers.openai.com/api/docs/guides/prompt-guidance?model=gpt-5.5) — **The highest-signal page in the GPT-5 family.** Migration directives: rebaseline, move tool guidance to descriptions, replace prose procedure with outcome+criteria, drop schemas from prose, use Responses API.
- [GPT-5.5 model page](https://developers.openai.com/api/docs/models/gpt-5.5) — 1.05M context, default `reasoning_effort=medium`.
- [GPT-5.5 system card](https://openai.com/index/gpt-5-5-system-card/) — Persistence delta; harness-relevant signal that 5.5 keeps going where 5.4 gave up.
- [Introducing GPT-5.5](https://openai.com/index/introducing-gpt-5-5/) — Release post. New default Codex model.
- [atLabs — GPT-5.2 Prompting Guide: The 2026 Playbook](https://www.atlabs.ai/blog/gpt-5.2-prompting-guide-the-2026-playbook-for-developers-agents) — Practitioner adaptation.

## 3. Platform docs

### Claude Code

- [Hooks reference](https://docs.claude.com/en/docs/claude-code/hooks) — Lifecycle event catalog; exit-code semantics; matcher patterns.
- [Hooks getting-started guide](https://docs.claude.com/en/docs/claude-code/hooks-guide) — Worked examples.
- [Skills](https://docs.claude.com/en/docs/claude-code/skills) — Discovery vs. invocation; SKILL.md frontmatter; supporting files.
- [Skill authoring best practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices) — One-skill-one-job; trigger-condition guidance.
- [Slash commands](https://docs.claude.com/en/docs/claude-code/slash-commands) — Legacy `.claude/commands/` vs plugin commands.
- [Sub-agents](https://docs.claude.com/en/docs/claude-code/sub-agents) — `.claude/agents/`; isolation modes.
- [MCP](https://docs.claude.com/en/docs/claude-code/mcp) — Three scopes; elicitation flow.
- [Settings](https://docs.claude.com/en/docs/claude-code/settings) — Permission rule format; evaluation order; hierarchy.
- [IDE integrations](https://docs.claude.com/en/docs/claude-code/ide-integrations) — VS Code, JetBrains.
- [Claude Code on the web](https://docs.claude.com/en/docs/claude-code/claude-code-on-the-web) — Cloud sessions.
- [Routines](https://code.claude.com/docs/en/routines) — Cron / API / GitHub triggers.
- [Plugins reference](https://docs.claude.com/en/docs/claude-code/plugins-reference) and [Plugin marketplaces](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces).
- [Best practices](https://code.claude.com/docs/en/best-practices) — Anthropic's official harness advice.

### Claude Agent SDK

- [Agent SDK overview](https://docs.claude.com/en/docs/agent-sdk/overview) — Renamed from Claude Code SDK.
- [Building agents with the Claude Agent SDK](https://claude.com/blog/building-agents-with-the-claude-agent-sdk) — gather→act→verify→repeat.
- [Agent loop](https://platform.claude.com/docs/en/agent-sdk/agent-loop)
- [TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript) and [V2 preview](https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview)
- [Python reference](https://platform.claude.com/docs/en/agent-sdk/python)
- [Subagents in the SDK](https://docs.claude.com/en/docs/agent-sdk/subagents)
- [Custom tools](https://docs.claude.com/en/api/agent-sdk/custom-tools)
- [MCP in the SDK](https://docs.claude.com/en/docs/agent-sdk/mcp)
- [Permissions handling](https://docs.claude.com/en/docs/agent-sdk/permissions)
- [Slash commands in the SDK](https://docs.claude.com/en/docs/claude-code/sdk/sdk-slash-commands)
- [Plugins in the SDK](https://docs.claude.com/en/docs/agent-sdk/plugins)
- [Migration guide (Claude Code SDK → Claude Agent SDK)](https://docs.claude.com/en/docs/claude-code/sdk/migration-guide)
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — 5-min ephemeral TTL.
- [Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching)
- [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
- [claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [claude-agent-sdk-python releases](https://github.com/anthropics/claude-agent-sdk-python/releases)
- [claude-cookbooks](https://github.com/anthropics/claude-cookbooks) — `patterns/agents/` has reference impls.
- [anthropic-quickstarts](https://github.com/anthropics/anthropic-quickstarts) — Customer-support-agent, computer-use-demo.
- [claude-quickstarts](https://github.com/anthropics/claude-quickstarts)
- [claude-code repo (issue tracker)](https://github.com/anthropics/claude-code) — See issues #50850, #39886, #31819, #2814 for harness gotchas.
- [Anthropic blog — Subagents in Claude Code](https://claude.com/blog/subagents-in-claude-code)
- [Anthropic blog — Introducing routines](https://claude.com/blog/introducing-routines-in-claude-code)
- [Anthropic blog — Customize Claude Code with plugins](https://www.anthropic.com/news/claude-code-plugins)
- [Apple Xcode + Claude Agent SDK](https://www.anthropic.com/news/apple-xcode-claude-agent-sdk)

### OpenAI Codex CLI

- [Codex changelog](https://developers.openai.com/codex/changelog)
- [Codex releases on GitHub](https://github.com/openai/codex/releases)
- [Codex CLI features](https://developers.openai.com/codex/cli/features)
- [Codex subagents](https://developers.openai.com/codex/subagents)
- [AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md) — Override convention; `project_doc_max_bytes`.
- [Codex Prompting Guide (cookbook)](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)
- [Skills + Shell + Compaction tips for long-running agents](https://developers.openai.com/blog/skills-shell-tips) — Best published source on long-running-agent harness discipline.
- [Compaction guide — Responses API](https://developers.openai.com/api/docs/guides/compaction)
- [Compact a response — API reference](https://developers.openai.com/api/reference/resources/responses/methods/compact)
- [TechCrunch: OpenAI releases GPT-5.5](https://techcrunch.com/2026/04/23/openai-chatgpt-gpt-5-5-ai-model-superapp/)
- [NVIDIA blog — OpenAI's GPT-5.5 Powers Codex on NVIDIA Infrastructure](https://blogs.nvidia.com/blog/openai-codex-gpt-5-5-ai-agents/)

### Pi-mono

- [Extensions API (extensions.md)](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) — Authoritative API surface.
- [SDK (sdk.md)](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
- [RPC (rpc.md)](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md)
- [Coding-agent README](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md)
- [Examples](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions)
- [CHANGELOG](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md) — Track API breaks.
- [@earendil-works/pi-coding-agent (npm)](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)

## 4. Pi extension repos

A high-leverage set of harness-pattern repos from the survey for this skill.

- [tmustier/pi-extensions/ralph-wiggum](https://github.com/tmustier/pi-extensions/tree/main/ralph-wiggum) — Single-stage in-session loop with optional reflection checkpoints. `before_agent_start` re-injecting loop instructions to survive compaction.
- [klaudworks/ralph-meets-rex](https://github.com/klaudworks/ralph-meets-rex) — YAML-defined sequential steps, code orchestrator, conditional looping. Tag-based output protocol. "Planner can reject upfront" gate.
- [ruizrica/agent-pi](https://github.com/ruizrica/agent-pi) — Sequential `agent-chain` + 5-phase hybrid `pipeline-team`. Per-agent model assignment.
- [davidorex/pi-project-workflows](https://github.com/davidorex/pi-project-workflows) — Typed DAG with 9 step types. Per-criterion verdicts; auto-resume from checkpoint by spec-hash.
- [tmdgusya/roach-pi](https://github.com/tmdgusya/roach-pi) — **Single richest source.** Phase-gated state machine + label-driven worker. Validator information barrier. 2-seed reviewer fan-out. 3-stage review. Compaction preserving phase state.
- [tintinweb/pi-supervisor](https://github.com/tintinweb/pi-supervisor) — External in-memory LLM observer. `continue | steer | done` JSON action. "5-strike lenient mode" stagnation safeguard. Reference for verify-loop nitpick mitigation.
- [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents)
- [nicobailon/pi-boomerang](https://github.com/nicobailon/pi-boomerang) — Cleanest "amnesiac sub-tasks" implementation. `--rethrow N` for Ralph-style refinement.
- [nicobailon/pi-coordination](https://github.com/nicobailon/pi-coordination) — Most sophisticated extension surveyed. Task graph with priorities, parallel workers, file reservations, inter-worker contracts.
- [nicobailon/pi-review-loop](https://github.com/nicobailon/pi-review-loop)
- [jayminwest/overstory](https://github.com/jayminwest/overstory) — Runtime-adapter abstraction over 11 different coding agents. Tool-call guards backing role contracts.
- [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) — Hash-anchored edits with cited 10× edit-success improvement. LSP diagnostics fire automatically.
- [gvkhosla/compound-engineering-pi](https://github.com/gvkhosla/compound-engineering-pi)
- [mikeyobrien/rho](https://github.com/mikeyobrien/rho)
- [HazAT/pi-config](https://github.com/HazAT/pi-config)
- [aliou/pi-harness](https://github.com/aliou/pi-harness)
- [disler/pi-vs-claude-code](https://github.com/disler/pi-vs-claude-code)
- [badlogic/pi-mono](https://github.com/badlogic/pi-mono) — Upstream Pi monorepo.

## 5. Research papers

### Harness engineering and scaffolds

- [arXiv 2603.05344 — Building Effective AI Coding Agents for the Terminal (OpenDev)](https://arxiv.org/abs/2603.05344) — Defines harness vs. scaffold; covers context management, safety enforcement, session persistence. Cleanest academic taxonomy.
- [arXiv 2603.25723 — Natural-Language Agent Harnesses](https://arxiv.org/html/2603.25723v1) — Argues scaffold/harness differences can dominate outcomes at fixed base model.
- [arXiv 2603.28052 — Meta-Harness: End-to-End Optimization of Model Harnesses](https://arxiv.org/html/2603.28052v1) — Frames harness choices (what to store, when to retrieve) as decisions whose effect compounds.
- [arXiv 2512.10398 — Confucius Code Agent: Scalable Agent Scaffolding for Real-World Codebases](https://arxiv.org/abs/2512.10398) — Scaffolding shown to matter as much as the backbone model.
- [Preprints.org 202604.0428 — Agent Harness for LLM Agents: A Survey](https://www.preprints.org/manuscript/202604.0428/v1) — First survey of the field.
- [arXiv 2511.13646 — Live-SWE-Agent: Self-Evolving Scaffolds](https://arxiv.org/pdf/2511.13646) — **[caveat: early-stage]**

### Verification

- [arXiv 2601.04171 — Agentic Rubrics as Contextual Verifiers](https://arxiv.org/pdf/2601.04171) — Verifier reads ticket+repo at runtime, builds problem-specific rubric. Beats generic LLM-as-judge.
- [arXiv 2604.06996 — Self-Preference Bias in Rubric-Based Evaluation](https://arxiv.org/abs/2604.06996) — Quantifies SPB on objective IFEval and subjective HealthBench. **The citation for self-preference.**
- [arXiv 2602.13576 — Rubrics as an Attack Surface: Stealthy Preference Drift](https://arxiv.org/abs/2602.13576) — Learned rubric biases transfer across judge models. Counter-evidence for naive cross-model verification.
- [arXiv 2512.16041 — Are We on the Right Way to Assessing LLM-as-a-Judge?](https://arxiv.org/html/2512.16041v1) — Reframes judge reliability as item-response-theory measurement.
- [arXiv 2512.01786 — Who Judges the Judge? LLM Jury-on-Demand](https://arxiv.org/pdf/2512.01786) — Dynamic jury selection per input.
- [arXiv 2510.05156 — VeriGuard: Verified Code Generation for LLM Agents](https://arxiv.org/html/2510.05156v1) — Correct-by-construction with formal-method gate. Canonical deterministic-first.
- [arXiv 2604.16004 — AgentV-RL: Scaling Reward Modeling with Agentic Verifier](https://arxiv.org/html/2604.16004)
- [ACL 2025 — S\*: Test-Time Scaling for Code Generation](https://aclanthology.org/2025.findings-emnlp.865.pdf)
- [arXiv 2502.18581 — Self-Certainty Best-of-N](https://arxiv.org/pdf/2502.18581)

### Long-horizon failures

- [arXiv 2604.11978 — The Long-Horizon Task Mirage](https://arxiv.org/html/2604.11978v1) — **[caveat: studies Web/OS/Embodied/DB, not coding; mitigations proposed not measured]** Cleanest taxonomy: process-level (72.5%) vs. design-level (27.5%) failures.
- [arXiv 2603.29231 — Beyond pass@1: A Reliability Science Framework](https://arxiv.org/html/2603.29231v1) — RDC, VAF, GDS, MOP metrics over 23,392 episodes. Most rigorous quantitative reliability framework.
- [arXiv 2603.24755 — SlopCodeBench](https://arxiv.org/abs/2603.24755) — Iterative coding tasks where agents extend their own prior solutions. **No agent solves any problem end-to-end across 11 models.**
- [arXiv 2603.17104 — When the Specification Emerges: Faithfulness Loss in Long-Horizon Coding Agents (SLUMP)](https://arxiv.org/abs/2603.17104) — Progressively-disclosed specs. Speaks to context drift under emergent requirements.
- [arXiv 2602.14337 — LongCLI-Bench](https://arxiv.org/html/2602.14337v1) — Long-horizon CLI-agent benchmark.
- [arXiv 2512.07497 — How Do LLMs Fail In Agentic Scenarios?](https://arxiv.org/pdf/2512.07497) — 900 traces analyzed across filesystem/text/SQL using KAMI v0.1.

### Memory and context management

- [arXiv 2603.07670 — Memory for Autonomous LLM Agents](https://arxiv.org/html/2603.07670v1) — Survey covering five mechanism families.
- [arXiv 2604.01599 — ByteRover: Agent-Native Memory Through LLM-Curated Hierarchical Context](https://arxiv.org/html/2604.01599)
- [arXiv 2604.12285 — GAM: Hierarchical Graph-based Agentic Memory](https://arxiv.org/html/2604.12285) — Two-layer topic→episodic retrieval keeps inference tokens flat as memory grows.
- [arXiv 2602.06052 — Rethinking Memory Mechanisms of Foundation Agents in the Second Half](https://arxiv.org/html/2602.06052v3) — Companion survey to Anthropic's posts.

### Plan structure and decomposition

- [arXiv 2511.09030 — MAKER — Million-Step Zero-Error Decomposition](https://arxiv.org/html/2511.09030v1) — Million-step zero-error chains possible only with minimum decomposition + heavy error-correction.

### General surveys

- [arXiv 2508.00083 — Survey on Code Generation with LLM Agents](https://arxiv.org/html/2508.00083v1)

## 6. SWE-bench and benchmarks

- [SWE-bench Verified leaderboard](https://www.swebench.com/verified.html) — Check live before citing model rankings; leaderboard positions move quickly and scaffold differences matter.
- [Morph LLM — SWE-bench Pro analysis](https://www.morphllm.com/swe-bench-pro) — Same models drop to ~46% on standardized scaffolding. Scaffold-driven gap.
- [SWE-agent docs (ACI design)](https://swe-agent.com/) — Tightly curated tools outperform raw shell.
- [arXiv 2505.23419 — SWE-bench Goes Live!](https://arxiv.org/abs/2505.23419) — Live-updatable benchmark. Solves training-data-leakage in Verified.
- [arXiv 2504.02605 — Multi-SWE-bench](https://arxiv.org/abs/2504.02605) — 8 languages, 2,132 instances. Cite for non-Python coverage.
- [arXiv 2510.08996 — Saving SWE-Bench: Benchmark Mutation](https://arxiv.org/abs/2510.08996)
- [arXiv 2512.17419 — SWE-Bench++](https://arxiv.org/html/2512.17419v1) — Auto-generation framework.
- [arXiv 2512.18470 — SWE-EVO](https://arxiv.org/html/2512.18470v1) — Long-horizon software-evolution scenarios.

## 7. Production case studies

- [Bitmovin — AI Developer Workflows: Jira to Pull Request](https://bitmovin.com/blog/ai-developer-workflows-jira-to-pull-request/) — Production ticket-to-PR with explicit AC threading.
- [Kinde — From Jira Ticket to Production Code](https://www.kinde.com/learn/ai-for-software-engineering/workflows/from-jira-ticket-to-production-code-ai-powered-spec-workflows/) — Production AI-powered spec workflows.
- [dev.to (Taras Lysyi) — How I Completed 70 Jira Tickets Using AI Agents](https://dev.to/taras-lysyi/how-i-completed-70-jira-tickets-using-ai-agents-and-slept-through-it-3knb) — Practitioner experience.
- [OpenAI — Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/) — 3 engineers, 1M LOC, 1500 PRs in 5 months.
- [Stanford Digital Economy Lab — The Enterprise AI Playbook (PDF)](https://digitaleconomy.stanford.edu/app/uploads/2026/03/EnterpriseAIPlaybook_PereiraGraylinBrynjolfsson.pdf) — 51 successful deployments, cross-cutting patterns. Non-vendor evidence.
- [GitHub Agentic Workflows (technical preview)](https://github.blog/changelog/2026-02-13-github-agentic-workflows-are-now-in-technical-preview/) and [github.com/github/spec-kit](https://github.com/github/spec-kit) — Spec-driven and gh-aw together form a credible "spec-to-PR" production primitive.
- [ZenML — LLMOps in Production: 287 case studies](https://www.zenml.io/blog/llmops-in-production-287-more-case-studies-of-what-actually-works) — Includes the Airbnb React-test-file migration (3,500 files, 1.5 years compressed to 6 weeks at 97% automation).

## 8. Engineering blog posts and write-ups

### Harness engineering

- [HumanLayer — Skill Issue: Harness Engineering for Coding Agents](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents) — Sub-agents as "context firewalls." Cites Terminal Bench 2.0 result where same model moves Top 30 → Top 5 by harness alone.
- [Datadog — Closing the verification loop: Observability-driven harnesses](https://www.datadoghq.com/blog/ai/harness-first-agents/) — Production telemetry perspective.
- [Augment Code — Harness Engineering for AI Coding Agents](https://www.augmentcode.com/guides/harness-engineering-ai-coding-agents) — Linter/CI gates as deterministic outer harness.
- [Addy Osmani — Agent Harness Engineering](https://addyosmani.com/blog/agent-harness-engineering/) — Anchor for "agent = model + harness" framing.
- [Inkeep — Context Anxiety](https://inkeep.com/blog/context-anxiety) — Sonnet 4.5 takes shortcuts when it _believes_ it's near context exhaustion. **Sharp anti-pattern citation.**
- [WaveSpeedAI — Claude Code Agent Harness: Architecture Breakdown](https://wavespeed.ai/blog/posts/claude-code-agent-harness-architecture/) — Reverse-engineered five-stage compaction.
- [Jonathan Fulton — Inside the Agent Harness: How Codex and Claude Code Actually Work](https://medium.com/jonathans-musings/inside-the-agent-harness-how-codex-and-claude-code-actually-work-63593e26c176) — Side-by-side harness comparison.
- [Clyro — The 5 AI Agent Failure Modes](https://clyro.dev/blog/the-5-ai-agent-failure-modes-why-they-fail-in-production/) — Quantified taxonomy: Context Blindness 31.6%, Rogue Actions 30.3%, Silent Degradation 24.9%, Memory Corruption 8.1%, Runaway Execution 5.1%.
- [GitHub Engineering — Multi-agent workflows often fail](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/) — First-party from a vendor shipping these in production.

### Context engineering

- [Phil Schmid — Context Engineering Part 2](https://www.philschmid.de/context-engineering-part-2)
- [Zylos — AI Agent Context Compression Strategies](https://zylos.ai/research/2026-02-28-ai-agent-context-compression-strategies) — Vendor report arguing many enterprise failures trace to context drift, not exhaustion.
- [Harness — Defeating Context Rot: Mastering the Flow of AI Sessions](https://www.harness.io/blog/defeating-context-rot-mastering-the-flow-of-ai-sessions) — Companion data point.

### Worktrees and parallel agents

- [Augment Code — Git Worktrees for Parallel AI Agent Execution](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution)
- [appxlab — Multi-Agent AI Coding Workflow with Git Worktrees](https://blog.appxlab.io/2026/03/31/multi-agent-ai-coding-workflow-git-worktrees/)
- [Penligent — Git Worktrees Need Runtime Isolation](https://www.penligent.ai/hackinglabs/git-worktrees-need-runtime-isolation-for-parallel-ai-agent-development/)

### Verification methodology

- [Adnan Masood — Rubric-Based Evals: LLM-as-a-Judge Methodologies](https://medium.com/@adnanmasood/rubric-based-evals-llm-as-a-judge-methodologies-and-empirical-validation-in-domain-context-71936b989e80)
- [Micheal Lanham — Tests-First Agent Loop / Diff Budgets](https://medium.com/@Micheal-Lanham/stop-burning-tokens-the-tests-first-agent-loop-that-cuts-thrash-by-50-d66bd62a948e) — **[caveat: headline 50% number is single anecdote]**

### Claude Code field experience

- [dev.to — Claude Code: Hooks, Subagents, and Skills (Complete Guide)](https://dev.to/owen_fox/claude-code-hooks-subagents-and-skills-complete-guide-hjm)
- [DoltHub — Claude Code Gotchas](https://www.dolthub.com/blog/2025-06-30-claude-code-gotchas/)
- [dev.to — 5 Claude Code Hook Mistakes](https://dev.to/yurukusa/5-claude-code-hook-mistakes-that-silently-break-your-safety-net-58l3) — Exit-code traps, scope confusion, JSON parse silent-failures.
- [Claude Lab — Hooks Not Firing? Troubleshooting](https://claudelab.net/en/articles/claude-code/claude-code-hooks-not-firing-troubleshooting)
- [claudelog.com — What is Worktree Isolation](https://claudelog.com/faqs/what-is-worktree-isolation-in-claude-code/)
- [Builder.io — 50 Claude Code Tips](https://www.builder.io/blog/claude-code-tips-best-practices)
- [UX Planet — 7 Rules for Creating an Effective Claude Code Skill](https://uxplanet.org/7-rules-for-creating-an-effective-claude-code-skill-2d81f61fc7cd)
- [Mellanon gist — Skills structure & activation](https://gist.github.com/mellanon/50816550ecb5f3b239aa77eef7b8ed8d)
- [Builder.io — Claude Code Routines Tutorial](https://www.builder.io/blog/claude-code-routines)
- [dabit3 gist — How to Build a Custom Agent Framework with PI](https://gist.github.com/dabit3/e97dbfe71298b1df4d36542aceb5f158)

### GPT-5.5 migration

- [the-decoder — OpenAI says old prompts are holding GPT-5.5 back](https://the-decoder.com/openai-says-old-prompts-are-holding-gpt-5-5-back-and-developers-need-a-fresh-baseline/)
- [TokenMix — GPT-5.5 Migration Checklist](https://tokenmix.ai/blog/gpt-5-5-migration-checklist)
- [Simon Willison — GPT-5.5 prompting guide notes](https://simonwillison.net/2026/apr/25/gpt-5-5-prompting-guide/)

## 9. Evidence labels and maintenance

Use these evidence labels throughout the skill when a claim could otherwise sound universal:

- **Primary doc** — vendor API/platform docs or source code. Strong for current behavior; revalidate after version changes.
- **Research-backed** — paper or benchmark with methodology. Strongest inside its measured scope; caveats matter.
- **Production report** — vendor/customer/blog case study. Useful signal, often selective or anecdotal.
- **Ecosystem pattern** — repeated open-source harness pattern. Good design prior, not proof.
- **Local convention** — this repo's rule. Follow here; don't generalize blindly.

Maintenance rule: model names, platform capabilities, beta headers, context sizes, pricing thresholds, and SDK/CLI behavior are revalidation targets. Prefer primary docs over cached summaries when making a concrete implementation decision.

## 10. Curated lists

- [VoltAgent/awesome-ai-agent-papers](https://github.com/VoltAgent/awesome-ai-agent-papers) — Auto-updated paper feed; surfaces niche items like RealMem and Replayable Financial Agents.
- [ai-boost/awesome-harness-engineering](https://github.com/ai-boost/awesome-harness-engineering) — Curated harness-specific list.
- [qualisero/awesome-pi-agent](https://github.com/qualisero/awesome-pi-agent) — Curated index of Pi extensions/hooks/skills.
- [bradAGI/awesome-cli-coding-agents](https://github.com/bradAGI/awesome-cli-coding-agents)

---

## How to use this bibliography

- Looking for a primary source for a specific claim made in this skill? Search for the claim's keyword and the citation should be marked.
- Looking for "the" reference for a topic? Section 1 (lab pubs) is your starting point; sections 2 (model guides) and 3 (platform docs) when you need authoritative API surface.
- Looking for evidence at the methodology level? Section 5 (research papers) — but flag the **[caveat]** entries.
- Looking for production validation? Section 7 (case studies) is the load-bearing section for "this works at scale" claims, but still label it as production-report evidence unless independently measured.
- Looking for ecosystem patterns to steal? Section 4 (Pi extension repos), with `roach-pi` as a particularly rich source.
- Looking for safety, replay, and operational checklists? Read `operations-safety.md` alongside this bibliography.
