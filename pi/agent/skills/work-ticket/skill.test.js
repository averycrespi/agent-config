import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
for (const name of [
  "plane",
  "shape-ticket",
  "work-ticket",
  "review",
  "challenge",
  "simplify",
  "clarify",
]) {
  test(`${name} remains discoverable with resolvable local skill links`, async () => {
    const file = resolve(root, name, "SKILL.md");
    const content = await readFile(file, "utf8");
    const metadata = content.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(metadata);
    assert.equal(metadata[1].match(/^name: (.+)$/m)?.[1], name);
    assert.match(metadata[1], /^description: Use when /m);
    const seen = new Set();
    const pending = [file];
    while (pending.length) {
      const current = pending.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      const document = await readFile(current, "utf8");
      for (const link of document.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)) {
        if (!link[1].includes(":")) {
          pending.push(resolve(dirname(current), link[1]));
        }
      }
    }
  });
}

test("retired skill entrypoints and Goal extension are absent", async () => {
  for (const name of ["dispatch-ticket", "advance-ticket"]) {
    await assert.rejects(access(resolve(root, name, "SKILL.md")), {
      code: "ENOENT",
    });
  }
  await assert.rejects(access(resolve(root, "../extensions/goal")), {
    code: "ENOENT",
  });
  await access(resolve(root, "work-ticket/scripts/ticket-state.js"));
});
