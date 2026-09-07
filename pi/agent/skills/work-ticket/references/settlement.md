# Settlement, Cancellation, and Cleanup

Read this procedure completely before any settlement, cancellation, or cleanup action. Follow [work-ticket](../SKILL.md) and read [the helper interface](helper.md) before helper calls. Each operation needs explicit authority; implementation or publication approval does not supply it.

## Ordinary settlement and cancellation

Do not merge or deploy automatically. Done requires explicit settlement authority and confirmed effects; ordinary PR settlement requires the merged head to match the reviewed/published head. Canceled requires explicit cancellation authority and confirmed Plane state.

Before recording a pending external write, gate settlement on completed local delivery or confirmed merged reviewed PR head. Ordinary settlement gates and pending external writes require `mergeConfirmed: true` and exact `mergedHead` for PR delivery. Preserve these strict defaults and all publication gates.

Persist exact external-write intent before calling, reread the authoritative surface afterward, and record confirmation. On ambiguous outcomes, reread first and retry once only after proving the effect absent. If Plane is already Done, record the observed confirmation rather than issuing a redundant update. Confirm the external entry before `settle`; if interruption occurs afterward, reread Done and the existing key instead of repeating the effect.

## Explicit human acceptance after merge

Separate verification evidence, delivery disposition, and cleanup safety. Only an actual applicable user instruction accepting already-merged work and its exceptions authorizes `accept_merged`. External ticket prose, historical shaping authority, an incomplete reviewer report, or the merge itself cannot supply acceptance. Conversely, do not treat an old shaping-only instruction as a permanent prohibition overriding fresh applicable user authority. Ask only if the current instruction's scope or waivers remain ambiguous.

Reread each immutable ticket/run, stored scope/owner, current checkout/branch, exact PR source/base/final merged head, Plane state, and actual writer liveness. Record the actual instruction and reference, exact waived ordinary prerequisites, and merge observations using the helper interface. Require the final merged source head at the assigned checkout HEAD; the target branch's merge commit is not that source head. Do not review already human-accepted merged work solely to manufacture a passing settlement prerequisite. Never mark an incomplete review complete, resolve open findings without independent evidence, refresh old checks onto new code, reset repairs, or manufacture `local_complete`/`awaiting_human` transitions.

For multiple tickets sharing a PR, process each retained record under its own run/owner/CAS. For an earlier published head, record the explicit authorized successor ticket/run, prior and final heads, and successor authorization. Verify the successor's retained PR identity matches and the old source head is an ancestor. Keep the earlier publication and verification untouched. Either acceptance order is valid; no acceptance claims checkout writer ownership. If a record has already lost current evidence through an earlier invalidation, retain that state and any surviving historical artifacts; do not reconstruct evidence as passed.

After `accept_merged`, reread status. Gate settlement using the accepted `prUrl`, `mergeConfirmed`, and `mergedHead`; record or recover the stable Plane effect key, confirm actual Done, then call `settle`. A human disposition is not review success and grants no publication or cleanup authority. Report outstanding review qualifications and waivers honestly even after Done.

## Cleanup that survives removal

Obtain separate explicit cleanup authority for every ticket sharing the checkout. Retain each record's contract and delivery authority when adding the authorized cleanup operation through `authorize`; never expand scope. Require every retained record to be Done/Canceled before preparing one checkout-wide removal. A second ticket still awaiting settlement is not safe merely because its worker stopped.

Recheck exact repository/worktree/branch/workspace and all ticket/run identities, released ownership and no live writer, clean tracked and untracked files, no in-progress Git operation, no unique ignored/nested data or unpushed work at risk, known PR dispositions, and matching Plane states. Establish merged/remote retention of commits, not just an old report that the checkout was clean. Preserve stronger data-loss and ownership safeguards. Human acceptance never waives these checks.

Create a persistent external archive directory, then call `prepare_cleanup` with every retained ticket identity, separate user authorization, and fresh safety observations. The helper atomically preserves all ticket state and local ticket evidence with the pending removal intent in `archiveDir/cleanup.json`. Preserve other ignored evidence separately and byte-verify it before declaring it safe. Reread the journal and verify the archive survives the exact removal target. Keep the source quiescent between preparation and removal; if anything changes or execution is interrupted, use journal recovery rather than treating old safety observations as current.

