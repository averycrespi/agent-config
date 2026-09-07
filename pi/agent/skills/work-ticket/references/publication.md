# Authorized PR Delivery

Follow [work-ticket](../SKILL.md) and [the helper interface](helper.md). Require explicit push/PR authority. Use broker-backed remote Git/GitHub operations with discovered schemas. Resolve the authoritative target tip and complete outgoing range; preserve pre-existing local commits and block before publishing unrelated history. Use a separate source branch with the repository's naming convention and verify tracking rather than assuming it.

## Publication after local completion

For an explicit push/PR request on an unchanged local completion, reconcile ownership under [recovery](recovery.md) if necessary, then use `begin_pr`. No fresh coding request is needed. Include common CAS/hash fields plus:

```json
{
  "action": "begin_pr",
  "cwd": "/absolute/repository/root",
  "ticketId": "11111111-2222-3333-4444-555555555555",
  "runId": "stored-run-id",
  "owner": "current-reconciled-owner",
  "expectedRevision": 34,
  "contractHash": "sha256:<64 hex digits from the receipt>",
  "publicationEvidence": "Actual user request to push and open a PR",
  "fingerprint": "sha256:<64 hex digits from a fresh snapshot>",
  "observations": "Fresh ticket/files/Git/PR/checks/ownership observations",
  "planeState": "In Progress",
  "noPrConfirmed": true
}
```

Require unchanged completed snapshot and contract, clean separate source branch, no actual/recorded PR, no prior PR transition, no competing writer, and confirmed implementation-only external history. Current and delivery-time implementation/commit authority must both exist; later authorization cannot retroactively supply missing delivery-time permission. For old records lacking `completionAuthorization`, independently establish the retained authorization's provenance; stop on conflict rather than inventing history.

The operation archives the prior delivery in `prDelivery`, adds publish authority, drops settlement/cancellation/cleanup authority, and returns active. It preserves history, findings, ownership, and consumed repair allowance. It performs no external write. Use the returned receipt; after interruption recover active state rather than repeating `begin_pr`.

**Reevaluate evidence for the expanded boundary.** Transition clears current checks/safety/CI and stales review even at unchanged HEAD. Historical local evidence remains in the archive; obtain or explicitly justify applicable check coverage and perform a new scope-aware initial review, including newly required qualifications. Local completeness never certifies remote/native/release requirements. Publication does not add repair cycles or authorize new coding scope.

## Publication gates

1. Require a clean tree, correct source/base identity, and passing applicable required checks. Inspect the complete outgoing commit history, messages, paths, and patches—not only the final diff.
2. Prepare public-safe PR metadata. Require installed `gitleaks`; inspect its help and scan complete outgoing history and exact proposed title/body, with redaction where supported. Check repository public-content rules for private details, credentials, proprietary content, state/handoffs, local paths, and personal data.
3. Stop before push if scanning is unavailable, fails, finds secrets, or cannot cover the evidence. Deleting a secret in a later commit does not remove it from history; history repair needs explicit authority. Record `evidence` with `kind: safety`, current `fingerprint`, `passed`, concrete `summary`, `historyScanned`, `metadataScanned`, and `publicContentChecked` all true, and `metadataHash` (SHA-256 of exact title/body bytes).
4. Gate `publish`, persist exact external intent, then push only the assigned branch (with tracking for a new branch) and create/update one draft PR. Reread head/source/base/open/draft and scanned metadata. Record `publication` with `pr: {url, head, branch, base, open: true, draft: true}`, `confirmed: true`, matching `metadataHash`.
5. Obtain independent review and required CI for the final published head. Record CI `evidence` with current `fingerprint`, exact `head`, `passed`, and `summary`. Pending CI means waiting; failed/unknown CI, missing applicable evidence, or unresolved blockers prevent promotion. Review limitations outside this boundary stay visible without becoming blanket waivers. Republished changes need affected checks and focused review unless scope expanded.
6. Gate `promote`, mark ready, and reread exact PR identity. Move Plane to Review only after review and required CI pass; reread Plane. Record `handoff` with `summary`, confirmed non-draft `pr`, `confirmed: true`, and `planeState: Review`.

For every remote write, persist a stable key and exact intent before execution, reread the authoritative surface afterward, and record confirmation. On ambiguity, reread first and retry once only after proving the effect absent. Never duplicate a confirmed PR/claim or present local evidence as remote confirmation. If repairs are exhausted, obtain evidence or report blockers; do not silently extend the allowance.
