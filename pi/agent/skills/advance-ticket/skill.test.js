import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const skillsRoot = resolve(import.meta.dirname, "..");

async function readSkill(name) {
  return readFile(resolve(skillsRoot, name, "SKILL.md"), "utf8");
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "skill must have frontmatter");
  return Object.fromEntries(
    match[1].split("\n").map((line) => {
      const separator = line.indexOf(":");
      return [line.slice(0, separator), line.slice(separator + 1).trim()];
    }),
  );
}

for (const name of [
  "plane",
  "shape-ticket",
  "dispatch-ticket",
  "advance-ticket",
]) {
  test(`${name} is a discoverable narrowly triggered skill`, async () => {
    const metadata = frontmatter(await readSkill(name));
    assert.equal(metadata.name, name);
    assert.match(metadata.description, /^Use when /);
  });
}

test("plane centralizes safe access and organization conventions", async () => {
  const skill = await readSkill("plane");
  assert.match(skill, /mcp_search/);
  assert.match(skill, /mcp_describe/);
  assert.match(skill, /mcp_call/);
  assert.match(skill, /Workspace/);
  assert.match(skill, /Project/);
  assert.match(skill, /Pages/);
  assert.match(skill, /native relationships/i);
  assert.match(skill, /nonbinding/i);
  assert.match(skill, /Draft.*Ready.*In Progress.*Review.*Done/s);
  assert.match(skill, /does not grant authority/i);
});

for (const name of ["shape-ticket", "dispatch-ticket", "advance-ticket"]) {
  test(`${name} loads the shared Plane operating contract`, async () => {
    const skill = await readSkill(name);
    assert.match(skill, /Read `\.\.\/plane\/SKILL\.md` completely/);
  });
}

test("shape-ticket requires exact-contract Ready approval", async () => {
  const skill = await readSkill("shape-ticket");
  assert.match(skill, /Draft preview/);
  assert.match(skill, /Ready preview/);
  assert.match(skill, /ticket-ready:v1/);
  assert.match(skill, /Plane comment/);
  assert.match(skill, /comments are not part of the hashed contract body/i);
  assert.match(skill, /advance-ticket\/scripts\/ticket-run\.js/);
  assert.match(skill, /not merge, deploy/i);
});

test("dispatch-ticket owns passive inspection and explicit run operations", async () => {
  const skill = await readSkill("dispatch-ticket");
  for (const mode of [
    "inspect",
    "dispatch",
    "resume",
    "settle",
    "cancel",
    "cleanup",
  ]) {
    assert.match(skill, new RegExp(`\\b${mode}\\b`));
  }
  assert.match(skill, /inspect[^\n]*default/i);
  assert.match(skill, /claim[^\n]*before[^\n]*worker/i);
  assert.match(skill, /herdr worktree remove --workspace/);
  assert.doesNotMatch(skill, /\.\.\/ticket-runs/);
});

test("advance-ticket routes durable phases through Loop and independent review", async () => {
  const skill = await readSkill("advance-ticket");
  for (const phase of [
    "planning",
    "implementing",
    "verifying",
    "publishing",
    "reviewing",
  ]) {
    assert.match(skill, new RegExp(`\\b${phase}\\b`));
  }
  assert.match(skill, /saved `review` workflow/);
  assert.match(skill, /publication-safety gate/i);
  assert.match(skill, /complete outgoing commit range/i);
  assert.match(skill, /github\.run_secret_scanning/);
  assert.match(skill, /public-safe summary/i);
  assert.match(skill, /stop before push/i);
  assert.match(skill, /Loop is the only continuation scheduler/);
  assert.match(skill, /awaiting_human/);
});
