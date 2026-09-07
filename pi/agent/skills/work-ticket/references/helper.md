# Ticket State Helper

Read this common interface before using `node <absolute-skill-path>/scripts/ticket-state.js`. Send one JSON request on stdin; never interpolate ticket prose into shell arguments. Responses are `{result: ...}` or `{error: ...}` with nonzero exit on failure. A successful mutation returns the committed state and revision: use it as the receipt for the next local request. Reread after interruption, conflict, or uncertain execution, not after every successful mutation. Remote effects always require authoritative observation.

## Common requests

Use absolute repository-root `cwd` and immutable Plane `ticketId` (UUID). `status` reads existing state without mutation; `snapshot` observes Git without updating evidence. After initialization, include `runId`, `owner`, caller-observed `expectedRevision`, and `contractHash` from the latest receipt. The helper never silently refreshes a stale revision. Exact stored `contract` remains accepted instead of its hash for older callers. For an old receipt lacking the hash, use its stored contract until the next mutation returns a hash.

```json
{
  "action": "checkpoint",
  "cwd": "/absolute/repository/root",
  "ticketId": "11111111-2222-3333-4444-555555555555",
  "runId": "stored-run-id",
  "owner": "stored-owner-id",
  "expectedRevision": 4,
  "contractHash": "sha256:<64 hex digits from the receipt>",
  "progress": "Regression reproduced and implementation updated",
  "nextAction": "Run required checks and independent review"
}
```

| Action         | Additional fields                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`         | `identifier`, opaque `runId`/`owner`, `contract` (outcome/AC/scope and evidence requirements), `repository`, `targetBranch`, full `baseCommit`, optional `isolation`, `authorization: {operations, boundary, evidence}`, `plan: [{step, verification, status}]`. Include `implement` and `commit` unless commits were excluded; `publish`, `settle`, `cancel`, `cleanup` need separate authority. Boundary is `local` or `pr`; PR needs commit/publish. |
| `checkpoint`   | `progress`, `nextAction`, optional `plan`, optional `status: active/waiting/blocked` and `blocker` when not active. Optional `reuseEvidence` below.                                                                                                                                                                                                                                                                                                     |
| `authorize`    | Fresh `authorization` and optional `newContract`. With hash CAS, `newContract` changes the baseline; legacy callers can supply new prose in `contract`. Changed scope/boundary invalidates active evidence. Terminal authorization does not reopen delivery or change completed scope; retained evidence remains bound to its original scope.                                                                                                           |
| `evidence`     | `kind: verification/safety/ci`, fresh `fingerprint`, boolean `passed`, concrete `summary`. Verification may opt into `contentIndependent`. See publication for safety/CI fields.                                                                                                                                                                                                                                                                        |
| `review`       | Current `fingerprint`, `independent: true`, boolean `complete`, `summary`, new `findings: [{id, blocking, category, evidence}]`, and `resolutions: [{id, disposition: fixed/not-applicable, evidence}]`. Optionally `contentIndependent`. Retain existing finding IDs instead of resubmitting them.                                                                                                                                                     |
| `begin_repair` | `repairPlan`; consumes a cycle before editing. Requires current consolidated review with open blockers, not necessarily complete review or passing checks. Resume an already-consumed batch after interruption.                                                                                                                                                                                                                                         |
| `gate`         | `operation: commit/publish/promote/settle/cancel/cleanup`; checks stored authority/evidence without performing the operation. Commit gate checks authority, not slice correctness.                                                                                                                                                                                                                                                                      |
| `external`     | Stable `key`, `operation: implement/publish/promote/settle/cancel`, exact `intent`, `outcome: pending/confirmed`, `summary` of observations. Cleanup uses the separate external journal.                                                                                                                                                                                                                                                                |
| `handoff`      | `summary`, `planeState: In Progress` for local. PR additionally requires confirmed non-draft PR identity and Plane Review; see publication.                                                                                                                                                                                                                                                                                                             |

Record incomplete/adverse review evidence even when checks fail. Use the review workflow's structured `complete` result for the current scope; retain its full report and all findings. Complete review is not passing verification, and recording a finding is not delivery approval. Handoff and promotion still require passing applicable checks, resolved blockers, and complete current recorded review.

## Evidence and commits

Record verification against a fresh snapshot after observing command results. Include applicable evidence requirements in the contract. Any active scope/boundary change invalidates checks/review, including local-to-PR transition at unchanged HEAD. Reevaluate newly applicable requirements; do not silently relabel local evidence as full delivery evidence.

By default, HEAD/diff/untracked changes clear evidence and stale review. To reuse across a content-equivalent commit:

1. Set `contentIndependent: true` when recording verification or review only if it is independent of commit metadata. The helper computes a content digest; it does not accept a caller-supplied digest.
2. After committing, inspect hook results and relevant environment/coverage. Use `checkpoint` with `reuseEvidence: {verification: true, review: true, justification: "..."}` selecting only the evidence being reused.
3. The helper requires a clean descendant commit, identical non-ignored tracked/untracked file content and executable modes, matching scope, and opted-in passing/current evidence. It rebinds selected evidence with provenance; safety and CI are never reused this way.

Digest support excludes submodules/special artifacts and files over 16 MiB; rerun checks rather than forcing reuse. Ignored dependencies, external services, Git metadata, and environment are not covered by the digest: the justification must establish unchanged relevant inputs. Stage files by name; a helper gate never replaces staged-diff inspection or required checks. No mandatory commit frequency applies.

## Operation-specific procedures

Read only the applicable procedure before its operation:

- [Recovery](recovery.md): `reconcile`, ownership transfer, `reopen_local`, explicit follow-up repair additions, stale locks.
- [Publication](publication.md): `begin_pr`, safety/CI evidence, `publication`, PR handoff.
- [Settlement and cleanup](settlement.md): `settle`, `cancel`, `accept_merged`, durable cleanup journal requests.

## Storage and limitations

State lives in locally Git-excluded `.pi/tickets/`; initialization installs the exclusion without modifying tracked `.gitignore` and refuses existing attempts/other active owners. All writes are atomic and bounded to 256 KiB; records include append-only delivery and repair history. Never prune history to evade limits. Files are owner-only. No user configuration or separate retained logs.

Cleanup archives and original evidence survive outside the removable checkout, with no automatic deletion; see settlement for sizes and retention. Never include secrets or transcripts. Locks/CAS/atomic rename protect cooperative callers, not hostile processes or every power-loss case. The helper checks consistency, not the truth of authorization, liveness, check results, or remote attestations, and cannot intercept arbitrary shell/broker writes.
