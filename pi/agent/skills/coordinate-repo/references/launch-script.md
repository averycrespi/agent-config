# Coordinated worker launch Script

Use the saved [`launch-worker`](../../../scripts/launch-worker.js) definition for authorized managed launches. It calls the finite host [CLI helper](../scripts/launch-worker.js) through `builtins.bash`; it does not install worker code or introduce a coordinator service. Keep the [shared launch gates](../../spin-out/references/launch.md) and [index persistence contract](index.md) authoritative.

## Prerequisites and ownership

Load Script, Background and Builtins; explicitly select the already-allowed `builtins` provider. Discover its schema first. Install/link configuration only with separate approval. A saved definition or supplied authority reference grants nothing. Review the trusted `helper_path`: it is executable host code, not a sandbox boundary. Keep its revision fixed during a launch.

Require Herdr in the invoking session, inspect its installed CLI, and obtain scoped authority for the brief, workspace/worktree, handoff and ordinary Pi startup. The recipe uses the inspected `workspace/worktree create --no-focus`, `agent start/prompt/wait/get`, `pane list/process-info`, and read-only inventories. Unsupported response shapes fail closed. No remote Git access occurs.

The sole coordinator must serialize **all** index/control writes. Await each phase's terminal receipt before another phase, launch, report incorporation or index update. `maxConcurrency: 1` bounds this Script's calls, not other invocations or processes. Existing compare-and-readback persistence detects stale state but is not a cross-process lock. Never run phases in parallel or use another writer to update coverage while prepare is active.

Use an existing canonical index. The recipe requires `Assignments` as a JSON array and preserves other rows and sections. For a Markdown-table index, explicitly reconcile/convert that section with the canonical helper before launch; there is no automatic migration. `Owner and authority` remains its complete existing body. Require `/.handoffs/` ignore coverage in the common Git exclude file **before** prepare (using the shared launch procedure); the recipe does not race to modify shared excludes. It writes a unique mode-0600 file and refuses collisions and symlinked directories.

## Prepare the assignment

Persist one row with a unique `launchId`, matching `assignmentId`, `revision`, `runId`, and `launchBrief`. Use validated `updateIndex`/readback, not ad hoc Markdown parsing. Preserve unrelated fields. Compute `ownerDigest` as SHA-256 of the exact `Owner and authority` body. `coordinator` is the invoking Pi session UUID (checked against the execution-scoped `PI_SESSION_ID`). Example values below are placeholders, not executable approval:

```json
{
  "assignmentId": "example",
  "revision": 1,
  "runId": "example-1",
  "launchId": "example-launch-1",
  "launchBrief": {
    "kind": "implementation",
    "repo": "/home/user/project",
    "checkout": "/home/user/worktrees/project/avery-example",
    "base": "0123456789012345678901234567890123456789",
    "branch": "avery/example",
    "assignmentId": "example",
    "revision": 1,
    "runId": "example-1",
    "agent": "example-worker",
    "task": "Implement the explicitly approved change.",
    "acceptance": "Observable acceptance criteria and required checks.",
    "constraints": "No merge, cleanup, global installation or live-session changes.",
    "executionAuthority": "Readable exact human instruction reference and scope.",
    "publicationAuthority": "None; local-only delivery.",
    "launchAuthority": "Readable exact scoped launch approval reference.",
    "coordinator": "COORDINATOR_SESSION_UUID",
    "ownerDigest": "SHA256_OF_EXACT_OWNER_SECTION",
    "mailbox": "example-inbox",
    "checkpoint": "/private/example-checkpoint.json",
    "reportingInstructions": "Read the managed decision protocol. Checkpoint then send correlated questions/results to the explicit mailbox; do not edit the parent index.",
    "references": ["/installed/skills/spin-out/references/decisions.md"],
    "bounds": {
      "startMs": 30000,
      "confirmMs": 15000,
      "deadline": 1900000000000
    }
  }
}
```

Resolve `base` to a reachable full commit before persisting. Implementation branches must be new `avery/...` names with unused normalized `$HOME/worktrees/<primary-repo-slug>/<branch-slug>` paths. The recipe preserves source uncommitted changes; make required source reachable before launch. Research uses `kind: "research"`, `checkout` equal to `repo`, and omits `branch`; the shared checkout must be at `base`, and the brief must restrict research to read-only work. Every worker still gets its own workspace.

Provide self-contained task, criteria, authority boundaries and reporting instructions. Include all applicable role/workflow references and child-owned finite delivery/CI policy where relevant; launch bounds are not child repair/supervision allowances. Reference files must exist and be readable. Each phase is capped at 100 seconds of helper work (110-second shell, 120-second Script ceiling); lower host policy wins. `startMs` ≤30 seconds, `confirmMs` ≤15 seconds, and the retained absolute `deadline` cover the complete launch without renewal.

