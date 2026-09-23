# Coordination index

Keep one local untracked Markdown file at `<resolved-git-common-dir>/pi-repo-coordination/<id>.md`. Resolve through Git, verify outside tracked content, and protect private records. Do not commit runtime identities, transcripts or credentials. Inspect existing indexes/stack records and workers before initialization; no automatic adoption. The sole coordinator writes it; children own their checkpoints. This index is a recovery aid, not a lock or hard fence.

## Fixed sections

Omit empty sections and retain this order:

| Section             | Contents                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner and authority | Repository/common-dir identity; exact coordinator/session and ownership disposition; operating agreement/exclusions once with readable actual instruction and explicit handover authority references |
| Decisions           | Cross-task decisions and rationale/evidence references only                                                                                                                                          |
| Assignments         | One row per stable assignment ID/revision, brief, exact worker identity/child checkpoint, dependencies, accepted result; optional derived last-observed disposition/question/next summary            |
| Mailbox             | Explicit address plus incorporated report/message IDs and durable question/answer/provenance/relay state; no ack before persistence                                                                  |
| Unresolved control  | Only pending launch/continuation/pause/control intent, exact target and confirmation still required                                                                                                  |
| Observation         | Observer membership, per-worker coverage/receipt references, shared parent-supervision accounting, unresolved registration/coverage gaps                                                             |
| Next                | Assignment/project, actor and concrete next action                                                                                                                                                   |

The brief owns criteria, task-specific authority and checkout/base; do not mirror them into every artifact. Child checkpoints own progress, full question artifacts, execution/CI budgets and evidence. The project record owns recoverable pending-question references and identity, announcement references, actual answer provenance, answered-awaiting-relay and uncertain application state. Accepted results retain exact revision plus evidence/release references, not copied checklists. Completed rows remain readable by reference; no archival subsystem or routine loading of completed reports. Durable references must identify an absolute readable artifact or retained session path plus exact entry/tool-call ID, not “previous conversation”. If a source may expire, retain its original bytes in the existing persistent artifact area before replacing detail. Preserve adverse evidence, superseded authority and unresolved effects without arbitrary byte caps.

```markdown
# Coordination example

## Owner and authority

Repository/common dir: <exact identity>; owner: <session>, active
Agreement/exclusions: <actual instruction reference>; handover: <none or explicit authority>

## Assignments

| ID/revision | Brief           | Worker/checkpoint                                   | Dependencies | Accepted result | Observed (derived)                               |
| ----------- | --------------- | --------------------------------------------------- | ------------ | --------------- | ------------------------------------------------ |
| task-a/1    | <absolute path> | <session/incarnation; Herdr pane/agent; checkpoint> | none         | not accepted    | decision needed, request <reference>, human next |

## Mailbox

Address: project-example; incorporated report IDs: <durable identities>
Questions: <request/assignment/worker/context and artifact; unanswered or answered-awaiting-confirmed-relay; provenance and intent references>

## Observation

Membership/coverage: <group → exact assignment/revision/session/incarnation; receipt reference>
Accounting: <shared supervision JSON, stored here once>
Gaps: <affected members and uncovered interval/reference>

## Next

task-a: human answers <request handle>; task-b: owner continues authorized work
```

## Write boundaries

- Update changed assignment, scope/authority, ownership, unresolved decision/blocker or accepted result. Store details only at their owning source.
- Persist consequential effect intent **before** execution. Resolve it **after** authoritative confirmation and keep a durable confirmation reference. Never combine these into an after-the-fact write.
- On routine attention update only changed coverage/accounting or recovery facts. Host receipt persistence is mandatory mechanical bookkeeping, not a request to narrate child progress.
- A status-only query with unchanged facts produces **zero writes**, even if read tools ran. Ordinary child tests/progress produce no coordinator write.
- Combine changes known at one safe boundary. Keep uncertainty even when the record becomes longer. A wake or turn alone is not a checkpoint boundary.

## Small persistence helper

Use `node <absolute-skill-path>/scripts/index.js` with one quoted JSON object on stdin. `action: status`, `cwd`, `id` returns path/text/digest without creating anything. `action: replace` also requires the previously read `expected` SHA-256 digest (`null` only for a new file) and `values`, an object mapping the fixed section names to Markdown bodies. It validates all sections, rejects symlinked storage, fsyncs staging bytes, atomically replaces changed bytes with mode 0600, then fsyncs the directory, and returns `written: false` for identical content. No byte quota discards required facts. Keep one cooperative writer: comparison detects intervening edits but is not a cross-process lock. Conflicts/corruption require reconciliation, not overwriting with a new expected value blindly.

Store the pure `scripts/reports.js` result `{address, reports, questions}` as JSON in Mailbox. Initialize empty maps only for a genuinely new project after reconciliation. `incorporate` validates against exact assignments and returns candidate state plus IDs safe to ack **only after persistence succeeds**; it does not accept results or execute effects. `answerQuestion` records validated answer provenance; `relayIntent` marks uncertainty before Herdr submission and rejects another relay. Matching child resolution reports close the question. Retain report identities to deduplicate inspection after coordinator failure between state persistence and ack. If index write outcome is uncertain, reread/reconcile it before ack; never treat an exception as proof of absence. Helpers validate correlation, not authentic human authority or evidence truth.

Only call replacement at the boundaries above; no-op support is not permission to invoke it every turn. The helper knows nothing about human authority, child liveness or delivery truth. It creates no journal, auto-migration or second child state machine.

## Child coordination section

Use the existing child record, not a parallel ledger. Work-ticket's optional `coordination` patch uses:

```json
{
  "assignmentId": "task-a",
  "revision": 1,
  "disposition": "decision needed",
  "pendingRef": "/absolute/child-owned-request.json",
  "nextActor": "human",
  "furtherWrites": false
}
```

`furtherWrites` reports whether the owner may still write, not whether its process merely looks idle. A blocked owner retains ownership even when false. Generic checkpoints use the same section. `working`, `decision needed`, `result offered`, and `stopped` are coordination dispositions, not universal task phases. Pending questions/results require a reference; other dispositions may use null. Do not clear unresolved requests to hide cancellation. Preserve resolution/provenance at the child-owned reference before changing the section.
