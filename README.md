# Agent Config

My personal [Pi](https://pi.dev/) setup for software development. It supports research-first clarification, focused implementation, ticket-driven delivery, pre-implementation challenge and simplification, and independent review. Bounded session goals remain available for adaptive work outside the ticket workflow.

The repository contains the skills, extensions, prompts, and saved workflows that power that setup. Custom extensions are written in TypeScript and maintained with tests and documentation.

## Pi Agent Harness

The harness combines a simple development loop with tools that keep work scoped, observable, and verifiable.

### Workflow

- **Clarify** material ambiguity with `clarify`: research first, ask focused questions, and return a concise brief without creating artifacts. Skip the interview when the request is already clear.
- **Stress-test** concrete approaches with `challenge` for material risks or explicit-only `simplify` for unnecessary complexity.
- **Implement and verify** directly for authorized local work, or use the ticket workflow for prepared delivery. Keep evidence and checks proportionate to the change.
- **Review** changes against the authorized delivery scope with `review`, combining repository context, deterministic checks, and independent analysis while retaining qualification limitations.

For Plane-native delivery, `plane` defines safe access and organization, `shape-ticket` prepares a verifiable contract, and `work-ticket` owns one explicitly selected ticket through its authorized local or PR boundary. A proportionate plan and one Git-excluded `.pi/tickets/<ticket-id>/state.json` preserve continuity without a phase machine. The helper installs exclusion in Git info exclude, not tracked `.gitignore`. Current-checkout work is supported; linked worktree isolation uses Herdr. Implementation includes in-scope local commits unless excluded; PR publication needs explicit authority, fail-closed outgoing-history and metadata safety checks, independent review, and exact-head CI. Review distinguishes missing required evidence from out-of-scope qualification; expanded delivery boundaries require reevaluation. It defaults to one reviewer with risk-driven extra lenses and two durably counted repair batches; genuinely new local follow-up scope may receive explicitly authorized additive cycles. Local helper receipts reduce bookkeeping, and opt-in content-equivalent evidence reuse avoids unnecessary post-commit checks. Merge, settlement, cancellation, and cleanup retain explicit authority boundaries; Loop is optional. There is no controller, queue, or registry.

### Choosing an orchestration primitive

The harness provides four complementary orchestration primitives. Choose based on what needs to be isolated or controlled:

| Primitive     | Use it when                                                                                                                                   | What it provides                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Subagents** | A task benefits from a fresh perspective, a different model or reasoning effort, isolation from the main context, or independent parallelism. | A one-shot child session with a self-contained prompt, explicit capabilities, and a centrally configured `fast`, `balanced`, or `strong` profile.          |
| **Workflows** | The orchestration is predictable and reusable—especially for fan-out/fan-in research, review, verification, or audit patterns.                | Deterministic JavaScript control flow around bounded subagent calls, including parallelism, pipelines, structured output, verification gates, and budgets. |
| **Loops**     | An agent, skill, user, or extension needs bounded targetless continuation after otherwise terminal turns.                                     | One shared session loop with continuation/time limits, yield/stop/resume controls, a repeated message, and no objective or completion policy.              |
| **Goals**     | Work must advance incrementally across agent turns, and each next action may depend on what the previous turn discovered or completed.        | A session-scoped objective with bounded continuation, lifecycle controls, and evidence-backed completion.                                                  |

Use a **subagent** when the primary need is another isolated reasoning context. Children start cold, so tasks must be self-contained. Read-only exploration and review are the default use cases; mutable delegation is kept sequential and explicitly bounded.

Use a **workflow** when the control graph should live in code rather than be improvised by the model. Workflows are best when decomposition, concurrency, synthesis, and termination can be defined in advance. In this configuration they are read-mostly and are not a mechanism for parallel workspace mutation or open-ended execution.

Use a **loop** when only liveness is needed. A loop rebroadcasts a caller-specified message after Pi settles, subject to shared continuation and running-time bounds. It deliberately carries no objective and makes no claim about whether work is complete.

Use a **goal** when progress is adaptive but can be made and audited one turn at a time. Goals keep the main agent moving toward an objective until it completes, yields, is interrupted, or reaches a configured bound. A goal supplies continuation and steering; it does not replace a durable plan or prescribe a fixed phase graph.

These primitives compose. A skill or extension can use a loop as a lower-level liveness layer, while a goal may steer adaptive main-session work across turns and use read-only subagents or workflows for bounded research, diagnosis, or explicitly required review. The objective-bearing layer owns completion policy, the main session owns workspace mutation and execution evidence, the workflow owns deterministic orchestration, and each subagent owns one isolated unit of reasoning.

For explicit worktree-based delegation, the model-invokable `spin-out` skill starts a fresh Pi agent in a Herdr-managed worktree with a durable local task brief only when the user asks to spin out work.

### Extensions

Custom TypeScript extensions under [`pi/agent/extensions/`](pi/agent/extensions/) provide:

- **Work tracking and automation:** loops, goals, TODOs, and scheduled tasks
- **Delegation and orchestration:** isolated subagents, saved workflows, and structured output
- **External access:** broker-backed services and web research
- **Interaction and context:** user prompts, context reporting, compact tool output, and TUI status information

See [`pi/README.md`](pi/README.md) for the complete extension and skill catalog.

### Herdr integration

[Herdr](https://herdr.dev/) provides the terminal and worktree control plane used by the `herdr` and `spin-out` skills. Herdr's Pi integration installs a local lifecycle bridge, while the repository-owned `ask_user` extension reports interactive questions through that bridge. When Pi and the Herdr server run in a Lima guest, attach with a macOS-local `herdr --remote` client so host screenshots and clipboard images are transferred into the guest instead of appearing as inaccessible `/var/folders/...` paths. See the [Pi Herdr integration documentation](pi/README.md#herdr-integration) for component ownership, installation, updates, and the remote-client setup.

### Development

Extensions are directory-based TypeScript modules with colocated tests and user-facing documentation. Non-trivial extensions also include design guidance, while shared helpers live under [`pi/agent/extensions/_shared/`](pi/agent/extensions/_shared/).

```sh
make install-dev      # install dependencies and Git hooks
npm run lint          # lint extensions and saved workflows
npm run format:check  # check formatting
make typecheck        # run TypeScript checks
make test             # run unit tests
```

GitHub Actions runs these checks for pull requests and pushes to `main`.

## Companion: agent-tools

[`agent-tools`](https://github.com/averycrespi/agent-tools) provides external utilities that complement this configuration repo.

The main integration point is the **MCP broker**: a credentials-holding proxy that lets sandboxed agents use authenticated external services without holding secrets directly. In Pi, the [`mcp-broker`](pi/agent/extensions/mcp-broker/) extension exposes broker-backed tools through `mcp_search`, `mcp_describe`, and `mcp_call`, and guards direct `gh` or remote-git usage when broker tools are preferred.

`agent-tools` also includes a sandbox manager (`sb`) for isolated agent runs. It is relevant to Pi as an outer isolation layer: this Pi config adds workflow guidance and broker preferences, but it does not implement shell command restrictions itself.

## Notes

[`notes/`](notes/) contains public essays and working notes about agent harness design, permissions, subagents, planning workflows, and related topics.

## Quick Start

### Requirements

- [Pi agent](https://pi.dev/)
- [Herdr](https://herdr.dev/) for pane, agent, and worktree integration
- [Homebrew](https://brew.sh/)
- [Node.js](https://nodejs.org/) 24+
- macOS assumed, adaptable for Linux

### Setup

```sh
git clone git@github.com:averycrespi/agent-config.git
cd agent-config
brew bundle             # install system dependencies on macOS
make install-dev        # install Node dependencies and Husky git hooks
make install-playwright # for browser automation and web-access JS rendering
make stow-pi            # symlink pi/agent/ into ~/.pi/agent/
herdr integration install pi # install/update the local Pi lifecycle bridge
```

## License

- Repository licensed under [MIT](./LICENSE)
- Individual components may have their own licenses
