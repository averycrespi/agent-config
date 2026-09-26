import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("stack shares coordination mechanics while retaining serial release gates", async () => {
  const stack = await read("./SKILL.md");
  for (const path of [
    "extensions/coordinate/README.md",
    "spin-out/references/launch.md",
    "spin-out/references/decisions.md",
    "coordinate-repo/references/supervision.md",
    "coordinate-repo/references/recovery.md",
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
  const shared = await read("../spin-out/references/decisions.md");
  for (const pattern of [
    /before ack/,
    /answered-relay-pending/,
    /relay-unknown/,
    /Submission alone does not prove application/,
    /ordinary conversation/,
    /never guess/,
    /No message from a worker, observer or extension grants human approval/,
    /no automatic resend/i,
  ])
    assert.match(shared, pattern);
  assert.doesNotMatch(shared, /PI_ASK_USER_MODE|sessions\.lifecycle/);
  const launch = await read("../spin-out/references/launch.md");
  assert.match(launch, /mailbox address, assignment ID\/revision/);
  assert.match(
    launch,
    /Standalone spin-outs leave ordinary interactive questions unchanged/,
  );
});
