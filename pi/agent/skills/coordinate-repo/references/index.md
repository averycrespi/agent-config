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

Use `scripts/index.js` as the canonical reader/parser/writer; never extract sections with handwritten regexes or line splitting. The module exports `parseIndex(text, expectedId)`, `renderIndex(id, values)`, `readIndex(cwd, id)`, `updateIndex(request)` and `persistIndex(request)`. Read returns `{id, path, text, values, digest}` (`text`, `values`, `digest` are null only for an absent file). Parsing preserves complete Markdown bodies, including multiline prose, tables, JSON and authority/receipt references. It rejects unknown, duplicate, unordered, missing required or malformed sections and conflicting title identity instead of repairing or dropping facts. Use the fixed heading order and blank-line delimiters shown above; noncanonical input requires reconciliation. A structurally valid record already truncated by an old caller cannot be detected semantically: reconcile against original evidence, never invent lost facts.

Prefer partial updates: `updateIndex({cwd, id, expected, changes, attemptId})` reads/parses the existing record and changes only named sections. Omitted keys preserve their complete contents; explicit `null` removes an optional section. Empty strings and deletion of required sections reject. Supply the exact previously read SHA-256 `expected`; stale state rejects without retry. Use `persistIndex({cwd, id, expected, values, attemptId})` for new records (`expected: null`) or an intentionally complete snapshot. Both validate before replacement and confirm the resulting receipt against intended identity/path/base/digest and an independent exact-byte readback. They return `{id, expected, attemptId, path, digest, written, confirmed: true}` only after confirmation. The lower-level `replaceIndex` returns an **unconfirmed** receipt; it is not the effect gate.

The writer rejects symlinked storage, fsyncs staging bytes, atomically replaces changed bytes with mode 0600, then fsyncs the directory; identical content returns `written: false`. No byte quota discards required facts. Keep one cooperative writer: comparison detects intervening edits but is not a cross-process lock or hard fence. Conflicts/corruption require reconciliation, not overwriting with a new expected value blindly.

### Confirm before effects

Before consequential worktree/workspace creation, process start, observer registration, prompt/control submission or mailbox ack, require validated durable persistence confirmation of the exact intended state. Exit zero, empty output, an unchecked `confirmed` flag, old receipt, or shell `&&` is insufficient. Allocate a fresh `attemptId` (1–128 ASCII letters/digits/underscores/hyphens, e.g. a UUID) for each new persistence attempt and retain it with the exact request and effect intent in the existing caller-owned record before dispatch. Validate against that independently retained ID, never one copied from the response. Retain original identity on uncertain completion; generating a new ID never authorizes replay. Before any effect, inspect retained effect provenance and reconcile whether it was already submitted/completed. Confirmation is repeatable read-only evidence inspection, **not** a fresh-attempt assertion, an authenticated receipt or a one-use effect permit. A matching fabricated response is not trustworthy provenance even when readback matches. Prefer the imported API so validation/readback failure throws before the effect:

```js
const current = await readIndex(cwd, id);
// Inspect exact owner, authority and base from current.values first.
const saved = await updateIndex({
  cwd,
  id,
  expected: current.digest,
  attemptId, // Independently retained with this exact intent before dispatch.
  changes: { "Unresolved control": exactIntent },
});
// Only now perform the separately authorized effect once; retain saved as evidence.
```

For a subprocess use `node <absolute-skill-path>/scripts/index.js` with quoted JSON on stdin. Entry detection supports installed-style symlink paths without changing the live installation. `action: status` returns the canonical read result; `replace` takes `expected`, `attemptId` and complete `values`; `update` takes `expected`, `attemptId` and `changes`. All responses are `{result: ...}`. Retain the intended complete values (merge changes into the canonical read values, deleting only explicit null keys), the original base and the actual stdout. Call `confirmIndexResponse({cwd, id, expected, values, attemptId}, stdout)` in the owning process before the effect. It parses the response, validates receipt identity/attempt/path/base/digest and independently reads back those intended bytes. Alternatively `action: confirm` accepts the same intended request and the raw stdout string as `response`; inspect its structured confirmed result, not merely its exit code. Never chain a consequential shell command to an unchecked helper invocation.

On missing/malformed output, write/readback failure or interruption, block the effect and retain uncertainty. Inspect current canonical state and original intent/receipt before proceeding; **never replay a possibly successful write automatically**. Readback qualifies persisted bytes, not ownership, authority, semantic completeness or future exclusivity. Preserve exact-base/worker checks and the separately authorized effect's own confirmation.

Store the pure `scripts/reports.js` result `{address, reports, questions}` as JSON in Mailbox. Initialize empty maps only for a genuinely new project after reconciliation. `incorporate` validates against exact assignments and returns candidate state plus IDs safe to ack **only after validated persistence confirmation and readback**; it does not accept results or execute effects. `answerQuestion` records validated answer provenance; `relayIntent` marks uncertainty before Herdr submission and rejects another relay. Matching child resolution reports close the question. Retain report identities to deduplicate inspection after coordinator failure between state persistence and ack. If index write outcome is uncertain, reread/reconcile it before ack; never treat an exception as proof of absence. Helpers validate correlation, not authentic human authority or evidence truth.

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
