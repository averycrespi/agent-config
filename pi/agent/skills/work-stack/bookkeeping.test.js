import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Matched synthetic operation inventories, not historical performance measurements.
export const scenarios = [
  {
    name: "routine wakes",
    baseline: [
      "receipt",
      "snapshot",
      "copy-child-progress",
      "copy-child-budget",
    ],
    revised: ["receipt", "snapshot"],
    copies: [2, 0],
    handoffs: [0, 0],
  },
  {
    name: "child CI waiting",
    baseline: ["receipt", "copy-deadline", "copy-wakes", "snapshot"],
    revised: ["receipt", "snapshot"],
    copies: [2, 0],
    handoffs: [0, 0],
  },
  {
    name: "registration race",
    baseline: ["intent", "attach", "receipt", "gap-check", "snapshot"],
    revised: ["intent", "attach", "receipt", "gap-check", "snapshot"],
    copies: [0, 0],
    handoffs: [0, 0],
  },
  {
    name: "parent expiry",
    baseline: ["receipt", "snapshot", "child-release", "child-claim"],
    revised: ["receipt", "snapshot"],
    copies: [0, 0],
    handoffs: [1, 0],
  },
  {
    name: "interrupted confirmation",
    baseline: ["reread", "confirm", "copy-confirmation", "next", "release"],
    revised: ["reread", "confirm", "final-release"],
    copies: [1, 0],
    handoffs: [0, 0],
  },
  {
    name: "report retention",
    baseline: ["review", "transcribe-report", "checkpoint-reference"],
    revised: ["review-retained", "checkpoint-reference"],
    copies: [1, 0],
    handoffs: [0, 0],
  },
  {
    name: "authorized resume",
    baseline: ["reconcile", "claim", "copy-budget", "snapshot"],
    revised: ["reconcile", "claim", "snapshot"],
    copies: [1, 0],
    handoffs: [0, 0],
  },
];

test("three-ticket current snapshot remains fixed-size across 30 routine wakes", async () => {
  const template = await readFile(
    new URL("references/snapshot-example.md", import.meta.url),
    "utf8",
  );
  const start = template.replaceAll("job-b", "job-000");
  let revised = start,
    baseline = start;
  for (let wake = 1; wake <= 30; wake++) {
    revised = start.replaceAll(
      "job-000",
      `job-${String(wake).padStart(3, "0")}`,
    );
    baseline += `\nWake ${wake}: child B continues implementation; Verify pending; CI deadline unchanged; wake accounted; parent retains authority and will recheck.\n`;
    assert.equal(Buffer.byteLength(revised), Buffer.byteLength(start));
    for (const required of [
      "authority",
      "ticket-a.json",
      "ticket-b.json",
      "ticket-c.json",
      "history-index.json",
      "gap-b.json",
      "observation.json",
      "Unresolved control effects",
      "## Next",
    ])
      assert.ok(
        revised.toLowerCase().includes(required.toLowerCase()),
        required,
      );
  }
  assert.ok(Buffer.byteLength(baseline) > Buffer.byteLength(revised));
  console.log(
    JSON.stringify({
      scenario: "three tickets / 30 routine wakes",
      initialBytes: Buffer.byteLength(start),
      baselineFinalBytes: Buffer.byteLength(baseline),
      revisedFinalBytes: Buffer.byteLength(revised),
      modeledOperationCounts: scenarios.map((s) => ({
        scenario: s.name,
        baseline: s.baseline.length,
        revised: s.revised.length,
        duplicateCopies: s.copies,
        unnecessaryHandoffs: s.handoffs,
      })),
    }),
  );
});
test("matched modeled reductions preserve safety-critical reconciliation work", () => {
  assert.deepEqual(
    scenarios.find((s) => s.name === "registration race").baseline,
    scenarios.find((s) => s.name === "registration race").revised,
  );
  assert.deepEqual(
    scenarios
      .find((s) => s.name === "interrupted confirmation")
      .revised.slice(0, 2),
    ["reread", "confirm"],
  );
  assert.deepEqual(
    scenarios.find((s) => s.name === "authorized resume").revised.slice(0, 2),
    ["reconcile", "claim"],
  );
  assert.ok(scenarios.every((s) => s.revised.length <= s.baseline.length));
});
