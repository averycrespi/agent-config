---
name: spin-out
description: Use only when the user explicitly asks to "spin out" work or delegate work to another agent in a new Herdr-managed Git worktree. Do not use merely because delegation might help.
---

# Spin Out

Delegate one concrete task to an isolated Pi worker through the [shared exact-base launch procedure](references/launch.md). Read that procedure completely and load [Herdr](../herdr/SKILL.md) before worktree operations. Invocation authorizes the local branch/worktree, unfocused workspace, ignored handoff and Pi launch, not publication, cleanup or unrelated work. Include actual task execution authority and testable criteria in the handoff.

Standalone spin-outs leave ask-user mode unchanged. No coordinator or project record is required, and launch does not automatically adopt the worker into ongoing management. Preserve exact-base selection, source availability checks, ignored handoff readback, identity validation and task-correlated execution confirmation; submission alone is not execution or completion. Retain resources and reconcile uncertain effects rather than retrying or rolling back.

For ongoing independent assignments use explicitly requested [coordinate-repo](../coordinate-repo/SKILL.md); for an ordered serial stack use [work-stack](../work-stack/SKILL.md). These entry points reuse the same launch and [managed decision protocol](references/decisions.md), with their own authority and observation boundaries. Never automatically transfer existing workers or stack records.
