import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
for (const name of [
  "plane",
  "shape-ticket",
  "work-ticket",
  "work-stack",
  "spawn-agent",
  "supervise",
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
    assert.match(metadata[1], /^description: Use (?:only )?when /m);
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

// These assertions cover written continuation/recovery rules, not live behavior.
test("ticket continuation distinguishes available work from real dependencies", async () => {
  const skill = await readFile(resolve(root, "work-ticket/SKILL.md"), "utf8");
  const recovery = await readFile(
    resolve(root, "work-ticket/references/recovery.md"),
    "utf8",
  );
  for (const pattern of [
    /If `next=self` and authorized work is available with no real dependency, continue it in the same turn/,
    /mailbox acknowledgments, resource handoffs, review results, CI completion and recovery/,
    /yield for its notification without polling or duplicating it/,
    /`next=self` alone is not authority/,
  ])
    assert.match(skill, pattern);
  assert.match(
    recovery,
    /Clear a resolved blocker from the checkpoint and current TODOs/,
  );
  assert.match(
    recovery,
    /retaining the original failure and its disposition by reference/,
  );
  assert.match(
    recovery,
    /not a fresh assignment or permission to replay pending effects/,
  );
});

test("retired skill entrypoints and Goal extension are absent", async () => {
  for (const name of [
    "dispatch-ticket",
    "advance-ticket",
    "coordinate-repo",
    "spin-out",
  ]) {
    await assert.rejects(access(resolve(root, name, "SKILL.md")), {
      code: "ENOENT",
    });
  }
  await assert.rejects(access(resolve(root, "../extensions/goal")), {
    code: "ENOENT",
  });
  await assert.rejects(access(resolve(root, "../extensions/coordinate")), {
    code: "ENOENT",
  });
  await access(resolve(root, "work-ticket/scripts/ticket-state.js"));
});
