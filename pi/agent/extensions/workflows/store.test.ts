import assert from "node:assert/strict";
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  formatWorkflowInventory,
  inventoryWorkflows,
  MAX_INVENTORY_ENTRIES,
  MAX_WORKFLOW_FILE_BYTES,
  resolveSavedWorkflow,
} from "./store.ts";

const script = (name: string, description = "desc") =>
  `export const meta = { name: ${JSON.stringify(name)}, description: ${JSON.stringify(description)} };\nexport async function run() { return agent("read"); }`;

async function fixture(t: test.TestContext): Promise<string> {
  const dir = join(
    tmpdir(),
    `workflow-store-${process.pid}-${Date.now()}-${Math.random()}`,
  );
  await mkdir(dir, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("inventory is live, ordered, and missing stores are empty", async (t) => {
  const dir = await fixture(t);
  await writeFile(join(dir, "z-last.js"), script("z-last", "last"));
  await writeFile(join(dir, "a-first.js"), script("a-first", "first"));
  await writeFile(join(dir, "ignored.txt"), "no");
  await mkdir(join(dir, "ignored.js"));

  let inventory = await inventoryWorkflows(dir);
  assert.deepEqual(
    inventory.entries.map((entry) => entry.name),
    ["a-first", "z-last"],
  );
  assert.ok(inventory.entries.every((entry) => entry.valid));

  await writeFile(join(dir, "a-first.js"), script("a-first", "edited"));
  await rm(join(dir, "z-last.js"));
  inventory = await inventoryWorkflows(dir);
  assert.equal(inventory.entries.length, 1);
  assert.equal(inventory.entries[0]?.description, "edited");

  const missing = await inventoryWorkflows(join(dir, "missing"));
  assert.deepEqual(missing.entries, []);
  assert.equal(missing.truncated, undefined);
});

test("inventory reports unsafe, mismatched, parser-failed, oversized, and symlink entries", async (t) => {
  const dir = await fixture(t);
  await writeFile(join(dir, "UPPER.js"), script("UPPER"));
  await writeFile(join(dir, "mismatch.js"), script("other"));
  await writeFile(join(dir, "broken.js"), "const nope = 1");
  await writeFile(
    join(dir, "huge.js"),
    "x".repeat(MAX_WORKFLOW_FILE_BYTES + 1),
  );
  await writeFile(join(dir, "outside.js"), script("outside"));
  await symlink(join(dir, "outside.js"), join(dir, "linked.js"));

  const inventory = await inventoryWorkflows(dir);
  assert.equal(inventory.entries.length, 6);
  const invalidEntries = inventory.entries.filter(
    (entry) => entry.filename !== "outside.js",
  );
  assert.equal(invalidEntries.length, 5);
  for (const entry of invalidEntries) {
    assert.equal(entry.valid, false);
    assert.ok(entry.diagnostic);
    assert.equal(entry.sourcePath, join(dir, entry.filename));
  }
  assert.match(
    inventory.entries.find((entry) => entry.filename === "UPPER.js")!
      .diagnostic!,
    /name.*lowercase/i,
  );
  assert.match(
    inventory.entries.find((entry) => entry.filename === "mismatch.js")!
      .diagnostic!,
    /does not match/,
  );
  assert.match(
    inventory.entries.find((entry) => entry.filename === "broken.js")!
      .diagnostic!,
    /script must start/,
  );
  assert.match(
    inventory.entries.find((entry) => entry.filename === "huge.js")!
      .diagnostic!,
    /256 KiB/,
  );
  assert.match(
    inventory.entries.find((entry) => entry.filename === "linked.js")!
      .diagnostic!,
    /symbolic link/,
  );
});

test("configured root may be a symlink but entries may not be", async (t) => {
  const parent = await fixture(t);
  const target = join(parent, "target");
  const link = join(parent, "store-link");
  await mkdir(target);
  await writeFile(join(target, "valid.js"), script("valid"));
  await symlink(target, link);

  const resolved = await resolveSavedWorkflow(link, "valid");
  assert.equal(resolved.parsed.meta.name, "valid");
  assert.equal(resolved.sourcePath, join(target, "valid.js"));
});

test("direct resolution validates names before access and rejects invalid definitions", async (t) => {
  const dir = await fixture(t);
  await writeFile(join(dir, "good.js"), script("good"));
  await writeFile(join(dir, "bad.js"), script("other"));

  await assert.rejects(
    () => resolveSavedWorkflow(dir, "../good"),
    /lowercase kebab-case/,
  );
  await assert.rejects(
    () => resolveSavedWorkflow(dir, "unknown"),
    /Unknown saved workflow.*good/s,
  );
  await assert.rejects(
    () => resolveSavedWorkflow(dir, "bad"),
    /does not match/,
  );
});

test("inventory entry cap truncates while direct resolution remains available", async (t) => {
  const dir = await fixture(t);
  for (let index = 0; index <= MAX_INVENTORY_ENTRIES; index += 1) {
    const name = `wf-${String(index).padStart(3, "0")}`;
    await writeFile(join(dir, `${name}.js`), script(name));
  }

  const inventory = await inventoryWorkflows(dir);
  assert.equal(inventory.entries.length, MAX_INVENTORY_ENTRIES);
  assert.match(inventory.truncated ?? "", /entry limit/);
  const resolved = await resolveSavedWorkflow(
    dir,
    `wf-${MAX_INVENTORY_ENTRIES}`,
  );
  assert.equal(resolved.parsed.meta.name, `wf-${MAX_INVENTORY_ENTRIES}`);
});

test("inventory marks aggregate truncation and formatter bounds hostile metadata", async (t) => {
  const dir = await fixture(t);
  const largeDescription = `line one\nline two\t\u001b[31m${"x".repeat(500)}`;
  for (let index = 0; index < 12; index += 1) {
    const name = `large-${index}`;
    const source =
      script(name, largeDescription) + `\n/*${"x".repeat(200_000)}*/`;
    await writeFile(join(dir, `${name}.js`), source);
  }
  const inventory = await inventoryWorkflows(dir);
  assert.match(inventory.truncated ?? "", /aggregate source limit/);
  const formatted = formatWorkflowInventory(inventory, 1024);
  assert.ok(Buffer.byteLength(formatted.text, "utf8") <= 1024);
  assert.equal(formatted.truncated, true);
  assert.doesNotMatch(formatted.text, /\u001b/);
  assert.ok(
    formatted.details.entries.every(
      (entry) => !entry.description?.includes("\n"),
    ),
  );
  assert.ok(formatted.details.entries.length > 0);
});

test("unreadable entries are invalid where permissions are enforced", async (t) => {
  if (typeof process.getuid !== "function" || process.getuid() === 0)
    t.skip("root can read mode 000 files");
  const dir = await fixture(t);
  const path = join(dir, "locked.js");
  await writeFile(path, script("locked"));
  await chmod(path, 0o000);
  const inventory = await inventoryWorkflows(dir);
  assert.equal(inventory.entries[0]?.valid, false);
  assert.match(inventory.entries[0]?.diagnostic ?? "", /read/i);
});
