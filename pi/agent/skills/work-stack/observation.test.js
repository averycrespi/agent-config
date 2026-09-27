import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("stack uses separate automatic messaging without role or observer setup", async () => {
  const stack = await read("./SKILL.md");
  const launch = await read("../spawn-agent/SKILL.md");
  const decisions = await read("../spawn-agent/references/decisions.md");
  assert.match(stack, /do not duplicate its observer or execution ledger/);
  assert.match(stack, /Answers and recovery never renew child allowances/);
  assert.match(launch, /healthy automatic Mailbox listening in both sessions/);
  assert.match(decisions, /messages in both directions/);
  assert.match(decisions, /full session UUID/);
  assert.match(decisions, /same-ID redelivery against prior application/);
  assert.doesNotMatch(
    stack + launch + decisions,
    /coordinate (?:spawn|complete)|coordinate-enable|extensions\/coordinate/,
  );
  assert.match(stack, /release\/no-further-writes/);
  assert.match(launch, /Spawning itself writes no handoff and submits no task/);
});
