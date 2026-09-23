import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// These guard discoverability and required instruction placement, not model behavior.
test("routing metadata exposes managed continuity and standalone launch mechanics", async () => {
  const coordinate = await read("./SKILL.md");
  const spinOut = await read("../spin-out/SKILL.md");
  const description = (text) => text.match(/^description: (.+)$/m)?.[1];
  assert.match(description(coordinate), /already-active managed coordination/);
  assert.match(description(coordinate), /exactly one worker/);
  assert.match(
    description(spinOut),
    /Preserve already-active managed coordination/,
  );
  assert.match(coordinate, /unless the human explicitly changes mode/);
  assert.match(spinOut, /Before choosing standalone mode/);
  assert.match(spinOut, /launch mechanics, not a mode switch/);
  assert.match(spinOut, /Outside active managed coordination/);
  assert.match(coordinate, /worker owns CI monitoring/);
  assert.match(
    coordinate,
    /parent owns blocker\/result supervision and acceptance/,
  );
});

test("shared launch gates managed completion without changing standalone or serial policy", async () => {
  const launch = await read("../spin-out/references/launch.md");
  const gate = launch
    .split("## Managed launch completion gate\n")[1]
    ?.split("\n## ")[0];
  assert.ok(gate, "shared launch must expose a managed completion gate");
  for (const requirement of [
    /current assignment\/revision and reporting contract/,
    /exact worker session\/incarnation/,
    /attached host receipt/,
    /before the task prompt/,
    /task-correlated execution confirmation/,
    /delivery TODO remains open/,
    /retain unprompted resources/,
    /no replay or restart/,
    /original deadline, consumed attempts and uncertain reservations/,
  ])
    assert.match(gate, requirement);
  assert.match(launch, /Standalone mode needs no coordinator\/index/);
  const stack = await read("../work-stack/SKILL.md");
  assert.match(stack, /exactly one active ticket child/);
  assert.match(
    stack,
    /do not commission duplicate delivery or competing parent CI monitors/,
  );
  const coordinate = await read("./SKILL.md");
  assert.match(coordinate, /explicit mode change.*recovery\/handover/s);
  assert.match(coordinate, /Never automatically adopt existing workers/);
});

test("routing qualification scenarios and changed local links remain discoverable", async () => {
  const recipe = await read("./references/verification.md");
  for (const scenario of [
    "Active coordination → one delegation",
    "Genuinely standalone delegation",
    "Missing managed launch prerequisites",
    "Explicit opt-out or handover",
    "Serial stack and multiple workers",
  ])
    assert.ok(recipe.includes(scenario), scenario);
  assert.match(recipe, /without the expected outcomes/);
  assert.match(recipe, /do not prove model compliance/);
  for (const path of [
    "./SKILL.md",
    "../spin-out/SKILL.md",
    "../spin-out/references/launch.md",
    "./references/verification.md",
    "../../../README.md",
  ]) {
    const url = new URL(path, import.meta.url);
    const text = await readFile(url, "utf8");
    for (const [, target] of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      if (!target.includes(":")) await readFile(new URL(target, url));
    }
  }
});
