import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("stack uses automatic session messaging without parent observation setup", async () => {
  const stack = await read("./SKILL.md");
  const launch = await read("../spin-out/references/launch.md");
  const decisions = await read("../spin-out/references/decisions.md");
  const tool = await read("../../extensions/coordinate/index.ts");
  const spawn = await read("../../extensions/coordinate/launch.ts");
  assert.match(stack, /do not create a parent mailbox Monitor/);
  assert.match(stack, /Child execution\/CI budgets remain independent/);
  assert.match(launch, /automatic session mailbox readiness before submission/);
  assert.match(decisions, /messages in both directions/);
  assert.match(decisions, /full session UUID/);
  assert.match(decisions, /same-ID redelivery against prior application/);
  assert.doesNotMatch(
    tool + spawn,
    /supervision_id|inspectMonitor|describeScriptProviders|mailboxSupervision/,
  );
  assert.match(spawn, /result\?\.listening && result.sessionId === mailbox/);
  assert.match(tool, /further_writes === false/);
});
