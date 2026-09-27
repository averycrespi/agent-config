import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  readFileSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { MailboxStore, _durability } from "./store.ts";

const sender = "00000000-0000-4000-8000-000000000001";
function fixture(t: import("node:test").TestContext) {
  const root = mkdtempSync(join(tmpdir(), "mailbox-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new MailboxStore(root);
  return Object.assign(store, {
    send: (box: string, type: string, body: string) =>
      MailboxStore.prototype.send.call(store, box, type, body, sender),
  });
}
test("durable publication survives process exit and cursor excludes later arrivals", (t) => {
  const s = fixture(t);
  const a = s.send("project", "question", "first");
  s.send("project", "question", "second");
  const first = s.list("project", 1);
  assert.equal(first.messages[0].id, a.id);
  const script = `import {MailboxStore} from ${JSON.stringify(new URL("./store.ts", import.meta.url).href)}; new MailboxStore(${JSON.stringify(s.root)}).send('project','result','third', '${sender}');`;
  execFileSync(process.execPath, [
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    script,
  ]);
  s.ack("project", [a.id]);
  const second = new MailboxStore(s.root).list(
    "project",
    20,
    first.nextCursor!,
  );
  assert.deepEqual(
    second.messages.map((m) => m.message),
    ["second"],
  );
  assert.equal(second.nextCursor, null);
  assert.equal(s.list("project").pending, 2);
  assert.equal(s.ack("project", [a.id]).acknowledged, 0);
  assert.equal(s.list("absent").pending, 0);
});
test("invalid atomic operations and unsafe storage preserve existing bytes", (t) => {
  const s = fixture(t);
  const sent = s.send("project", "result", "retained");
  const path = join(s.root, "project.json");
  const before = readFileSync(path);
  for (const bad of [
    () => s.send("../escape", "result", "x"),
    () => s.send("project", "bad type", ""),
    () => s.send("project", "result", "x".repeat(8193)),
    () => s.ack("project", [sent.id, "bad"]),
    () => s.ack("project", [sent.id, sent.id]),
    () => s.list("project", 0),
    () => s.list("project", 1, "bad"),
  ])
    assert.throws(bad, /invalid_input/);
  assert.deepEqual(readFileSync(path), before);
  mkdirSync(join(s.root, "project.lock"));
  assert.throws(
    () => s.send("project", "result", "not sent"),
    /storage_failed/,
  );
  assert.deepEqual(readFileSync(path), before);
  symlinkSync(path, join(s.root, "unsafe.json"));
  assert.throws(() => s.list("unsafe"), /storage_failed/);
  writeFileSync(join(s.root, "corrupt.json"), "broken", { mode: 0o600 });
  assert.throws(() => s.list("corrupt"), /storage_failed/);
});
test("post-rename durability failure is uncertain, retains the report and never resends", (t) => {
  const s = fixture(t);
  t.mock.method(_durability, "syncDirectory", () => {
    throw new Error("disk failure");
  });
  assert.throws(
    () => s.send("project", "result", "retained once"),
    (e: any) => e.code === "publication_unknown" && e.outcomeUnknown === true,
  );
  assert.deepEqual(
    new MailboxStore(s.root).list("project").messages.map((m) => m.message),
    ["retained once"],
  );
});

test("inspection is byte bounded and acknowledgement frees quota without silent expiry", (t) => {
  const s = fixture(t);
  const sent = Array.from({ length: 3 }, () =>
    s.send("large", "result", "x".repeat(8192)),
  );
  const first = s.list("large", 50);
  assert.equal(first.messages.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 17000);
  assert.equal(first.pending, 3);
  assert.equal(
    s.ack(
      "large",
      sent.map((m) => m.id),
    ).acknowledged,
    3,
  );
  assert.equal(s.list("large", 50, first.nextCursor!).messages.length, 0);
  assert.equal(s.list("large").oldestAt, null);
});
