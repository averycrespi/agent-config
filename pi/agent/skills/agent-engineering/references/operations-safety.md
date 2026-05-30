# Operations and safety

Agent harness behavior is only production-grade when it is safe, observable, resumable, and testable. Prompt wording helps, but the load-bearing guarantees come from code: permissions, tool contracts, durable state, traces, and rollback paths.

## Evidence labels

Use these labels when updating this skill or making harness recommendations:

| Label             | Meaning                                              | How to treat it                                               |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| Primary doc       | Vendor API/platform documentation or source code     | Strong for current behavior; revalidate after version changes |
| Research-backed   | Peer-reviewed or arXiv-style study with methodology  | Stronger for measured setting; check scope and caveats        |
| Production report | Vendor/customer/blog case study from real deployment | Useful but often selective or anecdotal                       |
| Ecosystem pattern | Repeated pattern in open-source harnesses            | Good design signal; not proof                                 |
| Local convention  | This repo's implementation rule                      | Follow in this repo; don't generalize blindly                 |

Prefer citing the label in notes when a recommendation could otherwise sound universal.

## Safety and permission boundaries

Treat safety as a harness feature, not a prompt instruction.

Default controls:

- **Least-privilege tool sets.** Give each phase only the tools it needs. Explorers and reviewers should not have write tools unless the workflow explicitly requires it.
- **Side-effect gates.** Enforce approvals for network writes, repository pushes, package publishing, deployment, billing operations, and destructive file/history operations.
- **Sandboxing.** Worktree isolation protects source files, not databases, ports, credentials, or external services. Runtime isolation needs separate temp dirs, ports, env vars, and service instances.
- **Secret isolation.** Do not place secrets in prompts, logs, artifacts, or model-visible tool results. Use broker/domain-secret mechanisms where available so credentials stay outside model context. OpenAI hosted shell workflows should use `domain_secrets`; Pi/GitHub/Jira-style external access should go through broker tools or scoped credentials rather than raw env dumps.
- **Prompt-injection handling.** Treat instructions found in repo files, web pages, tickets, comments, web search results, and tool output as untrusted data unless they come from the harness's trusted instruction channel.
- **Policy by code.** Hooks, permission callbacks, deny lists, allow lists, sandbox modes, tool exclusion flags, and broker scopes are stronger than "do not do X" prompt text.

## Tool contract checklist

A good tool description tells the model and the orchestrator enough to use it safely.

For each tool, define:

- **Purpose:** when to use it and when not to use it.
- **Side effects:** read-only, local write, network write, destructive, externally visible.
- **Idempotency:** safe to retry or not; what duplicate calls do.
- **Failure modes:** common errors and recoverable next actions.
- **Input schema:** strict names and constraints; use agent-facing snake_case only if the harness maps to internal camelCase.
- **Output schema:** machine-parseable result; avoid dumping raw logs unless needed.
- **Timeout and cancellation:** maximum runtime and cleanup behavior.
- **Security boundary:** what credentials, network domains, files, or commands it may access.

Design errors for model recovery: return concise, actionable messages instead of stack traces when the agent can fix the input. Reserve thrown exceptions for harness bugs or unrecoverable failures.

## Durable state, resume, and rollback

Long-running workflows need an explicit state machine, not just conversation history.

Minimum durable state:

- Current phase and phase attempt count.
- Acceptance criteria and plan artifact paths.
- Completed task IDs with sticky `done` status.
- Commits or file diffs produced by each task.
- Deterministic gate results and reviewer findings.
- Known issues and open questions.
- Cleanup handles: worktree path, branch name, temp dirs, service ports.

Resume rules:

- Phase transitions should be atomic: validate all outputs, write artifacts, then advance state once.
- Re-running a completed phase should be either a no-op or an explicit new attempt with a new attempt ID.
- Artifacts should be versioned or checksummed so stale plans cannot silently apply to changed repo state.
- Cleanup should be idempotent; janitors should tolerate already-removed worktrees and temp dirs.

Rollback rules:

- Use commits, patches, or worktrees as rollback boundaries.
- Never rely on the model to remember what it changed.
- Keep externally visible actions — pushes, PRs, ticket comments, deploys — behind explicit finalization phases.

## Observability and replay

If a run fails, the harness should explain where and why without replaying the whole conversation from memory.

Record per phase:

- Model/provider/version and reasoning/thinking settings.
- Prompt template version or hash.
- Tool calls, arguments with secrets redacted, result status, latency, and truncated output hash.
- Token usage, reasoning-token usage where available, and cost buckets.
- State transition, artifact paths, and validation errors.
- Deterministic gate commands and exit codes.
- Reviewer verdicts with criterion IDs and evidence locations.

