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
