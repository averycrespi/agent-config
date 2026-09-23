# Stack checkpoint

Use the [shared coordination index](../../coordinate-repo/references/index.md), with one coordinator and child-owned ticket checkpoints. Keep the mailbox address, incorporated report IDs, questions/answer provenance, uncertain control and supervision allowances there. Use the shared atomic persistence helper; no separate stack delivery ledger or migration machinery.

## Compact template

Retain stack-specific policy in Decisions and assignment rows:

- Exact ordered project/ticket UUIDs and canonical criteria references; user authority, boundaries and exclusions.
- Initial target/base SHA and dependency reconciliation.
- For each ticket: assignment ID/revision, branch/worktree/Herdr identity, child checkpoint, predecessor identity, separate creation SHA and PR target.
- Accepted exact head, incremental-review/cumulative-test references, target-applicable CI and release/quiescence evidence; retain honest exceptions without copying child check inventories.
- Current position and next actor/action. At most one executing ticket child.

Observation uses shared retained absolute deadline, wake attempts/reservations and actual receipt references. Answers, successor launches and replacements do not reset project-wide allowance. Children own their CI/repair counters. Consequential effects retain before-effect intent and after-confirmation evidence separately. Routine unchanged status writes nothing; accepted tickets remain reference-first rows rather than wake journals.

For existing stack records, explicit manual cutover must reconcile the original record, active child, pending questions/control, originating observers and retained budgets before using new mechanics. Keep original bytes as evidence; do not infer fresh authority, discard uncertainty or automatically rewrite/import legacy records. Takeover requires the shared explicit authority and former-owner reconciliation.
