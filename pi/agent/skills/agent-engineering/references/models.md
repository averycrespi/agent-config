# Model-specific guidance

Use this reference for harness guidance on GPT-6 Astra and GPT-5.6. Keep platform APIs separate from model capabilities; see `platforms.md` for Claude Code, the Claude Agent SDK, and Pi. Verify model names, beta features, pricing, and version-specific claims against primary sources before relying on them.

## GPT-6 Astra

Primary source: [Using GPT-6 Astra](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra). Treat the behavioral tendencies below as vendor guidance to evaluate in the target harness, not measured results from this repository. Do not transfer GPT-5.6 benchmark gains, variant names, or defaults to Astra without evidence.

### Prompt and skill migration

1. **Define authorized follow-through.** Astra is documented as more likely to ask when input could materially change the result. Treat action requests as authorization to complete their in-scope work, make routine low-risk assumptions, and ask focused questions for genuinely consequential ambiguity. Complete independently authorized preparation before requesting approval; do not guess through ambiguity that would invalidate that preparation. Preserve local approval rules for external publication, destructive actions, and unrelated work. Do not copy the vendor's broad draft-PR/worktree autonomy examples as blanket authorization.
2. **Audit the composed instruction surface.** Inspect system/developer prompts, `AGENTS.md`, loaded skills, tool descriptions, and workflow prompts for conflicting scope, confirmation, stopping, and delegation rules. Astra's stronger instruction following makes stale guidance consequential. Remove duplicate or contradictory rules instead of layering on another persistence slogan. Respect the actual instruction hierarchy; a skill cannot declare that user requests override system or developer requirements. When a skill unexpectedly blocks work, report the exact file and instruction and distinguish its requirement from an interpretation.
3. **Specify the communication contract.** Astra tends toward detailed, formatted answers and recurring phrases. Request the answer or action first, plain language, proportional detail, and lists or tables only when useful. Preserve required evidence and artifacts rather than using a global brevity rule that suppresses them. Do not transfer GPT-5.6's advice against generic concision prompts as an Astra-specific rule.
4. **Make delegation triggers explicit.** Delegate independent exploration, source retrieval, and review when isolation or parallelism improves the result. Give each child a self-contained question, explicit capabilities, and an output contract; retain synthesis in the orchestrator. Keep deterministic checks inline when cheaper. Bound fan-out, depth, and cost in code, and keep shared-state writes sequential. Astra may otherwise delegate less than intended; the vendor's broad delegation prompt is not a reason to spawn on every possible opportunity.
5. **Calibrate verification without weakening gates.** Run meaningful checks appropriate to the change and every repository-required check. After they pass, broaden or repeat only for new changes, failures, or unresolved risks. Avoid tests that merely mirror low-impact implementation details. Retain meaningful regression tests, independent review where required, and explicit bounded fix loops; do not reinterpret this guidance as permission to skip mandatory tests.

### API and harness migration

- **Use `model: "gpt-6-astra"` and Responses for tools.** Chat Completions is supported, but Astra tool calling requires the Responses API. Verify the installed provider adapter's support before changing model routing; a provider feature is not automatically available through a coding harness.
- **Rebaseline reasoning.** Map previous `none` effort to `low` initially; otherwise preserve effective effort and compare alternatives on representative tasks. Astra does not support `none`. Preserve explicit permission, budget, and termination controls regardless of effort.
- **Remove unsupported parameters.** Remove `temperature`, `top_p`, and `top_logprobs`; also remove Chat Completions `logprobs` or Responses `include` entries for `message.output_text.logprobs`.
- **Change effort through the supported protocol.** For compatible standard single-agent requests, use `configuration_update` input items between responses while keeping request-level `reasoning.effort` unchanged to preserve the cached prefix. The update persists until overridden. Check current compatibility limits before enabling this.
- **Treat async tools as an integration feature.** Astra can continue independent work while a function/custom tool marked `async: true` runs. The application still owns execution, pending work, and result delivery using the original `call_id`. Define dependency, timeout, cancellation, and late-result policies before enabling it; async execution does not authorize concurrent shared-state writes.
- **Treat steering as explicit scope revision.** Responses WebSockets support additional user instructions while Astra works. Keep durable requirements and verification evidence aligned with the revision; do not assume a steering message rolls back side effects. Verify the transport and adapter before exposing this behavior to users.
- **Recheck inherited capabilities and deployment settings.** The guide lists Structured Outputs, PTC, multi-agent orchestration, persisted reasoning, compaction, caching, and pro mode as supported. Review cache configuration and billing. Astra Fast mode is unavailable with EU data residency; use Standard processing there. Revalidate these settings rather than assuming model substitution is sufficient.

