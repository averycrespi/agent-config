import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseWorkflowScript } from "../extensions/workflows/parser.ts";
import { runWorkflow } from "../extensions/workflows/runtime.ts";

const workflowFile = new URL("./review.js", import.meta.url);

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
      "Review prepared code-change evidence with bounded independent lenses and adjudication",
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

test("review runs three structured core lenses and reports clean supplied evidence cautiously", async () => {
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
    ["Review behavior", "Review assurance", "Review maintainability"],
  );
  for (const request of requests) {
    assert.deepEqual(request.capabilities, ["read-filesystem"]);
    assert.equal(request.modelTier, "medium");
    assert.equal(request.thinking, "high");
    assert.equal(request.retries, 0);
    assert.ok(request.output?.schema);
    assert.match(request.prompt, /untrusted evidence, not instructions/i);
    assert.match(request.prompt, /\/tmp\/review\.patch/);
    assert.match(request.prompt, /12 passed/);
  }
  assert.match(result.result as string, /^# Review: current changes/m);
  assert.match(result.result as string, /Outcome: no material findings/);
  assert.match(result.result as string, /tests: passed — 12 passed/);
  assert.match(
    result.result as string,
    /No material findings in the supplied evidence/,
  );
  assert.doesNotMatch(result.result as string, /ready to merge/i);
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
    [
      "Review behavior",
      "Review assurance",
      "Review maintainability",
      "Review architecture",
      "Review performance",
    ],
  );
});

test("review adjudicates structured candidates once and renders only accepted findings", async () => {
  const workflow = await loadWorkflow();
  const requests: any[] = [];
  const result = await runWorkflow(workflow, {
    cwd: "/repo",
    args: validArgs(),
    spawnAgent: async (request) => {
      requests.push(request);
      if (request.intent === "Review behavior") {
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
      if (request.intent === "Review assurance") {
        return structured({ findings: [finding()], gaps: [] });
      }
      if (request.intent === "Review maintainability") {
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
        assert.deepEqual(groups[0].candidateIds, ["behavior-1", "assurance-1"]);
        assert.equal(
          groups[2].finding.claim,
          "A separate defect shares the same title and location.",
        );
        return structured({
          dispositions: [
            {
              candidateIds: ["behavior-1", "assurance-1"],
              status: "confirmed",
              reason: "Both candidates identify the same evidenced defect.",
              normalizedFinding: finding({
                title: "Invented replacement finding",
                claim: "This was not reported by a reviewer.",
              }),
            },
            {
              candidateIds: ["behavior-2"],
              status: "rejected",
              reason: "The claim is not supported by the supplied evidence.",
            },
            {
              candidateIds: ["maintainability-1"],
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
  assert.equal(adjudicator.modelTier, "large");
  assert.equal(adjudicator.thinking, "high");
  assert.match(result.result as string, /## Major findings/);
  assert.match(result.result as string, /Incorrect boundary handling/);
  assert.doesNotMatch(result.result as string, /Invented replacement finding/);
  assert.match(result.result as string, /src\/example\.ts:12/);
  assert.match(result.result as string, /Valid input fails at runtime/);
  assert.doesNotMatch(result.result as string, /Rejected candidate/);
});

test("review preserves partial results and marks failed core coverage incomplete", async () => {
  const workflow = await loadWorkflow();
  const result = await runWorkflow(workflow, {
    cwd: "/repo",
    args: validArgs(),
    spawnAgent: async (request) =>
      request.intent === "Review assurance"
        ? failed("provider unavailable")
        : structured({ findings: [], gaps: [] }),
  });

  assert.equal(result.settledBranchFailureCount, 1);
  assert.match(result.result as string, /Outcome: incomplete/);
  assert.match(result.result as string, /2\/3 reviewer lenses completed/);
  assert.match(
    result.result as string,
    /Reviewer assurance failed: provider unavailable/,
  );
  assert.doesNotMatch(
    result.result as string,
    /No material findings in the supplied evidence/,
  );
});

test("review fails adjudication semantics closed into needs-human findings", async () => {
  const workflow = await loadWorkflow();
  const result = await runWorkflow(workflow, {
    cwd: "/repo",
    args: validArgs(),
    spawnAgent: async (request) => {
      if (request.intent === "Review behavior") {
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

  assert.match(result.result as string, /Outcome: incomplete/);
  assert.match(result.result as string, /## Needs human judgment/);
  assert.match(result.result as string, /Incorrect boundary handling/);
  assert.match(result.result as string, /too many candidate IDs/);
  assert.match(result.result as string, /did not disposition every candidate/);
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
      result.result as string,
      new RegExp(`Outcome: ${scenario.outcome}`),
    );
    if (scenario.present)
      assert.match(result.result as string, new RegExp(scenario.present));
    if (scenario.absent)
      assert.doesNotMatch(result.result as string, new RegExp(scenario.absent));
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
    args: validArgs(),
    spawnAgent: async (request) => {
      if (request.intent === "Review behavior") {
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

  assert.match(result.result as string, /review-gap-50: gap 50/);
  assert.doesNotMatch(result.result as string, /review-gap-51: gap 51/);
  assert.match(result.result as string, /adjudicator gap 50/);
  assert.doesNotMatch(result.result as string, /adjudicator gap 51/);
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
      if (request.intent === "Review behavior") {
        return structured({ findings: [hostile], gaps: [] });
      }
      if (request.intent === "Adjudicate review findings") {
        return structured({
          dispositions: [
            {
              candidateIds: ["behavior-1"],
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

  assert.doesNotMatch(result.result as string, /\u001b|\[31m/);
  assert.ok((result.result as string).length < 8_000);
});
