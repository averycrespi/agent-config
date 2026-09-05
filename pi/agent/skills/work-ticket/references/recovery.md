# Ticket Recovery

Read this procedure completely before resuming after compaction/interruption, taking over ownership, or recovering a helper failure. Follow [work-ticket](../SKILL.md) and read [the helper interface](helper.md) before helper calls.

Read the existing record first, then reconcile actual ticket, files, Git, ownership, PR, review, and checks before acting. A record is not proof of process liveness or external effects. Preserve the plan, unfinished repair batch, finding dispositions, and repair count. Reuse evidence only for the relevant unchanged revision and scope; code changes invalidate affected evidence. The helper conservatively invalidates whole-snapshot evidence on any HEAD/diff/untracked-file change; reuse narrower evidence only after independently establishing that its coverage is unchanged and recording that justification.

Resume the same run rather than initialize another attempt. Prove a previous owner absent/released before taking over; a helper lock does not enforce editor/process isolation. Cross-check portable claims and actual workers before starting. Stop on duplicates, malformed state, branch/base drift, or unresolved ownership. After a helper crash, inspect `.pi/tickets/.writer.lock/owner.json` and prove its process absent before separately removing that exact stale lock; never delete ticket state to get unstuck.

Reconcile pending external writes by rereading the authoritative surface first. Retry once only after proving the effect absent and confirming it remains authorized and safe. Do not repeat confirmed writes or reset consumed repair cycles. Inspection-only requests do not authorize state writes or takeover.