### Migration acceptance checks

Evaluate representative small edits, multi-file work, ambiguous requests, approval-gated actions, delegation opportunities, and resumed tasks. Record task correctness, completion evidence, unnecessary clarification, delegation usefulness, verification repetition, output completeness, latency, and cost. Compare the existing prompt with the revised prompt at a controlled effort setting before changing multiple knobs. Keep model-specific capabilities separate from what the installed harness actually exposes.

## GPT-5.6

Primary source: [Using GPT-5.6](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6). Retain this baseline for GPT-5.6 routing and migration comparisons.

| Model         | Role                       | Context | Output | Default `reasoning.effort` |
| ------------- | -------------------------- | ------- | ------ | -------------------------- |
| GPT-5.6 Sol   | Frontier capability        | 1.05M   | 128K   | medium                     |
| GPT-5.6 Terra | Capability/cost balance    | 1.05M   | 128K   | medium                     |
| GPT-5.6 Luna  | Efficient high-volume work | 1.05M   | 128K   | medium                     |

The `gpt-5.6` alias routes to `gpt-5.6-sol`.

### Harness-relevant guidance

1. **Route across Sol, Terra, and Luna.** Sol is the flagship; Terra balances capability and cost; Luna targets efficient high-volume work. The unsuffixed alias resolves to Sol.
2. **Migrate by evaluation, not slug replacement.** Preserve effective reasoning effort as the first baseline, then test one level lower. GPT-5.6 supports `none`, `low`, `medium`, `high`, `xhigh`, and `max`; omitted effort defaults to `medium`.
3. **Treat pro mode and effort as independent.** Set `reasoning.mode: "pro"` on the chosen GPT-5.6 model for difficult quality-first work. Do not prompt the model to "use pro mode," and do not switch to a separate Pro slug.
4. **Shorten accumulated harness prompts.** OpenAI reports internal gains from removing redundant instructions, examples, verbose tool descriptions, and global response templates. State the goal, important constraints, authorization boundary, evidence requirements, success criteria, and output contract. Avoid generic "be concise" instructions: GPT-5.6 is already compressed and may omit required artifacts. Put per-tool usage contracts in tool descriptions and enforce structured output through schemas rather than prose.
5. **Use persisted reasoning deliberately.** `reasoning.context: "all_turns"` can reuse compatible earlier reasoning when goals and assumptions remain stable; use `current_turn` when earlier reasoning is stale. With `store: false` or ZDR workflows, request encrypted reasoning content and replay every output item.
6. **Use Programmatic Tool Calling only for bounded computation over tools.** It fits filtering, joining, ranking, deduplication, aggregation, and validation in an isolated JavaScript runtime. Keep direct calls for approval-sensitive actions, writes, fresh semantic judgment, and citation/native-artifact preservation.
7. **Treat Multi-agent as a bounded beta primitive, not the outer orchestrator.** Opt in through the beta Responses SDK or `OpenAI-Beta: responses_multi_agent=v1`, and set `multi_agent.enabled: true` on the request; item schemas may change. It fits independent exploration, research, comparison, review, and isolated components. Default concurrency is three, but total descendants and depth have no fixed service limit and `max_tool_calls` is unavailable; enforce application-level time, cost, fan-out, retry, permission, and termination limits. Keep shared-state writes sequential.
8. **Re-evaluate prompt caching economics.** GPT-5.6 supports explicit breakpoints and more reliable matching with `prompt_cache_key`, but cache writes cost 1.25× uncached input. Monitor `cache_write_tokens` and `cached_tokens`; use explicit mode when only known-stable prefixes should be written.
9. **Budget for richer image inputs and safety pauses.** `original` and `auto` can preserve large image dimensions, increasing tokens and latency. Real-time cyber and biology classifiers can pause streaming or refuse dual-use requests; distinguish those events from transport failures and send a privacy-preserving `safety_identifier` for individual end users.

