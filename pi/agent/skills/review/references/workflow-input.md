# Review Workflow Input

Read before invoking the saved `review` workflow. Prepare evidence under [review](../SKILL.md); this contract grants no repair authority.

## Input

Pass a strict object with:

- `target`: supported `kind` (`working-tree`, `branch`, `commit-range`, `pull-request`, `document`, `other`) and concise `label`;
- `objective`, `acceptanceCriteria`, `changedFiles`, non-empty `contextPaths` including the generated patch for code review;
- `deliveryScope`: current evidence `boundary` and `requirements: [{id, description, requiredFor}]`. The evidence boundary is distinct from the user's authorized delivery boundary. Derive these from authoritative criteria and the caller's actual evidence scope, not convenience. Boundary names are opaque caller-defined labels, not workflow phases. Each requirement names all applicable boundaries; include at least one requirement applicable now. IDs use letters, digits, underscores, or hyphens;
- `checks`: `{name, status, summary, artifactPath?, requirementId?}`. Status is honestly `passed`, `failed`, or `not-run`. Reference the declared requirement that the check covers;
- `knownGaps`: strings (always blocking), or `{code, detail, requirementId?}`. Reference a requirement only if the entire gap is confined to it;
- `reviewMode`: `initial` (default) or `confirmation`; confirmation requires `priorReviewContext` containing original blockers, dispositions, repair scope, and affected boundaries;
- `riskTags` grounded in the change and optional `requestedLenses` (`architecture` and/or `performance`) only when warranted.

Absent `deliveryScope`, legacy inputs remain supported and all gaps/not-run checks remain blocking. Missing or unknown requirement references in model output are blocking; unknown references in prepared input reject before launch. There is no arbitrary `blocking: false` exemption. Required evidence cannot be waived by attaching an unrelated optional requirement ID: the independent reviewer must flag misclassification against authoritative criteria as an unclassified blocking gap.

Declare one requirement per independently required check (for example separate tests, typecheck, lint, and formatting IDs), not an aggregate label such as “all repository checks.” A single required command that runs a test suite is one check. Each requirement permits only one check result; duplicate mappings reject before launch. Every requirement applicable to the current boundary needs its own referenced passing result; an omitted sibling check stays blocking. The reviewer compares this inventory with authoritative instructions because schema validation cannot discover undeclared repository requirements. A failed check always blocks, including failed qualification checks. A not-run check or gap referring exclusively to a requirement outside the boundary is a visible qualification limitation, not an incomplete local review. Reviewer execution/schema failures, unusable findings, truncation, and ambiguous adjudication remain blocking regardless of scope.

Respect limits: 30 context paths, 200 changed files, 50 acceptance criteria/checks/requirements/prior-review entries/known gaps, 30 risk tags, and 10 boundaries per requirement. Never silently trim inputs. Split independent targets or disclose excluded evidence. Missing diffs or uncertain scope belong in unclassified blocking gaps.

```json
{
  "action": "run",
  "name": "review",
  "args": {
    "target": { "kind": "working-tree", "label": "local changes" },
    "objective": "Implement the requested behavior",
    "acceptanceCriteria": ["Boundary inputs work correctly"],
    "changedFiles": ["src/example.ts"],
    "contextPaths": ["/tmp/review.patch", "AGENTS.md"],
    "deliveryScope": {
      "boundary": "local",
      "requirements": [
        {
          "id": "tests",
          "description": "Required regression suite",
          "requiredFor": ["local", "pr"]
        },
        {
          "id": "remote",
          "description": "Remote CI qualification",
          "requiredFor": ["pr"]
        }
      ]
    },
    "checks": [
      {
        "name": "tests",
        "requirementId": "tests",
        "status": "passed",
        "summary": "12 passed"
      },
      {
        "name": "remote CI",
        "requirementId": "remote",
        "status": "not-run",
        "summary": "User authorized local delivery only"
      }
    ],
    "priorReviewContext": [],
    "knownGaps": [],
    "riskTags": [],
    "requestedLenses": []
  }
}
```

## Output and reuse

The workflow returns `{report, complete, outcome, deliveryScope, blockingGaps, qualificationLimitations}`. `report` is the full authoritative Markdown; retain and present it under the review skill. `complete` describes required coverage/execution, not absence of code findings: a complete review can have blocking findings. `outcome` is `findings`, `incomplete`, `non-blocking suggestions`, or `no material findings`. Never use `complete` alone as approval. Preserve findings and failed checks separately in the caller's continuity record.

Reviewer and adjudicator schemas use `{code, detail, requirementId?}` for gaps. The workflow classifies them against the same prepared scope, preserves limitations, and fails unclassified gaps closed. Infrastructure failures cannot be declared optional.

Assess the full supplied change and criteria even when some qualifications fall outside this review's evidence scope. The caller owns scheduling, readiness decisions, persistence, repair allowances, and exceptions; this workflow only assesses evidence and returns findings and coverage limitations.

Reuse an earlier review only when content, scope, and applicable requirements remain covered. A new boundary label alone does not require another model review. New scope, affected code, or uncovered requirements require a scope-aware `initial` review; focused confirmation covers authorized repairs within existing scope. Keep evidence bound to the revision and scope it actually covered. Caller-accepted exceptions do not change the factual incomplete/failed result; keep dispositions separate rather than falsifying checks or reclassifying requirements.

If input validation rejects before launch, correct packaging and retry once. Do not rerun because findings are inconvenient. Use focused confirmation only after authorized repairs within unchanged scope.
