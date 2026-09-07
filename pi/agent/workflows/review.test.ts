import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseWorkflowScript } from "../extensions/workflows/parser.ts";
import { runWorkflow } from "../extensions/workflows/runtime.ts";

const workflowFile = new URL("./review.js", import.meta.url);
const localScope = {
  boundary: "local",
  requirements: [
    {
      id: "tests",
      description: "Required local regression suite",
      requiredFor: ["local", "pr"],
    },
    {
      id: "qualification",
      description: "Native and remote qualification",
      requiredFor: ["pr"],
    },
  ],
};

test("caller-defined evidence scopes retain deferred qualifications without hiding required gaps", async () => {
  const requirements = [
    {
      id: "tests",
      description: "Required local regression suite",
      requiredFor: ["portable", "platform"],
    },
    {
      id: "qualification",
      description: "Native platform qualification",
      requiredFor: ["platform"],
    },
  ];
  for (const boundary of ["portable", "platform"]) {
    const result = await runWorkflow(await loadWorkflow(), {
      cwd: process.cwd(),
      args: validArgs({
        deliveryScope: { boundary, requirements },
        checks: [
          {
            name: "tests",
            requirementId: "tests",
            status: "passed",
            summary: "Required local checks passed",
          },
          {
            name: "Native and remote qualification",
            requirementId: "qualification",
            status: "not-run",
            summary: "Native qualification is outside the portable assessment",
          },
        ],
        knownGaps: [
          {
            code: "qualification",
            detail: "Native and remote qualification not performed",
            requirementId: "qualification",
          },
        ],
      }),
      spawnAgent: async () =>
        structured({
          findings: [],
          gaps: [
            {
              code: "platform",
              detail:
                "Local confirmation closes the sole code finding, not platform qualification",
              requirementId: "qualification",
            },
          ],
        }),
    });
    const output = result.result as ReviewResult;
    assert.equal(output.complete, boundary === "portable");
    assert.equal(
      output.outcome,
      boundary === "portable" ? "no material findings" : "incomplete",
    );
    assert.match(output.report, /Review coverage is not delivery readiness/);
    assert.match(output.report, /Native and remote qualification/);
    assert.match(output.report, /## Qualification limitations/);
    assert.equal(output.blockingGaps.length > 0, boundary === "platform");
    assert.equal(
      output.qualificationLimitations.length > 0,
      boundary === "portable",
    );
  }
});

test("required and unclassified gaps fail closed; requirement omissions cannot waive checks", async () => {
  for (const overrides of [
    {
      checks: [
        {
          name: "tests",
          requirementId: "tests",
          status: "not-run",
          summary: "Missing",
        },
      ],
    },
    {
      checks: [
        {
          name: "other",
          status: "passed",
          summary: "Does not cover required tests",
        },
      ],
    },
    { knownGaps: ["Unclassified coverage gap"] },
    {
      knownGaps: [
        {
          code: "required",
          detail: "Missing required evidence",
          requirementId: "tests",
        },
      ],
    },
  ]) {
    const result = await runWorkflow(await loadWorkflow(), {
      cwd: "/repo",
      args: validArgs({
        deliveryScope: localScope,
        checks: [
          {
            name: "tests",
            requirementId: "tests",
            status: "passed",
            summary: "Passed",
          },
        ],
        ...overrides,
      }),
      spawnAgent: async () => structured({ findings: [], gaps: [] }),
    });
    assert.equal((result.result as ReviewResult).complete, false);
    assert.equal((result.result as ReviewResult).outcome, "incomplete");
  }
});

test("each independently required check needs its own passing evidence; aggregate mappings reject", async () => {
  const scope = {
    boundary: "local",
    requirements: [
      {
        id: "tests",
        description: "Required regression suite",
        requiredFor: ["local"],
      },
      { id: "lint", description: "Required lint", requiredFor: ["local"] },
    ],
  };
  const checks = [
    {
      name: "tests",
      requirementId: "tests",
      status: "passed",
      summary: "Tests passed; lint omitted",
    },
  ];
  const incomplete = await runWorkflow(await loadWorkflow(), {
    cwd: "/repo",
    args: validArgs({ deliveryScope: scope, checks }),
    spawnAgent: async () => structured({ findings: [], gaps: [] }),
  });
  assert.equal((incomplete.result as ReviewResult).complete, false);
  assert.match(
    (incomplete.result as ReviewResult).blockingGaps.join("\n"),
    /lint: missing passing evidence/,
  );
  await assert.rejects(
    runWorkflow(await loadWorkflow(), {
      cwd: "/repo",
      args: validArgs({
        deliveryScope: scope,
        checks: [
          ...checks,
          {
            name: "lint",
            requirementId: "tests",
            status: "passed",
            summary: "Invalid aggregate mapping",
          },
        ],
      }),
      spawnAgent: async () => {
        throw new Error("must reject before launch");
      },
    }),
    /one check per requirement/,
  );
  const complete = await runWorkflow(await loadWorkflow(), {
    cwd: "/repo",
    args: validArgs({
      deliveryScope: scope,
      checks: [
        ...checks,
        {
          name: "lint",
          requirementId: "lint",
          status: "passed",
          summary: "Lint passed",
        },
      ],
    }),
    spawnAgent: async () => structured({ findings: [], gaps: [] }),
  });
  assert.equal((complete.result as ReviewResult).complete, true);
});

test("qualification cannot hide failed checks, reviewer failures, malformed gaps or unresolved findings", async () => {
  for (const scenario of [
    "failed-check",
    "failed-reviewer",
    "malformed-gap",
    "invented-requirement",
    "finding",
  ]) {
    const result = await runWorkflow(await loadWorkflow(), {
      cwd: "/repo",
      args: validArgs({
        deliveryScope: localScope,
        checks: [
          {
            name: "tests",
            requirementId: "tests",
            status: "passed",
            summary: "Passed",
          },
          {
            name: "qualification",
            requirementId: "qualification",
            status: scenario === "failed-check" ? "failed" : "not-run",
            summary: "Disclosed qualification",
          },
        ],
      }),
      spawnAgent: async () =>
        scenario === "failed-reviewer"
          ? failed("Unavailable")
          : structured({
              findings: scenario === "finding" ? [finding()] : [],
              gaps:
                scenario === "malformed-gap"
                  ? [{ code: "empty", detail: "" }]
                  : scenario === "invented-requirement"
                    ? [
                        {
                          code: "unknown",
                          detail: "Missing evidence",
                          requirementId: "invented",
                        },
                      ]
                    : [],
            }),
    });
    const output = result.result as ReviewResult;
    assert.equal(
      output.outcome,
      ["finding", "failed-check"].includes(scenario)
        ? "findings"
        : "incomplete",
    );
    assert.equal(output.complete, scenario === "finding");
  }
});

test("adjudicator qualifications use the same scope rules and all stages receive requirements", async () => {
  const result = await runWorkflow(await loadWorkflow(), {
    cwd: "/repo",
    args: validArgs({
      deliveryScope: localScope,
      checks: [
        {
          name: "tests",
          requirementId: "tests",
          status: "passed",
          summary: "Passed",
        },
      ],
      requestedLenses: ["architecture"],
    }),
    spawnAgent: async (request) => {
      const context = JSON.parse(
        request.prompt
          .split("Prepared review context:\n")[1]
          .split("\n\nCandidate groups:")[0],
      );
      assert.deepEqual(context.deliveryScope, localScope);
      assert.match(request.prompt, /never invent exemptions/i);
      if (request.intent === "Adjudicate review findings")
        return structured({
          dispositions: [
            {
              candidateIds: ["independent-1"],
              status: "rejected",
              reason: "Unsupported candidate",
            },
          ],
          gaps: [
            {
              code: "platform",
              detail: "Remote qualification remains unperformed",
              requirementId: "qualification",
            },
          ],
        });
      return structured({
        findings: request.intent === "Review independent" ? [finding()] : [],
        gaps: [],
      });
    },
  });
  const output = result.result as ReviewResult;
  assert.equal(output.complete, true);
  assert.equal(output.blockingGaps.length, 0);
  assert.match(
    output.qualificationLimitations.join("\n"),
    /Remote qualification remains unperformed/,
  );
});

test("scope validation rejects invented exemptions before launch", async () => {
  for (const overrides of [
    { deliveryScope: { ...localScope, boundary: "release" } },
    {
      deliveryScope: {
        ...localScope,
        requirements: [{ id: "tests", description: "tests", requiredFor: [] }],
      },
    },
    {
      deliveryScope: localScope,
      checks: [
        {
          name: "tests",
          status: "passed",
          summary: "ok",
          requirementId: "invented",
        },
      ],
    },
    { knownGaps: [{ code: "x", detail: "not important", blocking: false }] },
  ]) {
    await assert.rejects(
      runWorkflow(await loadWorkflow(), {
        cwd: "/repo",
        args: validArgs(overrides),
        spawnAgent: async () => {
          throw new Error("must not launch");
        },
      }),
      /review input/i,
    );
  }
});

type ReviewResult = {
  report: string;
  complete: boolean;
  outcome: string;
  deliveryScope: unknown;
  blockingGaps: string[];
  qualificationLimitations: string[];
};

async function loadWorkflow() {
  return parseWorkflowScript(await readFile(workflowFile, "utf8"));
}

function validArgs(overrides: Record<string, unknown> = {}) {
  return {
    target: { kind: "working-tree", label: "current changes" },
    objective: "Implement the requested behavior",
    acceptanceCriteria: ["The behavior is correct"],
    changedFiles: ["src/example.ts"],
    contextPaths: ["/tmp/review.patch", "AGENTS.md"],
    checks: [{ name: "tests", status: "passed", summary: "12 passed" }],
    priorReviewContext: [],
    knownGaps: [],
    riskTags: [],
    requestedLenses: [],
    ...overrides,
  };
}

function structured(value: unknown) {
  return {
    ok: true,
    text: null,
    hasStructured: true,
    value,
  } as const;
}

function failed(message: string) {
  return {
    ok: false,
    text: null,
    error: message,
    errorCode: "provider_error" as const,
  };
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    category: "correctness",
    severity: "major",
    confidence: "high",
    path: "src/example.ts",
    startLine: 12,
    title: "Incorrect boundary handling",
    claim: "The changed condition rejects the valid boundary value.",
    impact: "Valid input fails at runtime.",
    evidence: [
      {
        kind: "diff",
        location: "src/example.ts:12",
        quote: "if (value >= limit) return false",
      },
    ],
    recommendation: "Allow the boundary value.",
    ...overrides,
  };
}

