import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// Protect the evidence-preparation contract, not reviewer judgment or obedience.
test("review prepares readable associated evidence before admission", async () => {
  const skill = await read("./SKILL.md");
  const input = await read("./references/workflow-input.md");
  assert.ok(skill.includes("references/workflow-input.md#evidence-preflight"));
  assert.ok(skill.indexOf("## Preflight") < skill.indexOf("## Invoke"));
  for (const pattern of [
    /exact command\/arguments, working directory/,
    /Identify the tested revision or, for a dirty tree/,
    /Verify complete byte coverage\/reconstruction deterministically/,
    /metadata is not a substitute/,
    /A required suite is one check/,
    /rather than launching a workflow per fragment/,
    /A new phase or PR label alone does not justify re-review/,
    /Structural tests validate written contracts and links, not live reviewer behavior/,
  ])
    assert.match(input, pattern);
});
