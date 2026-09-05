# Authorized PR Delivery

Read this procedure completely before preparing or performing PR publication or promotion. Follow the authority and continuity rules in [work-ticket](../SKILL.md) and read [the helper interface](helper.md) before helper calls. This procedure grants no publication authority.

## Publish an unchanged local completion

When the user explicitly requests push/PR delivery after local handoff, use `begin_pr` rather than invent a fresh coding request, reinitialize the run, call `reopen_local`, or edit state directly. `authorize` alone remains insufficient to leave completion. Reread the current helper status and snapshot; inspect actual ticket/Git/PR/owner state and relevant verification/review coverage. Require the same sole owner, unchanged approved scope and completed snapshot, clean separate source branch, Plane In Progress, no actual or recorded PR, and confirmed implementation-only external history. Stop on drift, unresolved writes, or ownership conflicts; this narrow transition cannot take over an owner or reopen PR/Done/Canceled delivery.

Send one JSON request on stdin to `node <absolute-skill-path>/scripts/ticket-state.js`:

```json
{
  "action": "begin_pr",
  "cwd": "/absolute/repository/root",
  "ticketId": "11111111-2222-3333-4444-555555555555",
  "runId": "stored-run-id",
  "owner": "stored-owner-id",
  "expectedRevision": 34,
  "contract": "Exact stored approved baseline, unchanged",
  "publicationEvidence": "Actual user request: push and open a PR, then monitor required CI",
  "fingerprint": "sha256:<64 hex digits from a fresh snapshot>",
  "observations": "Fresh ticket/files/Git/PR/checks/owner observations, unchanged completed snapshot and scope; prior checks/review remain relevant",
  "planeState": "In Progress",
  "noPrConfirmed": true
}
```

Replace example values with freshly observed values, not historical revision numbers. Both delivery-time and current implement/commit authority are required and retained for the existing scope; only publication authority is newly requested. The operation drops settlement/cancellation/cleanup authority, archives prior completion as `prDelivery`, and preserves run, owner, assignment, plan, findings/dispositions, local follow-up history, external-write keys, and consumed repairs. It sets boundary `pr` and status `active`, increments revision once, and performs no push or other external write. It also accepts an already recorded PR authorization on `local_complete` when all other conditions hold, without requiring a second `authorize` call.

The helper stores `completionAuthorization` at local handoff and preserves it across terminal `authorize` calls; `prDelivery` retains that delivery-time authority separately from the latest pre-transition `authorization`. A real `reopen_local` clears this marker so the next local handoff records its own authority. For older records without the marker, the helper captures existing authorization before the first terminal mutation. Independently establish that this legacy authority matches the completed delivery; the helper cannot reconstruct authority overwritten by an older helper. Stop if that historical evidence is unavailable or conflicting rather than adding post-handoff commit authority to satisfy the prerequisite.

Reread status after success. Passing verification and existing review remain revision-bound and reusable only for unchanged relevant scope; missing/stale/incomplete review still blocks promotion. Safety and CI evidence are always cleared: perform fresh outgoing-history/metadata scans and record required exact-head CI after publishing. Use checkpoint to record publication progress or CI waiting; after interruption use ordinary recovery, not another `begin_pr`. Exhausted repair consumption remains exhausted: monitoring CI or obtaining review does not consume a repair, but a newly discovered blocker still cannot trigger a third automatic review-repair cycle. Handoff remains blocked until all required evidence passes. No new coding scope, merge, deployment, settlement, cancellation, or cleanup is authorized by this transition.

## Publication gates

Before any push, preserve the fail-closed publication-safety gate:

1. Require a clean tree, correct source/base identity, and passing required checks. Inspect the **complete outgoing commit history**, every message, path, and patch—not only the final diff. Include all commits that would be published, including pre-existing outgoing history.
2. Prepare a public-safe PR title/body. Require locally installed `gitleaks`, inspect its installed help, and successfully scan the complete outgoing history and proposed PR metadata, with redaction where supported. Check the same evidence against repository public-content guidance: no private organizations, projects, teams, URLs, credentials, proprietary content, tracked handoffs/state, local paths, personal data, or non-generic examples.
3. If the scanner is unavailable, errors, cannot cover the scope, reports findings, or evidence is oversized/uncertain, **stop before push**. Removing a committed secret in a later commit is insufficient; history repair requires explicit authorization. Record the scan commands/results and hash of the exact scanned title/body as safety evidence.
4. Gate publication through the helper, record the intended external write, then use broker-backed operations to push only the assigned branch with tracking for a new branch and create/update one draft PR. Reread and confirm exact head, source, base, open/draft status, and scanned metadata before recording publication. Never copy raw Plane comments/URLs, local state, paths, or workspace IDs into public metadata.
5. Obtain independent review and required CI for the final head. Pending CI means wait and record the next action, not completion. Failed/unknown/ambiguous required CI blocks promotion. Reuse passing evidence only for unchanged relevant state; republished changes require affected checks and focused review.
6. Gate promotion, mark the PR ready, then reread exact head/source/base/open/non-draft identity. Move Plane to Review only after independent review and exact-head CI pass, reread Plane, and record the handoff. Never promote with unresolved blockers or incomplete required checks.

For every external write, persist a stable key and exact intent before calling, then reread the authoritative surface and record confirmation. On ambiguous outcomes, reread first; retry once only after proving the effect absent. Reconcile pending entries after interruption. Do not repeat a confirmed write, create a second PR/claim, or present local evidence as remote confirmation.