test("review is a valid saved workflow with strict prepared-context input", async () => {
  const workflow = await loadWorkflow();
  assert.deepEqual(workflow.meta, {
    name: "review",
    description:
      "Review prepared evidence with one independent reviewer and optional risk-driven lenses",
  });

  for (const args of [
    undefined,
    null,
    "working tree",
    {},
    validArgs({ target: { kind: "unknown", label: "x" } }),
    validArgs({ contextPaths: [] }),
    validArgs({ contextPaths: ["   "] }),
    validArgs({ contextPaths: new Array(1) }),
    validArgs({ checks: [{ name: "tests", status: "green", summary: "ok" }] }),
    validArgs({ requestedLenses: ["security"] }),
    validArgs({ reviewMode: "unknown" }),
    validArgs({ reviewMode: "confirmation" }),
    validArgs({
      checks: Array.from({ length: 51 }, () => ({
        name: "test",
        status: "passed",
        summary: "ok",
      })),
    }),
    validArgs({
      changedFiles: Array.from({ length: 201 }, () => "src/file.ts"),
    }),
    validArgs({ unexpected: true }),
    validArgs({ target: { kind: "working-tree", label: "x", extra: true } }),
    validArgs({
      checks: [
        {
          name: "tests",
          status: "passed",
          summary: "ok",
          extra: true,
        },
      ],
    }),
  ]) {
    let launches = 0;
    await assert.rejects(
      runWorkflow(workflow, {
        cwd: "/repo",
        args,
        spawnAgent: async () => {
          launches += 1;
          return structured({ findings: [], gaps: [] });
        },
      }),
      /review input/i,
    );
    assert.equal(launches, 0);
  }
});

