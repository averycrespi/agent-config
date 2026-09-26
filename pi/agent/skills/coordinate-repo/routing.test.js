import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// Discovery/placement only; these assertions do not prove model behavior.
test("Coordinate replaces active skill and saved launch entrypoint without losing legacy recovery", async () => {
  await assert.rejects(access(new URL("./SKILL.md", import.meta.url)), {
    code: "ENOENT",
  });
  await assert.rejects(
    access(new URL("../../scripts/launch-worker.js", import.meta.url)),
    { code: "ENOENT" },
  );
  assert.match(await read("./RECOVERY.md"), /not an active skill/);
  assert.match(
    await read("./references/launch-script.md"),
    /recovery artifact/,
  );
  const coordinate = await read("../../extensions/coordinate/README.md");
  for (const pattern of [
    /coordinate-enable/,
    /request-local/,
    /not a second execution ledger/,
    /no automatic cutover/,
    /unrun unless separately authorized/,
  ])
    assert.match(coordinate, pattern);
});

test("routing preserves standalone spin-out and thin serial stack policy", async () => {
  const spin = await read("../spin-out/SKILL.md");
  assert.match(spin, /Before choosing standalone mode/);
  assert.match(spin, /coordinate.*spawn/);
  assert.match(spin, /Standalone questions use ordinary conversation/);
  const stack = await read("../work-stack/SKILL.md");
  for (const pattern of [
    /exactly one active ticket child/,
    /base.*explicitly/,
    /verified predecessor head/,
    /incremental diff/,
    /cumulative resulting tree/,
    /Released child ownership/,
    /changed predecessor pauses/,
    /coordinate complete/,
  ])
    assert.match(stack, pattern);
});

test("role policy retains authority, nonblocking questions and persist-before-ACK without forced turns", async () => {
  const role = await read("../../extensions/coordinate/ROLES.md");
  for (const pattern of [
    /persist.*before ACK/i,
    /ordinary conversation/,
    /Do not use modal UI/,
    /no forced reporting turn/i,
    /never.*replenish budgets/i,
    /released ownership\/no-further-writes/,
    /uncertain prompt replay/,
  ])
    assert.match(role, pattern);
  for (const path of [
    "./RECOVERY.md",
    "../spin-out/SKILL.md",
    "../spin-out/references/launch.md",
    "../../extensions/coordinate/README.md",
    "../../extensions/coordinate/ROLES.md",
    "../../../README.md",
  ]) {
    const url = new URL(path, import.meta.url);
    for (const [, target] of (await readFile(url, "utf8")).matchAll(
      /\]\(([^)#]+)(?:#[^)]*)?\)/g,
    ))
      if (!target.includes(":")) await access(new URL(target, url));
  }
});
