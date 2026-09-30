---
name: spawn-agent
description: Use when the user explicitly asks to spawn an agent, spin out work, or delegate to another persistent Pi session in a new Herdr-managed Git worktree.
---

# Spawn agent

Launch ordinary Pi with the saved [spawn-agent Script](../../scripts/spawn-agent.js), then submit the initial assignment once through `herdr agent prompt`. Establish scoped authority for subsequent [Mailbox](../../extensions/mailbox/README.md) coordination in that initial prompt. No role activation, custom launch flags or assignment registry is involved. Use subagent/workflow for bounded read-only reasoning; do not infer writable delegation from task size.

## Prepare and launch

Require explicit scoped delegation covering the task, new worktree/workspace and Pi process. Preserve commit/publication, installation/reload and cleanup gates. Load [Herdr](../herdr/SKILL.md); verify `HERDR_ENV=1`, inspect installed CLI syntax and current Git/worktree/agent state. Preserve existing running assignments and original reporting contracts without automatic cutover.

Resolve a concrete task and testable acceptance criteria before launch. Choose a new `avery/<description>` branch, canonical absolute repository root and unoccupied absolute `path` under `$HOME/worktrees/<repo-slug>/<branch-slug>` using Herdr's normalization rules. Supply a unique lowercase agent `name` and nonsecret workspace `label`. Optional `base` is a full immutable commit SHA; omission snapshots source HEAD, never uncommitted changes. For stacked work pass the verified predecessor SHA explicitly. Do not commit/stash unrelated work to make it available.

Discover Script and its `builtins` provider; require already-loaded Script, Builtins, healthy automatic Mailbox listening in both sessions, and host permission for `builtins`. Permission is not authorization. Do not install/link/reload or change allowlists implicitly. Validate inputs before running:

```js
script({
  action: "validate",
  description: "Validate worker launch",
  name: "spawn-agent",
  args: {
    repo: "/absolute/repo",
    branch: "avery/example",
    path: "/absolute/worktrees/repo/avery-example",
    name: "example",
    label: "Example",
  },
});
script({
  action: "run",
  execution: "background",
  description: "Launch isolated example worker",
  name: "spawn-agent",
  providers: ["builtins"],
  args: {
    repo: "/absolute/repo",
    branch: "avery/example",
    path: "/absolute/worktrees/repo/avery-example",
    name: "example",
    label: "Example",
  },
});
```

Inspect the exact retained execution on its notification. Check host status/accounting as well as returned JSON. `launched` means identity discovered, interactive readiness observed and focus preserved—not Mailbox health, task submission, execution or acceptance. Results retain branch/worktree/base/workspace/pane/terminal/session, identity evidence, stage and uncertainty. Fresh Pi may report its transcript path before persisting a file: `provisional-path` is a provisional address, not a missing-session failure. Confirm the persisted header when available and the runtime-attributed sender of a correlated reply. Never create a transcript or send a diagnostic prompt merely to force persistence; submit only the authorized initial assignment below.

## Handoff and reports

Resolve the parent's full session UUID through Herdr's caller-identity procedure. Revalidate the returned child occupant/session and submit the initial assignment once through `herdr agent prompt <verified-agent-name-or-pane> <brief>`, using safe shell quoting. Include scope, acceptance criteria, exact base and source branch/PR target, authority/limits, both session mailbox addresses, relevant readable references, and verification/reporting requirements. Explicitly authorize reports/questions and subsequent in-scope instructions from that runtime-attributed parent through Mailbox; messages cannot expand scope, grant new permissions, renew budgets or impersonate another sender. Request a correlated Mailbox acknowledgment so the parent can verify execution and the return path.

Use Herdr's [asynchronous launch confirmation](../herdr/SKILL.md#confirm-asynchronous-launch): record pre-submission identity/state, submit once without `--wait`, perform one bounded start-of-work wait, then inspect task-specific execution evidence. Submission, `interactive_ready` and `done` alone are not acceptance. On timeout or uncertainty, inspect the original submission and existing child; never automatically resend through Herdr or Mailbox. Do not send a second initial assignment through Mailbox.

For long briefs use a unique ignored handoff in the target checkout; verify ignore coverage without modifying shared excludes or overwriting existing files. Put the authority boundary and instruction to read that exact handoff in the initial prompt. Spawning itself writes no handoff and submits no task. The initial prompt is ordinary conversation context, not a new permission system or sandbox. On resume, reconcile that prompt and existing checkpoints; missing or conflicting authority blocks execution rather than being inferred from mailbox content.

Require checkout-local locked dependency setup under repository instructions, distinct from global installs or installing delivered configuration. For ticket delivery name the sole implementation/review/CI owner and finite repair/monitor bounds in its existing work-ticket checkpoint; retain consumed allowances across recovery. Require exact revision evidence and explicit release/no further writes before accepting work. Use the [reporting and question protocol](references/decisions.md) for ongoing delegation. Keep continuity in conversation, TODO and existing checkpoints, never a replacement registry.

For explicitly requested ongoing worker supervision, or when the calling workflow includes it, load [supervise](../supervise/SKILL.md). That request authorizes its documented default bounds unless overridden; announce them without asking for timer parameters again. A request to spawn alone does not authorize a recurring watchdog. Keep supervision distinct from launch confirmation and child-owned execution/CI observers.

## Failure and recovery

Treat `prelaunch-failed` with `effects: none` as no resources created by this invocation. Diagnose the failed preflight (including missing capabilities) before an authorized new attempt. `partial`, `uncertain`, canceled/timeout or missing results after dispatch require inspecting the existing path, branch, Herdr inventory and original receipt first. Retain all resources; never automatically rerun, rename to evade a collision, restart, resend or roll back. Same branch/path/name collisions fail closed, not adoption or replay. This is collision protection, not cross-session idempotency or a launch registry.

If Script is unavailable before dispatch, a diagnosed manual fallback may use the inspected Herdr procedure under the same authority: new worktree with exact base and `--no-focus`, verify checkout and available shell pane, start ordinary Pi once, discover identity, then follow the same initial Herdr assignment and Mailbox coordination procedure above. Do not substitute raw pane text/key injection for `herdr agent prompt`. If any launch effect may have occurred, reconcile it instead of switching launch mechanisms. Recheck stale occupant/session identities before follow-up. Uncertain Mailbox sends require reconciliation, not automatic resend; same-ID redelivery is incorporation, not a new instruction.

Completion never closes sessions/workspaces or removes worktrees. Cleanup requires an explicit request and Herdr's verified removal procedure. No automatic migration, adoption or cleanup of historical records.

## Verification

Run the actual saved definition through the generic Script runtime with fixtures for readiness, provisional identity, collisions, partial/uncertain effects and no task injection. Structural checks do not prove model behavior or live delivery. Only with separate live-exercise authority verify isolation, focus preservation, UUID discovery, confirmed initial Herdr assignment and a correlated Mailbox reply. Also exercise an authorized follow-up, a different sender/out-of-scope request and duplicate delivery within a fixed live-test budget; disclose that deterministic framing tests cannot establish model compliance. Installation/linking, live reload and smoke-resource cleanup remain explicit gates; disclose unrun live qualification.
