import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseWorkflowScript } from "../extensions/workflows/parser.ts";
import { runWorkflow } from "../extensions/workflows/runtime.ts";

const workflowFile = new URL("./deep-research.js", import.meta.url);

const draftReport = `# Draft

## Executive summary
Draft`;
const repairedReport = `# Repaired research

## Executive summary
Supported summary.

## Verified findings
- Supported claim [[1]](https://primary.example/fact)
  - Evidence: “direct quote”

## Conflicts and unverified claims
None.

## Assumptions
- Current public information.

## Limitations
- One research facet failed.

## Open questions
- What changes next?

## Methodology
Public-web search, extraction, independent verification, and audit.`;

async function loadWorkflow() {
  return parseWorkflowScript(await readFile(workflowFile, "utf8"));
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

async function runSimpleResearch(options: {
  sourceType: "primary" | "secondary";
  auditVerdicts?: boolean[];
  verificationEvidence?: Array<{
    url: string;
    title: string;
    quote: string;
    sourceType: "primary" | "authoritative" | "secondary" | "unknown";
    publisher: string;
    publisherUrl: string;
    reputation: "reputable" | "uncertain";
  }>;
}) {
  const workflow = await loadWorkflow();
  const intents: string[] = [];
  const auditVerdicts = [...(options.auditVerdicts ?? [true])];
  const result = runWorkflow(workflow, {
    cwd: "/tmp",
    args: "What is the verified fact?",
    spawnAgent: async (request) => {
      const intent = request.intent ?? "";
      intents.push(intent);
      if (intent === "Scope research") {
        return structured({
          assumptions: ["Public information"],
          facets: [{ name: "Fact", query: "verified fact", goal: "Verify it" }],
        });
      }
      if (intent === "Search Fact") {
        return structured({
          sources: [
            {
              url: "https://source.example/fact",
              title: "Fact source",
              rationale: "Direct evidence",
            },
          ],
        });
      }
      if (intent === "Extract source 1") {
        return structured({
          sourceType: options.sourceType,
          publisher: "Source Publisher",
          publisherUrl: "https://source-publisher.example/",
          reputation: "reputable",
          authority: "Source authority",
          summary: "Source summary",
          claims: [
            { statement: "The fact is true.", quote: "The fact is true." },
          ],
        });
      }
      if (intent.startsWith("Verify claims ")) {
        return structured({
          assessments: [
            {
              claimId: "claim-1",
              status: "verified",
              reason: "Supported",
              evidence: options.verificationEvidence ?? [],
              contradictions: [],
            },
          ],
        });
      }
      if (intent === "Synthesize report") {
        return structured({ report: draftReport });
      }
      if (intent === "Audit report" || intent === "Audit repaired report") {
        return structured({
          confirmed: auditVerdicts.shift() ?? false,
          reasons: ["Unsupported statement"],
        });
      }
      if (intent === "Repair report") {
        return structured({ report: repairedReport });
      }
      throw new Error(`Unexpected request: ${intent}`);
    },
  });
  return { result, intents };
}

test("deep-research is a valid saved workflow with a strict question input", async () => {
  const workflow = await loadWorkflow();
  assert.deepEqual(workflow.meta, {
    name: "deep-research",
    description:
      "Research a question across public web sources and return a verified cited report",
  });

  for (const args of [undefined, null, "", "   ", { question: "topic" }]) {
    let launches = 0;
    await assert.rejects(
      runWorkflow(workflow, {
        cwd: "/tmp",
        args,
        spawnAgent: async () => {
          launches += 1;
          return { ok: true, text: "unused" };
        },
      }),
      /question must be a non-empty string/i,
    );
    assert.equal(launches, 0);
  }
});

test("deep-research accepts one primary source and skips repair after a passing audit", async () => {
  const { result, intents } = await runSimpleResearch({
    sourceType: "primary",
  });
  assert.equal((await result).result, draftReport);
  assert.equal(
    intents.filter((intent) => intent === "Repair report").length,
    0,
  );
});

test("deep-research does not verify a secondary claim without independent corroboration", async () => {
  const { result, intents } = await runSimpleResearch({
    sourceType: "secondary",
  });
  await assert.rejects(result, /no independently verified claims/i);
  assert.equal(intents.includes("Synthesize report"), false);
});

test("deep-research accepts corroboration from two reputable independent publishers", async () => {
  const { result } = await runSimpleResearch({
    sourceType: "secondary",
    verificationEvidence: [
      {
        url: "https://other-publisher.example/claim",
        title: "Independent corroboration",
        quote: "The fact is true.",
        sourceType: "secondary",
        publisher: "Other Publisher",
        publisherUrl: "https://other-publisher.example/",
        reputation: "reputable",
      },
    ],
  });
  assert.equal((await result).result, draftReport);
});

test("deep-research rejects publisher-label aliases as independent corroboration", async () => {
  const { result } = await runSimpleResearch({
    sourceType: "secondary",
    verificationEvidence: [
      {
        url: "https://source-publisher.example/second-story",
        title: "Same publisher, different label",
        quote: "The fact is true.",
        sourceType: "secondary",
        publisher: "Source Publisher, Inc.",
        publisherUrl: "https://source-publisher.example/",
        reputation: "reputable",
      },
    ],
  });
  await assert.rejects(result, /no independently verified claims/i);
});

test("deep-research rejects two unqualified HTTPS pages as reputable independent corroboration", async () => {
  const { result, intents } = await runSimpleResearch({
    sourceType: "secondary",
    verificationEvidence: [
      {
        url: "https://unknown-one.example/claim",
        title: "Unknown page one",
        quote: "The fact is true.",
        sourceType: "unknown",
        publisher: "Unknown Publisher One",
        publisherUrl: "https://unknown-one.example/",
        reputation: "uncertain",
      },
      {
        url: "https://unknown-two.example/claim",
        title: "Unknown page two",
        quote: "The fact is true.",
        sourceType: "unknown",
        publisher: "Unknown Publisher Two",
        publisherUrl: "https://unknown-two.example/",
        reputation: "uncertain",
      },
    ],
  });
  await assert.rejects(result, /no independently verified claims/i);
  assert.equal(intents.includes("Synthesize report"), false);
});

test("deep-research rejects malformed authoritative evidence URLs", async () => {
  const { result } = await runSimpleResearch({
    sourceType: "secondary",
    verificationEvidence: [
      {
        url: "https://",
        title: "Malformed source",
        quote: "The fact is true.",
        sourceType: "primary",
        publisher: "Primary Publisher",
        publisherUrl: "https://primary.example/",
        reputation: "reputable",
      },
    ],
  });
  await assert.rejects(result, /no independently verified claims/i);
});

test("deep-research rejects authoritative verifier evidence without an exact quote", async () => {
  const { result } = await runSimpleResearch({
    sourceType: "secondary",
    verificationEvidence: [
      {
        url: "https://primary.example/claim",
        title: "Primary source",
        quote: "",
        sourceType: "primary",
        publisher: "Primary Publisher",
        publisherUrl: "https://primary.example/",
        reputation: "reputable",
      },
    ],
  });
  await assert.rejects(result, /no independently verified claims/i);
});

test("deep-research hard-rejects a report that still overclaims after one repair", async () => {
  const { result, intents } = await runSimpleResearch({
    sourceType: "primary",
    auditVerdicts: [false, false],
  });
  await assert.rejects(result, (error: any) => {
    assert.equal(error.code, "workflow_report_rejected");
    return true;
  });
  assert.equal(
    intents.filter((intent) => intent === "Repair report").length,
    1,
  );
  assert.equal(
    intents.filter((intent) => intent === "Audit repaired report").length,
    1,
  );
});

test("deep-research returns an audited report after bounded public-web research and one repair", async () => {
  const workflow = await loadWorkflow();
  const requests: any[] = [];
  let auditCount = 0;

  const result = await runWorkflow(workflow, {
    cwd: "/tmp",
    args: "What changed in the example protocol?",
    spawnAgent: async (request) => {
      requests.push(request);
      const intent = request.intent ?? "";

      if (intent === "Scope research") {
        return structured({
          assumptions: ["Current public information", "Technical audience"],
          facets: [
            {
              name: "History",
              query: "example protocol history",
              goal: "Establish the timeline",
            },
            {
              name: "Current behavior",
              query: "example protocol current behavior",
              goal: "Find current primary documentation",
            },
          ],
        });
      }
      if (intent === "Search History") return failed("search unavailable");
      if (intent === "Search Current behavior") {
        return structured({
          sources: [
            {
              url: "https://secondary.example/overview",
              title: "Overview",
              rationale: "Relevant overview",
            },
            {
              url: "http://insecure.example/ignored",
              title: "Insecure",
              rationale: "Must be excluded",
            },
            {
              url: "https://broken.example/source",
              title: "Broken source",
              rationale: "Potential corroboration",
            },
          ],
        });
      }
      if (intent === "Extract source 1") {
        return structured({
          sourceType: "secondary",
          publisher: "Overview Publisher",
          publisherUrl: "https://secondary.example/",
          reputation: "reputable",
          authority: "Independent technical reporting",
          summary: "A concise source summary",
          claims: [
            {
              statement: "The protocol changed its handshake.",
              quote: "The handshake changed in version two.",
            },
          ],
        });
      }
      if (intent === "Extract source 2") return failed("fetch failed");
      if (intent.startsWith("Verify claims ")) {
        return structured({
          assessments: [
            {
              claimId: "claim-1",
              status: "verified",
              reason: "Independently corroborated",
              evidence: [
                {
                  url: "https://primary.example/fact",
                  title: "Protocol specification",
                  quote: "Version two uses the revised handshake.",
                  sourceType: "primary",
                  publisher: "Protocol Organization",
                  publisherUrl: "https://primary.example/",
                  reputation: "reputable",
                },
              ],
              contradictions: [],
            },
          ],
        });
      }
      if (intent === "Synthesize report") {
        assert.match(request.prompt, /## Verified findings/);
        assert.match(request.prompt, /claim-1/);
        return structured({ report: draftReport });
      }
      if (intent === "Audit report") {
        auditCount += 1;
        return structured({
          confirmed: false,
          reasons: ["The draft lacks the required evidence detail"],
        });
      }
      if (intent === "Repair report") {
        assert.match(request.prompt, /lacks the required evidence detail/);
        return structured({ report: repairedReport });
      }
      if (intent === "Audit repaired report") {
        auditCount += 1;
        return structured({ confirmed: true, reasons: [] });
      }
      throw new Error(`Unexpected request: ${intent}`);
    },
  });

  assert.equal(result.result, repairedReport);
  assert.deepEqual(result.phases, [
    "scope",
    "search",
    "extract",
    "verify",
    "synthesize",
    "audit",
    "repair",
    "audit repaired report",
  ]);
  assert.equal(result.agentFailureCount, 2);
  assert.equal(result.settledBranchFailureCount, 2);
  assert.equal(auditCount, 2);
  assert.ok(new Set(requests.map((request) => request.id)).size <= 30);
  assert.ok(requests.every((request) => (request.attempt ?? 1) <= 2));

  const searchRequests = requests.filter((request) =>
    request.intent?.startsWith("Search "),
  );
  assert.equal(searchRequests.length, 3);
  assert.equal(
    new Set(searchRequests.map((request) => request.intent)).size,
    2,
  );
  for (const request of searchRequests) {
    assert.deepEqual(request.capabilities, ["read-web"]);
    assert.equal(request.modelTier, "small");
    assert.equal(request.thinking, "medium");
    assert.equal(request.retries, 1);
    assert.match(request.prompt, /public HTTPS/i);
    assert.match(request.prompt, /do not access local files/i);
  }

  const extractRequests = requests.filter((request) =>
    request.intent?.startsWith("Extract source "),
  );
  assert.equal(extractRequests.length, 3);
  assert.equal(
    new Set(extractRequests.map((request) => request.intent)).size,
    2,
  );
  for (const request of extractRequests) {
    assert.deepEqual(request.capabilities, ["read-web"]);
    assert.equal(request.modelTier, "large");
    assert.equal(request.thinking, "high");
    assert.equal(request.retries, 1);
    assert.match(request.prompt, /public HTTPS/i);
  }

  const restrictedRequests = requests.filter((request) =>
    [
      "Scope research",
      "Synthesize report",
      "Audit report",
      "Repair report",
      "Audit repaired report",
    ].includes(request.intent),
  );
  for (const request of restrictedRequests) {
    assert.deepEqual(request.capabilities, []);
    assert.equal(request.modelTier, "large");
    assert.equal(request.thinking, "high");
    assert.equal("agent" in request, false);
    assert.equal("model" in request, false);
    assert.match(request.prompt, /do not access local files/i);
    assert.match(request.prompt, /supplied research|public[- ]web/i);
  }

  const auditRequests = requests.filter((request) =>
    ["Audit report", "Audit repaired report"].includes(request.intent),
  );
  assert.equal(auditRequests.length, 2);
  for (const request of auditRequests) {
    assert.match(request.prompt, /"reportContract"/);
    for (const section of [
      "# <specific title>",
      "## Executive summary",
      "## Verified findings",
      "## Conflicts and unverified claims",
      "## Assumptions",
      "## Limitations",
      "## Open questions",
      "## Methodology",
    ]) {
      assert.ok(request.prompt.includes(section), section);
    }
  }

  const verifierRequests = requests.filter((request) =>
    request.intent?.startsWith("Verify claims "),
  );
  assert.equal(verifierRequests.length, 3);
  for (const request of verifierRequests) {
    assert.deepEqual(request.capabilities, ["read-web"]);
    assert.equal(request.modelTier, "large");
    assert.equal(request.thinking, "high");
    assert.equal(request.retries, 0);
    assert.match(request.prompt, /one direct authoritative or primary source/i);
    assert.match(request.prompt, /independent publishers/i);
  }
});