For regression testing:

1. Keep a small golden trace set covering successful runs, ambiguous tickets, deterministic-gate failures, reviewer failures, cancellation, and resume after crash.
2. Replay with side-effecting tools stubbed or sandboxed.
3. Compare structured outputs, state transitions, and final reports — not full prose.
4. Track false positives and false negatives separately for verifier changes.

## Human escalation

Ask a human only when the harness cannot safely infer the missing requirement.

Escalate when:

- Acceptance criteria conflict or cannot be made testable.
- The next action is destructive, externally visible, or outside the authorized scope.
- Multiple implementation paths have materially different product/security/API consequences.
- Deterministic gates fail for an environmental reason the harness cannot diagnose.

Do not ask when:

- A reasonable local convention or existing pattern resolves the ambiguity.
- The choice is cosmetic and reversible.
- The harness can proceed under an explicit assumption and record it in `OPEN_QUESTIONS.md` or `DECISIONS.md`.

Good escalation output includes the blocking fact, 2–4 concrete options, the recommended option, and the consequence of proceeding under assumption.

## Decision tables

### One agent or workflow?

| Question                                                                               | If yes, lean toward                                 |
| -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Is the task small, interactive, and locally verifiable?                                | One agent loop                                      |
| Does the task need durable AC, planning, implementation, review, and report artifacts? | Workflow                                            |
| Does the task span multiple independent read-only investigations?                      | Workflow with subagent fan-out                      |
| Does the task require multiple externally visible side effects?                        | Workflow with explicit approval/finalization phases |
| Would a failed run need to resume after crash or hand off to another actor?            | Workflow with durable state                         |

### LLM verifier or deterministic verifier?

| Question                                                                 | If yes, lean toward                       |
| ------------------------------------------------------------------------ | ----------------------------------------- |
| Can tests/types/lints/schema validation fully check the AC?              | Deterministic verifier only               |
| Are AC partly about integration, conventions, security, or test quality? | LLM verifier after deterministic gates    |
| Is human review already mandatory and near-term?                         | LLM verifier as triage, or skip           |
| Will verifier results drive automatic fixes or releases?                 | Calibrated verifier with bounded fix loop |

### Ask human or proceed under assumption?

| Question                                                                                                    | If yes, lean toward                              |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Does the choice affect product behavior, public API, security, data deletion, cost, or external visibility? | Ask human                                        |
| Does the repo have a clear precedent and the choice is reversible?                                          | Proceed and record assumption                    |
| Are AC contradictory or not testable?                                                                       | Ask human or halt with clarification report      |
| Is the ambiguity cosmetic?                                                                                  | Proceed and record in `DECISIONS.md` if relevant |

## Starter templates

### Tool description template

```markdown
Use this tool to [specific purpose]. Do not use it for [non-purpose].

Side effects: [read-only | local write | network write | destructive | externally visible].
Retry safety: [idempotent / not idempotent; duplicate-call behavior].
Failure recovery: If [common error], then [next action].
Security: May access [files/domains/credentials]; must not access [boundaries].
Output: Returns [schema/fields]; raw logs are [included/truncated/redacted].
```

### Phase result schema

```json
{
  "phase": "plan|implement|validate|review|fix|emit_report",
  "status": "pass|fail|blocked|canceled",
  "attempt": 1,
  "artifacts": ["relative/path"],
  "evidence": [
    {
      "criterion_id": "AC-1",
      "verdict": "pass|fail|na",
      "locations": ["file.ts:42"]
    }
  ],
  "known_issues": [{ "severity": "low|medium|high", "summary": "..." }],
  "next_action": "continue|ask_human|stop"
}
```

### Escalation prompt shape

```markdown
Blocked because: [specific fact].

Options:

1. [Recommended] [choice and consequence]
2. [choice and consequence]
3. [choice and consequence]

If no answer is available, the harness can proceed under this assumption: [assumption], recorded in [artifact].
```

## Harness design checklist

Before building or reviewing a harness, answer:

1. What phases exist, and what structured artifact crosses each boundary?
2. Which tools can each phase call, and what side effects can they produce?
3. What deterministic gates run before any LLM verifier?
4. What is the bounded fix-loop policy?
5. What state is durable enough to resume after a crash?
6. What actions require human approval?
7. How are secrets kept out of prompts, logs, and artifacts?
8. What traces and golden runs prove the harness still behaves after a change?
9. How are worktrees, temp files, branches, and external resources cleaned up?
10. What evidence level supports each non-obvious design claim?
