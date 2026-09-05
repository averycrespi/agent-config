# Authorized Review Repair

Read completely before a repair batch. Follow [review](../SKILL.md): retain the full authoritative report and present its findings before editing. Repair requires existing user/task authority or explicit approval; material scope changes still need authorization.

For ticket work, load [work-ticket](../../work-ticket/SKILL.md) and its helper interface. Persist `begin_repair` before editing, retaining findings, dispositions, and the run-wide two-cycle allowance. One consolidated review followed by one repair batch consumes a cycle. Do not reset consumption on interruption or count ordinary implementation/test iteration as review repair.

For non-ticket work, use at most two authorized repair batches and retain the count and original report in the existing task continuity record. If durable recovery evidence is unavailable after interruption, stop rather than assume a fresh allowance. Do not create a new orchestration system or require a new request for each already-authorized bounded batch.

Repair consolidated blockers only within authorized scope, in the owning session. Rerun affected and repository-required checks, then invoke `reviewMode: confirmation` using [the input contract](workflow-input.md) with earlier blockers/report, dispositions, changed revision, and repair-touched boundaries. Confirmation checks original blockers, affected boundaries, and repair-induced regressions—not unrelated fresh improvements. Preserve unresolved findings. After two cycles, stop with a blocked handoff and remaining blockers; exhaustion never means approval.
