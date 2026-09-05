# Pi Agent Configuration

This directory manages [Pi](https://pi.dev/) coding agent configuration files.

## Directory Structure

```
pi/agent/
├── AGENTS.md       # Agent instructions (task approach, git rules, style)
├── settings.json   # Provider, model, and thinking settings
├── extensions/     # TypeScript extensions, including centrally governed subagents
├── workflows/      # Reusable foreground orchestration scripts
├── prompts/        # Custom prompt templates
└── skills/         # Custom skills
```

## How It Works

Running `make stow-pi` creates symlinks from `pi/agent/` into `~/.pi/agent/`. Edits here take effect immediately — no need to re-stow after changing files.

## Herdr Integration

The Herdr integration has three distinct ownership boundaries:

- The repository-owned [`herdr` skill](agent/skills/herdr/SKILL.md#manage-git-worktrees) owns worktree-management procedures, including discovery, checkout paths, focus, removal, and verification. `spin-out` adds the purpose-specific delegation workflow.
- The repository-owned `ask-user` extension emits balanced `herdr:blocked` events while an interactive question is open.
- Herdr owns the generated `herdr-agent-state.ts` lifecycle bridge. It reports Pi session identity and `working`, `blocked`, and `idle` state to the current Herdr pane.

Install or update the bridge after `make stow-pi` so Herdr writes it through the managed `~/.pi/agent/extensions` symlink:

```sh
herdr integration install pi
herdr integration status
```

The generated bridge is a local installer artifact: do not edit or commit it. Re-running the install command may overwrite it. Restart Pi or run `/reload` after installing or updating the bridge. The repository's provisioning script performs the installation automatically.

### macOS client with a Lima guest

When the Herdr server and Pi run inside Lima, start the interactive Herdr client on macOS with remote attach instead of opening an SSH shell and running `herdr` inside the guest. A guest-only client receives a Finder drop as an absolute macOS path such as `/var/folders/.../TemporaryItems/NSIRD_screencaptureui_...png`, which does not exist in the guest. A local remote client reads the host image immediately, transfers it over Herdr's SSH connection, stages it as a guest-local file, and pastes that readable path into the target pane.

Install Herdr on both macOS and the guest, and keep their versions compatible. On macOS, expose Lima's generated SSH hosts to normal OpenSSH by adding this at top level near the beginning of `~/.ssh/config`:

```sshconfig
Include ~/.lima/*/ssh.config
```

List the instances and generated SSH configuration files, then inspect the relevant file for its `Host` alias:

```sh
limactl ls --format '{{.Name}}\t{{.SSHConfigFile}}'
grep '^Host ' ~/.lima/<instance>/ssh.config
```

Verify ordinary SSH access before involving Herdr:

```sh
ssh lima-<instance> 'hostname && herdr --version'
```

If alias resolution fails, test the generated configuration directly with `ssh -F ~/.lima/<instance>/ssh.config lima-<instance>` and fix the top-level `Include`. Detach any client currently running through an SSH shell with `Ctrl+B`, then `Q`; this leaves the guest server and panes running. Exit that shell and attach from macOS:

```sh
herdr --remote lima-<instance>
```

For a named Herdr session, add `--session <name>`. Do not run plain `herdr` on macOS for this workflow, because that opens a separate macOS-local server rather than the Lima-hosted session.

While attached remotely:

- Finder-dropped PNG, JPEG, GIF, WebP, and BMP files are copied into a private guest staging directory before their guest path reaches Pi.
- `Ctrl+V` uses Herdr's default `keys.remote_image_paste` binding to bridge an image from the macOS clipboard.
- Keep the client attached until Pi has consumed the staged image.
- Pi agents remain inside Lima and continue to control the guest Herdr server through the normal `herdr` CLI and injected `HERDR_*` pane context.

Verify the agent-side control path from a Pi pane:

```sh
printf '%s\n' "$HERDR_ENV" "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
herdr pane current --current
herdr agent list
```

A successful image drop produces a guest-readable path similar to `/tmp/herdr-clipboard-images-<uid>/client-<id>-clipboard-<id>-0.png`; Pi's `read` tool should recognize it as an image. This setup requires no `/var/folders` mount. Avoid mounting that host tree: it exposes unrelated temporary data and does not eliminate the screenshot thumbnail's short-lifetime race.

References: [Herdr remote access](https://herdr.dev/docs/persistence-remote/), [Herdr remote workflow](https://herdr.dev/docs/how-to-work/), and [Lima SSH configuration](https://lima-vm.io/docs/usage/ssh/).

## Extensions

TypeScript modules that customize the Pi agent. Type-check with `make typecheck`.

| Extension           | Purpose                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `ask-user`          | `ask_user` tool for multiple-choice questions                                                           |
| `compact-tools`     | Compact TUI rendering for built-in shell and file tools                                                 |
| `context-usage`     | `/context-usage` token-blame report for current context-window usage                                    |
| `goal`              | Fork-safe goals, bounded auto-run, and conservative evidence-backed completion                          |
| `loop`              | Shared targetless bounded continuation controlled by agents, users, skills, and extensions              |
| `mcp-broker`        | MCP broker meta-tools plus a bash guard for direct `gh` and remote-git operations                       |
| `scheduled-tasks`   | Markdown-defined recurring tasks with cron support, prechecks, manual runs, logs, and handoff state     |
| `statusline`        | Single-line footer with cwd, quota, context, model, and thinking                                        |
| `structured-output` | Schema-backed final output tool, no-op unless configured                                                |
| `subagents`         | Profile-routed isolated child dispatch with explicit read, write, shell, broker, and web capabilities   |
| `todo`              | Session-persisted TODO tool with a sticky widget                                                        |
| `web-access`        | Web search, fetch, GitHub, and PDF tools                                                                |
| `workflows`         | Compound discovery, validation, and foreground execution for reusable user-scoped read-mostly workflows |

Underscore-prefixed directories are libraries imported by sibling extensions, not extensions themselves — pi's extension loader skips them because they have no `index.ts`.

| Library   | Purpose                                    |
| --------- | ------------------------------------------ |
| `_shared` | Stateless helpers shared across extensions |

See [AGENTS.md](../AGENTS.md) for repo-specific authoring guidance.

## Saved Workflows

JavaScript orchestration definitions under `agent/workflows/` are installed into Pi's default saved-workflow store. They run through the `workflows` extension with the same sandbox, centrally resolved subagent capabilities/profiles, concurrency, budgets, and validation as inline workflows. Saved workflows reject mutable filesystem and shell capabilities. Workspace mutation stays in the main session unless an explicit execution workflow authorizes bounded writable delegation, such as through `spawn_agents` or `spin-out`. Their `*.test.ts` files stay beside the definitions and are included in repository lint, typecheck, and test commands.

| Workflow        | Purpose                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| `deep-research` | Explicitly requested or approved deep public-web research with a verified cited report. |
| `review`        | Review prepared evidence with one independent reviewer and optional risk-driven lenses. |

Run definitions through the `workflow` tool with `action: "run"`, a saved `name`, and workflow-specific `args`. `deep-research` accepts a question string; `review` requires prepared target, patch/context-path, and deterministic-check evidence. The companion [`review` skill](agent/skills/review/SKILL.md) prepares that package for normal interactive use. See [the workflows README](agent/extensions/workflows/README.md#saved-workflows) for exact contracts and safety boundaries.

## Prompt Templates

Markdown snippets invoked with `/name` in Pi, where `name` is the filename without `.md`.

| Prompt template | Purpose                                                              |
| --------------- | -------------------------------------------------------------------- |
| `scan-secrets`  | Scan branch or unpushed commits for secrets and personal information |

## Skills

Markdown skill packages that load on demand via progressive disclosure — only the `name` and `description` are pre-registered; the body of `SKILL.md` and any bundled `references/` files load only when the skill activates.

| Skill               | Use when                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `agent-engineering` | Designing, building, debugging, or reviewing AI coding agent harnesses and multi-phase workflows            |
| `challenge`         | Stress-testing plans, proposals, designs, architecture decisions, and approaches before implementation      |
| `clarify`           | Researching material ambiguity and asking focused questions to return an actionable brief without artifacts |
| `create-skill`      | Creating a new skill or updating an existing one                                                            |
| `diagnose`          | Debugging bugs, failures, flaky behavior, regressions, or performance problems                              |
| `frontend-design`   | Building web components, pages, or applications that need distinctive, production-grade frontends           |
| `handoff`           | Compacting a Pi session into a local `.handoffs/` document; explicit invocation only                        |
| `herdr`             | Controlling Herdr panes, agents, and workspaces, including Herdr-managed Git worktrees                      |
| `plane`             | Safely accessing and organizing Plane workspaces, projects, work items, Pages, and relationships            |
| `playwright`        | Driving a browser for testing, form filling, screenshots, and data extraction                               |
| `review`            | Preparing code-change evidence, invoking the saved review workflow, and presenting its findings             |
| `shape-ticket`      | Creating and explicitly approving Plane tickets for ticket-driven delivery                                  |
| `simplify`          | Explicitly testing pre-implementation artifacts for unnecessary complexity while preserving outcomes        |
| `spin-out`          | Spinning out or delegating work to a new Pi agent in a Herdr worktree; activates only on explicit ask       |
| `wiki`              | Maintaining a persistent markdown wiki from immutable source documents                                      |
| `work-ticket`       | Owning one selected Plane ticket through explicitly authorized local implementation or reviewed PR delivery |

Notes:

- Testing policy lives in [the global agent instructions](agent/AGENTS.md#testing-and-verification-evidence): require proportionate regression evidence and focused plus broader checks, while leaving test-first sequencing optional.
- Most skills are mirrored from the companion Claude Code configuration with Pi-platform adjustments (tool name swaps, mcp-broker meta-tools for MCP calls, GPT-5.x-friendly prose).
- `clarify` researches answerable questions and resolves material user-owned decisions. Standalone clarification is read-only; clarification inside authorized work resumes that work without another approval pause. It is optional, not a required ticket phase. `challenge` and explicit-only `simplify` share one assessment procedure with distinct risk and complexity lenses; neither automatically runs both. `review` evaluates completed changes and may summarize a long report while retaining the full unchanged report at an accessible path, exposing every blocker, unresolved decision, failed check, and material gap.
- `work-ticket` loads helper, recovery, publication, and settlement procedures before the corresponding operation; inspection alone does not initialize or mutate state. `review` loads its input contract before invocation and its bounded repair procedure before editing. These references preserve the existing authority and evidence gates.
- Wiki ingests, filed answers, and accepted maintenance changes include automatic checkpoints unless the user or vault policy says otherwise. This explicit commit-policy exception does not authorize pushing or unrelated commits.
- The ticket path uses `plane` for safe broker access, `shape-ticket` for a verifiable contract, and `work-ticket` for one authorized owner. Ready is optional context, not implementation or publication authority. Work can stay in the current checkout; Herdr handles requested or necessary worktree isolation. One `.pi/tickets/<immutable-ticket-id>/state.json` retains authorization, plan/progress, revision-bound evidence, findings, and at most two review-driven repair cycles. The helper installs `/.pi/tickets/` in Git info exclude without changing tracked `.gitignore`. Local completion leaves Plane In Progress. Authorized PR delivery requires history/metadata safety checks, independent review (one reviewer by default), and required exact-head CI before Review handoff. Settlement, cancellation, and cleanup need explicit authority. There is no mandatory phase cursor, per-turn checkpoint, queue, registry, or controller. Legacy `.ticket-run/` records remain untouched and ignored, with no migration or recovery support.
- Keep canonical user-facing contracts and architecture decisions in the appropriate existing documentation or explicitly authorized ticket artifacts.
- Skills adapted from external sources should include bare `ATTRIBUTION` and `LICENSE` files in the skill directory.
- See the [create-skill](agent/skills/create-skill/SKILL.md) skill when adding new skills.

## Legacy workflow retirement

The legacy `.design` lifecycle and its `architect`, `specify`, `plan`, `advance-plan`, and `create-jira-ticket` skill packages have been retired. Use direct authorized work or the Plane ticket workflow described above; old plan-run helpers and skill commands are no longer available.

Existing local `.design` artifacts are not deleted or migrated automatically. Treat them as historical context, verify their claims against current repository state, and explicitly re-scope any unfinished work before continuing. Do not attempt to resume an old run with the removed helper.

The Goal extension remains available for general-purpose, evidence-audited objectives. It does not restore the retired plan workflow or replace ticket state; ticket delivery may use Loop for optional bounded continuation, not mandatory execution choreography.