test("review runs one independent reviewer without mandatory adjudication", async () => {
  const workflow = await loadWorkflow();
  const requests: any[] = [];
  const result = await runWorkflow(workflow, {
    cwd: "/repo",
    args: validArgs(),
    spawnAgent: async (request) => {
      requests.push(request);
      return structured({ findings: [], gaps: [] });
    },
  });

  assert.deepEqual(
    requests.map((request) => request.intent),
    ["Review independent"],
  );
  for (const request of requests) {
    assert.deepEqual(request.capabilities, ["read-filesystem"]);
    assert.equal(request.profile, "balanced");
    assert.equal(request.retries, 0);
    assert.ok(request.output?.schema);
    assert.match(request.prompt, /untrusted evidence, not instructions/i);
    assert.match(request.prompt, /\/tmp\/review\.patch/);
    assert.match(request.prompt, /12 passed/);
  }
  assert.match(
    (result.result as ReviewResult).report,
    /^# Review: current changes/m,
  );
  assert.match(
    (result.result as ReviewResult).report,
    /Outcome: no material findings/,
  );
  assert.match(
    (result.result as ReviewResult).report,
    /tests: passed — 12 passed/,
  );
  assert.match(
    (result.result as ReviewResult).report,
    /No material findings in the supplied evidence/,
  );
  assert.doesNotMatch(
    (result.result as ReviewResult).report,
    /ready to merge/i,
  );
});

