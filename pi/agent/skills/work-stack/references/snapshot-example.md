# Example current stack snapshot

This sanitized three-ticket format is a recovery snapshot, not an accumulating wake log. Replace current values; keep durable instruction/evidence/receipt references. Runtime identifiers below are placeholders, never public delivery metadata.

## Identity and authority

- Stack: example-stack; parent: parent-session (active); repository: example/project.
- Authority: retained-instruction.json; ordered ticket UUIDs and canonical AC: criteria.json.
- Boundary: three serial review-ready PRs; no merge, install, reload or cleanup.
- Initial target: main; exact base: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`; dependencies: dependencies.json.

## Assignments

| Ticket | Child checkpoint | Branch / target   | Creation base / accepted head | Exact child assignment                       |
| ------ | ---------------- | ----------------- | ----------------------------- | -------------------------------------------- |
| A      | ticket-a.json    | avery/a / main    | aaaa… / bbbb…                 | checkout-a; pane-a; session-a; incarnation-a |
| B      | ticket-b.json    | avery/b / avery/a | bbbb… / unknown               | checkout-b; pane-b; session-b; incarnation-b |
| C      | ticket-c.json    | avery/c / avery/b | not assigned / unknown        | not launched                                 |

Use full immutable SHAs in real records; abbreviated cells here are illustrative only. Checkpoints own child progress, check inventories, CI/repair allowances, decisions and adverse findings.

## Observation

- Active child: B; accounting: example-stack-child-b.observation.json.
- Current job: job-b; incarnation: incarnation-b; receipt: receipt-b.json.
- Coverage gap: pre/post-ACK reconciliation reference gap-b.json; no unresolved gap.

## Accepted evidence

- A at `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`: boundary-a.json; original review artifact and fresh CI by reference.
- B and C: no accepted delivery boundary.
- Retained historical instructions/adverse evidence: history-index.json.

## Unresolved control effects

None. When present, retain exact create/start/prompt target, stable effect ID, attempted versus confirmed status, and reconciliation reference until resolved. Do not replace uncertainty with a success label.

## Next

Parent: reconcile the next exact B receipt and current child state; renew only within returned parent allowance. B remains sole implementation owner under its independent delivery authority. Do not launch C before full B boundary qualification and owner quiescence.
