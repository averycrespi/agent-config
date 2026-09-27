import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("stack shares coordination mechanics while retaining serial release gates", async () => {
  const stack = await read("./SKILL.md");
  for (const path of [
    "spawn-agent/SKILL.md",
    "spawn-agent/references/decisions.md",
    "extensions/mailbox/README.md",
  ])
    assert.ok(stack.includes(path), path);
  for (const pattern of [
    /exactly one active ticket child/,
    /verified predecessor head/,
    /incremental diff/,
    /cumulative resulting tree/,
    /Released child ownership/,
    /changed predecessor pauses/,
    /no automatic migration/i,
  ])
    assert.match(stack, pattern);
  assert.doesNotMatch(
    stack,
    /sessions\.list|sessions\.lifecycle|PI_ASK_USER_MODE/,
  );
});
test("shared questions require durable incorporation and provenance rather than modal interaction", async () => {
  const shared = await read("../spawn-agent/references/decisions.md");
  for (const pattern of [
    /before ack/,
    /TODO items/,
    /uncertain relay stays unresolved/,
    /Submission alone does not prove application/,
    /ordinary conversation/,
    /never guess/,
    /No message from a worker, observer or extension grants human approval/,
    /no automatic resend/i,
  ])
    assert.match(shared, pattern);
  assert.doesNotMatch(shared, /PI_ASK_USER_MODE|sessions\.lifecycle/);
  const launch = await read("../spawn-agent/SKILL.md");
  assert.match(launch, /parent mailbox address/);
  assert.match(launch, /send its task separately/i);
});
