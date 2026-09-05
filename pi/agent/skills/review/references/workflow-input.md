# Review Workflow Input

Read completely before invoking the saved `review` workflow. Prepare the evidence under [review](../SKILL.md); this packaging contract grants no repair authority.

Pass a strict object containing:

- `target`: `kind` (`working-tree`, `branch`, `commit-range`, `pull-request`, `document`, or `other`) and concise `label`;
- `objective` and `acceptanceCriteria` from authoritative task context;
- `changedFiles` and non-empty `contextPaths`;
- `checks` with `name`, honest `status` (`passed`, `failed`, `not-run`), concise `summary`, and optional `artifactPath` for long output;
- `reviewMode`: `initial` (default) or `confirmation` after repairs;
- `priorReviewContext`: confirmation requires original blockers, dispositions, repair scope, and affected boundaries;
- `knownGaps` for missing diffs, deleted artifacts, unavailable checks, or uncertain scope;
- `riskTags` grounded in the change;
- `requestedLenses`: only `architecture` and/or `performance`, and only when explicitly warranted.

For code changes, include the generated patch artifact in `contextPaths`, not only source files. If a patch is impossible, record the absence in `knownGaps`. Prefer risk tags over optional lenses when deterministic routing already covers the concern.

Respect collection limits: 30 context paths, 200 changed files, 50 acceptance criteria, 50 checks, 50 prior-review entries, 50 known gaps, and 30 risk tags. Never silently trim. Split independent targets when possible; otherwise choose bounded relevant evidence and summarize exclusions in `knownGaps`.

```json
{
  "action": "run",
  "name": "review",
  "args": {
    "target": { "kind": "working-tree", "label": "current changes" },
    "objective": "Implement the requested behavior",
    "acceptanceCriteria": ["The behavior is correct"],
    "changedFiles": ["src/example.ts"],
    "contextPaths": ["/tmp/review.patch", "AGENTS.md"],
    "checks": [{ "name": "tests", "status": "passed", "summary": "12 passed" }],
    "priorReviewContext": [],
    "knownGaps": [],
    "riskTags": [],
    "requestedLenses": []
  }
}
```

If strict input validation rejects the package before agents launch, correct the packaging error and retry once. Do not rerun because findings are inconvenient. After authorized repairs, prepare fresh evidence for focused confirmation rather than unrestricted fresh review.
