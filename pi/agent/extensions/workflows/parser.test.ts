import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkflowScript } from "./parser.ts";

const validScript = `export const meta = { name: "audit", description: "Audit files" };
export async function run() {
  phase("start");
  return await agent("Inspect the repo");
}
`;

test("accepts a workflow with literal metadata and agent call", () => {
  const parsed = parseWorkflowScript(validScript);
  assert.equal(parsed.meta.name, "audit");
  assert.equal(parsed.meta.description, "Audit files");
  assert.match(parsed.executableScript, /const meta =/);
});

test("rejects missing first-statement metadata", () => {
  assert.throws(
    () => parseWorkflowScript(`const x = 1;\n${validScript}`),
    /must start/,
  );
});

test("rejects nonliteral metadata", () => {
  assert.throws(
    () =>
      parseWorkflowScript(
        `export const meta = { name: name, description: "x" };\nagent("x");`,
      ),
    /string literals/,
  );
});

test("rejects imports, require, filesystem/network primitives, and nondeterminism", () => {
  const cases = [
    `export const meta = { name: "x", description: "x" };\nimport fs from "fs";\nagent("x");`,
    `export const meta = { name: "x", description: "x" };\nrequire("fs");\nagent("x");`,
    `export const meta = { name: "x", description: "x" };\nfetch("https://example.com");\nagent("x");`,
    `export const meta = { name: "x", description: "x" };\nDate.now();\nagent("x");`,
    `export const meta = { name: "x", description: "x" };\nnew Date();\nagent("x");`,
    `export const meta = { name: "x", description: "x" };\nMath.random();\nagent("x");`,
  ];
  for (const script of cases) assert.throws(() => parseWorkflowScript(script));
});

test("accepts a direct verify call as spawning work", () => {
  assert.doesNotThrow(() =>
    parseWorkflowScript(
      `export const meta = { name: "x", description: "x" };\nexport async function run() { return verify("claim"); }`,
    ),
  );
});

test("rejects scripts without a direct agent or verify call", () => {
  for (const body of [
    "return 1",
    "return report(1, { gate: async () => true })",
  ]) {
    assert.throws(
      () =>
        parseWorkflowScript(
          `export const meta = { name: "x", description: "x" };\nexport async function run() { ${body}; }`,
        ),
      /must call agent\(\) or verify\(\)/,
    );
  }
});