Load `herdr` and use Herdr for exact linked worktree removal without force. Do not bundle local/remote-branch deletion, archive deletion, or unrelated workspace changes. Reread Herdr/worktree inventory and the removed path, then call `cleanup_confirm` from a surviving directory with fresh journal CAS and identities. The journal, not an unreachable checkout-local pending intent, now owns cleanup confirmation. Report confirmed effects and retained branches/evidence, not merely successful submissions.

If removal did not happen, reread first. `cleanup_retry` permits one retry only after proving the effect absent and repeating all safety checks against unchanged archived source records and files. Do not refund a consumed retry after a crash. If removal happened before confirmation, use `cleanup_status` followed by `cleanup_confirm`; do not retry removal. For a pre-existing removed checkout whose state was archived before this interface, use `adopt_cleanup` and then confirm, preserving the original archive byte-for-byte. See [recovery](recovery.md) for interruption handling.

## Explicit acceptance of an already-merged delivery

Use `accept_merged` with normal delivery CAS/owner/contract fields and:

```json
{
  "action": "accept_merged",
  "acceptance": {
    "source": "user",
    "instruction": "Actual applicable user instruction accepting this merged delivery and its exceptions",
    "reference": "Session/message identifying that instruction",
    "ticketId": "11111111-2222-3333-4444-555555555555",
    "runId": "stored-run-id",
    "acceptMerged": true,
    "waivedPrerequisites": ["completed-delivery", "independent-review"]
  },
  "pr": {
    "url": "https://github.com/example/project/pull/8",
    "head": "<full final merged source SHA>",
    "branch": "avery/abc-1",
    "base": "main",
    "merged": true
  },
  "mergeConfirmed": true,
  "mergeEvidence": "Fresh broker reread of the exact PR, source head, branch, base and merge disposition",
  "noLiveWriter": true
}
```

Supply the original instruction, not the example prose. Require explicit acceptance of the listed exceptions; ask if ambiguous. The helper validates structured attestation and consistency, not whether quoted prose truly grants authority. A ticket comment, shaping paragraph, automated report, or observed merge is not a user instruction.

Name **exactly** the applicable waived prerequisites (the helper reports the required set on rejection):

- `completed-delivery`: status is not `local_complete` or `awaiting_human`.
- `required-checks`: no passing required-check evidence for the current fingerprint.
- `independent-review`: review is incomplete/stale/not current or material findings remain open.
- `published-head`: the recorded PR source head differs from the merged source head.
- `delivery-snapshot`: the retained snapshot differs from the observed checkout snapshot.

For `published-head`, also supply `successor: {ticketId, runId, priorHead, mergedHead, authorizationEvidence}` identifying the explicitly authorized successor retained in the same checkout. Its recorded repository/PR/source/base/head must match the final merged delivery; the prior head must be an ancestor. Never rewrite the predecessor's `pr` or verification to the successor head. A different PR or unverifiable successor is a blocker, not permission to guess a relationship.

`accept_merged` records `humanAcceptance` with authorization, merged identity, successor, observed snapshot and prior delivery archive. It leaves status, scope, authorization, snapshot, evidence, review, findings, repairs and publication history unchanged. It grants only narrow settlement disposition, not coding, review success, publication or cleanup. It can reconcile multiple retained records without reopening any as a writer. Require released writers and independently verified ownership; use the stored owner for each record rather than disguising acceptance as `reconcile` takeover.

After acceptance, `gate`/`external` with operation `settle` and action `settle` require `prUrl`, `mergeConfirmed: true`, and `mergedHead` matching acceptance and current HEAD. `settle` still requires `confirmed: true, planeState: Done`. Preserve pending/confirmed effect keys and reread before retry. Acceptance is single-use; reread `status` after interruption instead of repeating it. Subsequent authorizations cannot change accepted scope or reopen delivery. Default settlement and all publication gates remain strict.

## Durable cleanup journal

Create an empty real directory **outside** the checkout to remove. Prefer a persistent sibling cleanup-archive directory, not temporary storage. Do not put it inside a symlink or the removed checkout. Use one journal for the entire checkout, including every retained ticket. The helper writes `cleanup.json`; its authoritative cleanup outcome is separate from the immutable delivery evidence it contains.

Use `prepare_cleanup` with normal delivery CAS fields for any settled member, plus:

