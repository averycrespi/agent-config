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

test("rejects obvious missing results without counting callback returns", () => {
  for (const body of [
    'await agent("x");',
    'await agent("x"); return;',
    'await agent("x"); return\n42;',
    'const results = await parallel([() => agent("x")]); log(results);',
    'const results = await agent("x"); function helper() { return results; }',
    'const results = await agent("x"); await report(results, { gate: () => true });',
  ]) {
    for (const declaration of [
      `export async function run() { ${body} }`,
      `export const run = async () => { ${body} };`,
    ]) {
      assert.throws(
        () =>
          parseWorkflowScript(
            `export const meta = { name: "x", description: "x" };\n${declaration}`,
          ),
        /run\(\) must return a result/,
      );
    }
  }
});

test("rejects direct report calls with statically missing gate options", () => {
  for (const call of [
    "report()",
    "report(result)",
    "report(result, {})",
    "report(result, { other: true })",
  ]) {
    assert.throws(
      () =>
        parseWorkflowScript(`export const meta = { name: "x", description: "x" };
export async function run() { const result = await agent("x"); return await ${call}; }`),
      /report\(\) requires.*gate/,
    );
  }
});

test("leaves dynamic gates, shadowed report, and complex control flow to runtime", () => {
  for (const body of [
    'const result = await agent("x"); return result;',
    'await agent("x"); return null;',
    'return await report(await agent("x"), { gate: () => true });',
    'return report(await agent("x"), options);',
    'return report(await agent("x"), { ...options });',
    'return report(...await agent("x"));',
    'return report(await agent("x"), { [key]: callback });',
    'const report = value => value; return report(await agent("x"));',
    'const { report } = args; return report(await agent("x"));',
    'async function helper(report) { return report(await agent("x")); } return helper(args.callback);',
    'try { return await agent("x"); } finally { log("settled"); }',
    'await agent("x"); throw new Error("stop");',
    'if (args.stop) throw new Error("stop"); await agent("x");',
  ]) {
    assert.doesNotThrow(() =>
      parseWorkflowScript(`export const meta = { name: "x", description: "x" };
export async function run() { ${body} }`),
    );
  }
  assert.doesNotThrow(() =>
    parseWorkflowScript(`export const meta = { name: "x", description: "x" };
export const run = async () => agent("x");`),
  );
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
    `export const meta = { name: "x", description: "x" };\nconst Clock = Date;\nagent(String(Clock));`,
    `export const meta = { name: "x", description: "x" };\nperformance.now();\nagent("x");`,
    `export const meta = { name: "x", description: "x" };\ncrypto.randomUUID();\nagent("x");`,
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