API references: [reasoning](https://developers.openai.com/api/docs/guides/reasoning), [Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling), [Multi-agent beta](https://developers.openai.com/api/docs/guides/tools-multi-agent), and [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

## Responses API for harnesses

Authoritative pages: [Compaction guide](https://developers.openai.com/api/docs/guides/compaction) and [`/responses/compact` endpoint](https://developers.openai.com/api/reference/resources/responses/methods/compact).

Compaction is first-class. Two modes:

1. **Threshold-driven**: set `context_management.compact_threshold`; on overflow the server emits an opaque encrypted compaction item that carries forward state/reasoning. ZDR-friendly when `store=false`. Chain via appended item OR `previous_response_id`.
2. **Explicit-control**: call `/responses/compact` yourself when your harness decides to compact. Use this when you want compaction to align with phase boundaries (e.g. compact at end of `plan` before entering `implement`).

Keep persisted reasoning (`reasoning.context`), prompt caching, and PTC distinct from compaction. GPT-5.6 Multi-agent beta automatically compacts each agent context and does not support the standalone compact endpoint.

## OpenAI Codex CLI

Codex CLI is OpenAI's coding harness. Verify its installed model support and configuration rather than assuming its defaults match this reference's model scope.

Authoritative pages:

- [Codex changelog](https://developers.openai.com/codex/changelog)
- [Codex CLI features](https://developers.openai.com/codex/cli/features)
- [Codex subagents](https://developers.openai.com/codex/subagents)
- [Skills + Shell + Compaction blog](https://developers.openai.com/blog/skills-shell-tips)
- [AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)

Harness-relevant platform baseline (May 2026; revalidate against the installed release):

- **Codex CLI v0.135.0**: `codex doctor` reports richer environment/Git/terminal/app-server/thread diagnostics; `/permissions` understands named permission profiles; the Python SDK exposes sandbox presets; packaged builds bundle a patched zsh helper.
- **Memory and telemetry are runtime state.** Recent changelog entries moved memory runtime state to SQLite and added memory/goal telemetry. Treat durable memory as a stateful subsystem, not prompt text.
- **AGENTS.md resolution**: global `~/.codex/` then root → cwd; `AGENTS.override.md` beats `AGENTS.md` at each level; concatenated root-down so closer files override; capped at `project_doc_max_bytes` (32 KiB).
- **Subagents**: Codex only spawns them when explicitly asked. Built-ins are `default`, `worker`, and `explorer`; custom agents are TOML files under `.codex/agents/` or `~/.codex/agents/`. `agents.max_threads` defaults to 6 and `agents.max_depth` defaults to 1. `spawn_agents_on_csv` requires each worker to call `report_agent_job_result` exactly once.
- **Skills + shell + compaction**: skill descriptions should read like routing logic, including when _not_ to use the skill; templates and examples belong inside skills; use server-side compaction as a default long-run primitive; keep networking on narrow org/request allowlists and use `domain_secrets` so credentials never reach the model.

## Shared operating rules

1. **Verify independently against evidence.** Run deterministic gates first. When LLM review is warranted, use a fresh read-only context, AC loaded from authoritative artifacts, and file/line or command evidence. GPT-5.6 and Astra can review each other's work, but different models in one family do not eliminate correlated errors or self-preference. See `verification.md`.
2. **Preserve reasoning continuity using the model's protocol.** Preserve opaque response items. Astra supports compatible between-response effort changes through `configuration_update` without rewriting the cached prefix.
3. **Read the exact model's current prompting guide before reusing prompts.** Keep task intent, authorization boundaries, output contracts, and stop conditions explicit; evaluate model-specific tuning separately.
4. **Combine context controls deliberately.** Use compaction, persisted reasoning, and prompt caching for their distinct purposes; account for cache-write charges.
5. **Recompute budgets on upgrades.** Tokenizers and cache policies can change. Recheck context budgets, max-token settings, and compaction/cache thresholds.