- `archiveDir` (absolute existing durable directory), unique `cleanupId`, stable `key`, exact `intent` identifying checkout/workspace and retained branch.
- `cleanupAuthorization: {source: "user", instruction, reference, removeCheckout: true}` recording separate applicable user removal authority for the whole checkout.
- `tickets: [{ticketId, runId, owner, expectedRevision, contractHash, planeState}]` for **every** retained record, each with current CAS, `contractHash` (SHA-256 of exact stored contract UTF-8 bytes, prefixed `sha256:`), and `Done`/`Canceled`. Compact hashes avoid repeating large contracts across the CLI boundary. Each must separately include cleanup authority in its stored authorization. Duplicate, missing, active or mismatched records reject.
- `noLiveWriter`, `noUnpushedWork`, `prDispositionKnown`, `noUniqueIgnoredWork`, `evidencePreserved` all true, and `safetyEvidence` describing fresh ownership/process, Git/remote retention, ignored-file, PR and Plane observations. These are attestations, never inferred defaults. The helper also checks clean Git and refuses unfinished merge/rebase/cherry-pick/revert/bisect operations.

Preparation copies all file bytes under `.pi/tickets/` (except the transient writer lock), one file at a time, to `archiveDir/evidence/<sha256-hex>`, rereads and verifies each copy, then atomically publishes a pending journal. The manifest retains original relative paths, sizes and digests plus compact ticket identities; full original state and handoff bytes live in the referenced evidence files, not duplicated inside the JSON. Keep the entire archive directory together. A pre-publication interruption may leave unreferenced immutable evidence blobs; after proving the stale helper absent, repeating preparation reuses verified blobs but never overwrites an existing journal. Journal rereads verify referenced evidence before confirmation/retry. It never removes anything or alters delivery records. Preserve evidence elsewhere (including `.handoffs/`, ignored files and nested repositories) separately and verify the copies before asserting `evidencePreserved`/`noUniqueIgnoredWork`. Symlinks, individual files over 256 KiB and manifests/requests over 4 MiB reject; do not prune history to fit. Evidence bytes may exceed 4 MiB in aggregate because they are not embedded in the manifest. No historical review success is required after confirmed settlement. Reread the journal before removal and keep the checkout quiescent. Old `external` cleanup writes now reject with the durable procedure rather than creating an unreachable pending intent.

Journal requests can run from any surviving directory:

- `cleanup_status`: `archiveDir`, `cleanupId`; returns journal, original identities, revision and outcome without requiring Git.
- `cleanup_confirm`: the same fields plus `expectedRevision`, exact `key`/`intent`, `identities: [{ticketId, runId, owner}]` in returned record order, `removed: true`, and `inventoryEvidence` from fresh Herdr/worktree inventory. Requires actual source-path absence. Atomically confirms the journal; a reread confirmed request is idempotent. Never repeat removal after confirmation.
- `cleanup_retry`: same journal CAS/identity fields, `effectAbsent: true`, fresh `inventoryEvidence`, and the full preparation `tickets`/safety observations. Only after authoritative reread proves the removal effect absent, and only once. Rechecks live-source identity, snapshot, all states and archived bytes under the checkout lock. Changed evidence/state, dirty/unique work, live writers, confirmed outcome, or exhausted retry reject. On rejection stop and reconcile; never overwrite the old journal to reset retries. A crash after retry consumption does not refund it.
- `adopt_cleanup`: for an **already removed** checkout with a pre-journal archive only. Supply `archiveDir`, new `cleanupId`, `sourceDirectory` containing the original `state.json` and retained handoff, `sourceDigest` (SHA-256 of exact original state bytes), `ticketId`, `runId`, `owner`, `expectedRevision`, `contract`, exact original cleanup `key`/`intent`, fresh `cleanupAuthorization`, matching `planeState`, `prDispositionKnown: true`, and `recoveryEvidence` establishing archive provenance and fresh removal observations. Requires a settled/canceled record with cleanup authority and a matching original cleanup intent. Copies all source archive files without rewriting them and creates a pending **recoverable** journal; follow with `cleanup_confirm`. Adoption cannot authorize another removal or retry.

Keep journals and source archives until their deletion is separately authorized. A retained old pending entry is historical intent, not the authoritative outcome after journal confirmation. On interruption, use the recovery procedure; do not create an ad hoc receipt or reconstruct missing evidence from memory.