```js
script({
  action: "run",
  execution: "background",
  description: "Prepare authorized example worker",
  name: "launch-worker",
  providers: ["builtins"],
  args: {
    phase: "prepare",
    repo: "/home/user/project",
    index_id: "example-project",
    launch_id: "example-launch-1",
    helper_path: "/installed/skills/coordinate-repo/scripts/launch-worker.js",
  },
});
```

Wait for Background's automatic phase notification, then inspect the exact execution. Check host status/accounting **and** explicit result status. Successful Script execution can return a blocked/failed launch. Background's existing widget and retained results need no new renderer. Neither phase completion nor notification consumption accepts the assignment.

Prepare validates the brief and collisions, persists/readbacks each intent, creates resources without focus, writes/readbacks the ignored handoff, starts ordinary `pi` without native arguments, and records the exact Herdr workspace/pane/terminal, process PID plus start time and reported Pi session path/UUID. Pi may buffer the session file until its first assistant response: a missing file before submission is normal, not evidence of non-delivery. No task is submitted by prepare.

## Attach coverage, then submit

After a `prepared` result, retain `row.launch.worker` and `row.launch.handoff`. Read the managed mailbox protocol and establish availability/coverage yourself. Reuse an active inbox observer; never register a per-worker observer merely for this recipe. Persist these two additions through the canonical helper before submit:

- `row.reporting`: `{mailbox, checkpoint, coordinator, index, handoff, member}` matching the brief and absolute index path. `member` is `assignmentId/revision/sessionId/incarnation` using the returned identity.
- `Observation.launchCoverage[assignmentId]`: `{mailbox, member, reference, receipt}`. `reference` identifies the actual host receipt call; `receipt` is its unchanged active host receipt, with `id`, `createdAt`, `deadline`, `recurring: false`, `maxWakes: 1`, and inbox `coverage`. Preserve `Observation.accounting` from the existing supervision helper, including the matching attached `groups.<group>.pending` reservation. Historical reservation members need not change when adding a new worker to an existing inbox observer.

The coordinator owns receipt provenance, fresh liveness reconciliation and retained allowances. The recipe validates correlation, active/nonexpired timestamps, inbox coverage, reservation/lifetime and remaining attempt/deadline bounds; it cannot authenticate a fabricated receipt or establish that an observer has not stopped since inspection. Never replace receipt fields with evaluator claims. Neither permission nor structural validation establishes approval.

Run the same named definition with `phase: "submit"` and the same other arguments. It rechecks reporting, coverage, unchanged handoff and occupant/session, persists submission intent, sends one path-based prompt, then makes one bounded wait for `done`/`blocked` and inspects the same session. A long-running worker may time out that wait; this does not mean failure. Task-correlated execution requires the exact submitted user prompt in the reported session plus fresh working state or subsequent assistant/tool activity. An editor draft, readiness, prompt acknowledgment, or `done` alone does not qualify. Transcript absence, parse errors or insufficient evidence remain uncertain; no diagnostic prompt is sent.

## Outcomes and recovery

Results are bounded identity/path/status references, not transcripts or task bodies:

- `prepared`: unprompted worker retained; coordinator attaches reporting/coverage.
- `execution-confirmed`: exact task is executing; coordinator continues supervision, not acceptance.
- `blocked`: preflight/reporting/coverage is missing, or worker reports blocked; inspect before any action.
- `submitted-unconfirmed`: prompt may have arrived; reconcile the existing worker, never resend.
- `failed`: a later phase step failed; retain resources, receipts and the last durable intent.

`row.launch` in the existing index is the sole launch record. It retains immutable brief digest/bounds, before-effect attempt IDs, actual raw Herdr receipts, handoff digest, occupant/session and execution evidence. No second journal, rollback, cleanup or worker-side runtime exists. Raw receipts and paths may be private: retain the ignored index with owner-only access, never commit it.

Repeated prepare or inspection of a completed/partial launch returns retained state without effects, even after expiry. Submit is allowed only from `prepared`. Missing observation can be repaired by the coordinator before any prompt intent; after any create/start/prompt intent or uncertain persistence, invocation does not resume effects. Inspect the canonical record and actual resources under the original identity, retain adverse evidence and next action, and obtain any additional authority needed for manual reconciliation. Never clear a pending record, mint another launch ID, replenish bounds or restart merely to bypass uncertainty. No automatic adoption, reporting incorporation, answers, CI, acceptance, merge or cleanup is supplied.