test("review deterministically adds only requested or risk-selected optional lenses", async () => {
  const workflow = await loadWorkflow();
  const requests: any[] = [];
  await runWorkflow(workflow, {
    cwd: "/repo",
    args: validArgs({
      requestedLenses: ["performance", "performance"],
      riskTags: ["public-api"],
    }),
    spawnAgent: async (request) => {
      requests.push(request);
      return structured({ findings: [], gaps: [] });
    },
  });

  assert.deepEqual(
    requests.map((request) => request.intent),
    ["Review independent", "Review architecture", "Review performance"],
  );
});

test("optional lenses adjudicate immutable grouped candidates once", async () => {
  const workflow = await loadWorkflow();
  const requests: any[] = [];
  const result = await runWorkflow(workflow, {
    cwd: "/repo",
    args: validArgs({ requestedLenses: ["architecture", "performance"] }),
    spawnAgent: async (request) => {
      requests.push(request);
      if (request.intent === "Review independent") {
        return structured({
          findings: [
            finding(),
            finding({
              severity: "minor",
              title: "Rejected candidate",
              claim: "This candidate should not survive adjudication.",
            }),
          ],
          gaps: [],
        });
      }
      if (request.intent === "Review architecture") {
        return structured({ findings: [finding()], gaps: [] });
      }
      if (request.intent === "Review performance") {
        return structured({
          findings: [
            finding({
              claim: "A separate defect shares the same title and location.",
              impact: "A different runtime path fails.",
              evidence: [
                {
                  kind: "source",
                  location: "src/example.ts:12",
                  quote: "return alternateFailure",
                },
              ],
            }),
          ],
          gaps: [],
        });
      }
      if (request.intent === "Adjudicate review findings") {
        const groups = JSON.parse(
          request.prompt.split("Candidate groups:\n")[1],
        );
        assert.equal(groups.length, 3);
        assert.deepEqual(groups[0].candidateIds, [
          "independent-1",
          "architecture-1",
        ]);
        assert.equal(
          groups[2].finding.claim,
          "A separate defect shares the same title and location.",
        );
        return structured({
          dispositions: [
            {
              candidateIds: ["independent-1", "architecture-1"],
              status: "confirmed",
              reason: "Both candidates identify the same evidenced defect.",
              normalizedFinding: finding({
                title: "Invented replacement finding",
                claim: "This was not reported by a reviewer.",
              }),
            },
            {
              candidateIds: ["independent-2"],
              status: "rejected",
              reason: "The claim is not supported by the supplied evidence.",
            },
            {
              candidateIds: ["performance-1"],
              status: "rejected",
              reason: "The separate claim is not supported.",
            },
          ],
          gaps: [],
        });
      }
      throw new Error(`Unexpected intent: ${request.intent}`);
    },
  });

  const adjudicator = requests.at(-1);
  assert.equal(adjudicator.intent, "Adjudicate review findings");
  assert.deepEqual(adjudicator.capabilities, ["read-filesystem"]);
  assert.equal(adjudicator.profile, "strong");
  assert.match((result.result as ReviewResult).report, /## Major findings/);
  assert.match(
    (result.result as ReviewResult).report,
    /Incorrect boundary handling/,
  );
  assert.doesNotMatch(
    (result.result as ReviewResult).report,
    /Invented replacement finding/,
  );
  assert.match((result.result as ReviewResult).report, /src\/example\.ts:12/);
  assert.match(
    (result.result as ReviewResult).report,
    /Valid input fails at runtime/,
  );
  assert.doesNotMatch(
    (result.result as ReviewResult).report,
    /Rejected candidate/,
  );
});

test("review preserves partial results and marks failed core coverage incomplete", async () => {
  const workflow = await loadWorkflow();
  const result = await runWorkflow(workflow, {
    cwd: "/repo",
    args: validArgs(),
    spawnAgent: async (request) =>
      request.intent === "Review independent"
        ? failed("provider unavailable")
        : structured({ findings: [], gaps: [] }),
  });

  assert.equal(result.settledBranchFailureCount, 1);
  assert.match((result.result as ReviewResult).report, /Outcome: incomplete/);
  assert.match(
    (result.result as ReviewResult).report,
    /0\/1 reviewer lenses completed/,
  );
  assert.match(
    (result.result as ReviewResult).report,
    /Reviewer independent failed: provider unavailable/,
  );
  assert.doesNotMatch(
    (result.result as ReviewResult).report,
    /No material findings in the supplied evidence/,
  );
});

test("review fails adjudication semantics closed into needs-human findings", async () => {
  const workflow = await loadWorkflow();
  const result = await runWorkflow(workflow, {
    cwd: "/repo",
    args: validArgs({ requestedLenses: ["architecture"] }),
    spawnAgent: async (request) => {
      if (request.intent === "Review independent") {
        return structured({ findings: [finding()], gaps: [] });
      }
      if (request.intent === "Adjudicate review findings") {
        return structured({
          dispositions: [
            {
              candidateIds: Array.from(
                { length: 101 },
                (_, index) => `unknown-${index + 1}`,
              ),
              status: "rejected",
              reason: "invalid",
            },
          ],
          gaps: [],
        });
      }
      return structured({ findings: [], gaps: [] });
    },
  });

  assert.match((result.result as ReviewResult).report, /Outcome: incomplete/);
  assert.match(
    (result.result as ReviewResult).report,
    /## Needs human judgment/,
  );
  assert.match(
    (result.result as ReviewResult).report,
    /Incorrect boundary handling/,
  );
  assert.match(
    (result.result as ReviewResult).report,
    /too many candidate IDs/,
  );
  assert.match(
    (result.result as ReviewResult).report,
    /did not disposition every candidate/,
  );
});

test("review distinguishes deterministic failures and missing check evidence", async () => {
  const workflow = await loadWorkflow();
  for (const scenario of [
    {
      checks: [{ name: "tests", status: "failed", summary: "2 failed" }],
      outcome: "findings",
      absent: "No material findings in the supplied evidence",
      present: "No model-confirmed findings; deterministic checks failed.",
    },
    {
      checks: [{ name: "tests", status: "not-run", summary: "not available" }],
      outcome: "incomplete",
    },
    { checks: [], outcome: "incomplete" },
  ]) {
    const result = await runWorkflow(workflow, {
      cwd: "/repo",
      args: validArgs({ checks: scenario.checks }),
      spawnAgent: async () => structured({ findings: [], gaps: [] }),
    });
    assert.match(
      (result.result as ReviewResult).report,
      new RegExp(`Outcome: ${scenario.outcome}`),
    );
    if (scenario.present)
      assert.match(
        (result.result as ReviewResult).report,
        new RegExp(scenario.present),
      );
    if (scenario.absent)
      assert.doesNotMatch(
        (result.result as ReviewResult).report,
        new RegExp(scenario.absent),
      );
  }
});

test("review bounds hostile structured-output collections before adjudication and rendering", async () => {
  const workflow = await loadWorkflow();
  const findings = Array.from({ length: 75 }, (_, index) =>
    finding({
      title: `Finding ${index + 1}`,
      startLine: index + 1,
    }),
  );
  const reviewerGaps = Array.from({ length: 75 }, (_, index) => ({
    code: `review-gap-${index + 1}`,
    detail: `gap ${index + 1}`,
  }));
  const result = await runWorkflow(workflow, {
    cwd: "/repo",
    args: validArgs({ requestedLenses: ["architecture"] }),
    spawnAgent: async (request) => {
      if (request.intent === "Review independent") {
        return structured({ findings, gaps: reviewerGaps });
      }
      if (request.intent === "Adjudicate review findings") {
        const groups = JSON.parse(
          request.prompt.split("Candidate groups:\n")[1],
        );
        assert.equal(groups.length, 50);
        return structured({
          dispositions: groups.map((group: any) => ({
            candidateIds: group.candidateIds,
            status: "rejected",
            reason: "not supported",
          })),
          gaps: Array.from(
            { length: 75 },
            (_, index) => `adjudicator gap ${index + 1}`,
          ),
        });
      }
      return structured({ findings: [], gaps: [] });
    },
  });

  assert.match((result.result as ReviewResult).report, /review-gap-50: gap 50/);
  assert.doesNotMatch(
    (result.result as ReviewResult).report,
    /review-gap-51: gap 51/,
  );
  assert.match((result.result as ReviewResult).report, /adjudicator gap 50/);
  assert.doesNotMatch(
    (result.result as ReviewResult).report,
    /adjudicator gap 51/,
  );
});

test("review bounds and terminal-sanitizes model-derived findings", async () => {
  const workflow = await loadWorkflow();
  const hostile = finding({
    title: "Bad\u001b[31m title\nnext",
    claim: "x".repeat(4_000),
  });
  const result = await runWorkflow(workflow, {
    cwd: "/repo",
    args: validArgs(),
    spawnAgent: async (request) => {
      if (request.intent === "Review independent") {
        return structured({ findings: [hostile], gaps: [] });
      }
      if (request.intent === "Adjudicate review findings") {
        return structured({
          dispositions: [
            {
              candidateIds: ["independent-1"],
              status: "confirmed",
              reason: "confirmed",
              normalizedFinding: hostile,
            },
          ],
          gaps: [],
        });
      }
      return structured({ findings: [], gaps: [] });
    },
  });

  assert.doesNotMatch((result.result as ReviewResult).report, /\u001b|\[31m/);
  assert.ok((result.result as ReviewResult).report.length < 8_000);
});

test("single-reviewer findings need no adjudicator and suggestions do not block", async () => {
  for (const scenario of [
    { value: finding(), outcome: "findings" },
    {
      value: finding({ severity: "minor", category: "style" }),
      outcome: "non-blocking suggestions",
    },
    { value: finding({ category: "style" }), outcome: "incomplete" },
    { value: finding({ confidence: "low" }), outcome: "incomplete" },
  ]) {
    let launches = 0;
    const result = await runWorkflow(await loadWorkflow(), {
      cwd: "/repo",
      args: validArgs(),
      spawnAgent: async () => {
        launches += 1;
        return structured({ findings: [scenario.value], gaps: [] });
      },
    });
    assert.equal(launches, 1);
    assert.match(
      (result.result as ReviewResult).report,
      new RegExp(`Outcome: ${scenario.outcome}`),
    );
    assert.match(
      (result.result as ReviewResult).report,
      /Incorrect boundary handling/,
    );
  }
});

test("focused confirmation carries original blockers and repair boundaries through every selected reviewer", async () => {
  const priorReviewContext = [
    "Original blocker B-1: boundary value rejected; repaired code.js and its direct caller; verify no caller regression.",
  ];
  const requests: any[] = [];
  const result = await runWorkflow(await loadWorkflow(), {
    cwd: "/repo",
    args: validArgs({
      reviewMode: "confirmation",
      priorReviewContext,
      requestedLenses: ["architecture"],
    }),
    spawnAgent: async (request) => {
      requests.push(request);
      if (request.intent === "Adjudicate review findings") {
        return structured({
          dispositions: [
            {
              candidateIds: ["independent-1"],
              status: "confirmed",
              reason: "Original blocker remains evidenced",
            },
          ],
          gaps: [],
        });
      }
      return structured({
        findings: request.intent === "Review independent" ? [finding()] : [],
        gaps: [],
      });
    },
  });
  assert.equal(requests.length, 3);
  for (const request of requests) {
    const json = request.prompt
      .split("Prepared review context:\n")[1]
      .split("\n\nCandidate groups:")[0];
    const context = JSON.parse(json);
    assert.deepEqual(context.priorReviewContext, priorReviewContext);
    assert.deepEqual(context.deterministicChecks, [
      {
        name: "tests",
        status: "passed",
        summary: "12 passed",
        artifactPath: "",
      },
    ]);
  }
  assert.match((result.result as ReviewResult).report, /Outcome: findings/);
});
