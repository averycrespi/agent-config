import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
for (const name of ["plane", "shape-ticket", "work-ticket", "review"]) {
  test(`${name} remains discoverable with resolvable local skill links`, async () => {
    const file = resolve(root, name, "SKILL.md");
    const content = await readFile(file, "utf8");
    const metadata = content.match(
      /^---\nname: ([^\n]+)\ndescription: (.+)\n---/,
    );
    assert.ok(metadata);
    assert.equal(metadata[1], name);
    assert.match(metadata[2], /^Use when /);
    for (const link of content.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)) {
      if (!link[1].includes(":")) await access(resolve(root, name, link[1]));
    }
  });
}

test("retired skill entrypoints are absent while Goal remains discoverable", async () => {
  for (const name of ["dispatch-ticket", "advance-ticket"]) {
    await assert.rejects(access(resolve(root, name, "SKILL.md")), {
      code: "ENOENT",
    });
  }
  await access(resolve(root, "../extensions/goal/index.ts"));
  await access(resolve(root, "work-ticket/scripts/ticket-state.js"));
});
