import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import mailbox from "./index.ts";
import { MailboxStore } from "./store.ts";
import { runtime, context, SESSION } from "./fixture.ts";
import { inspectMailbox } from "./api.ts";

test("lifecycle attribution, idle/draft/dialog holds, fork/resume/navigation, clear and provider independence", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mailbox-life-"));
  const old = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  mkdirSync(join(dir, ".pi"));
  writeFileSync(
    join(dir, ".pi/settings.json"),
    JSON.stringify({ "extension:mailbox": { batchWindowMs: 0 } }),
  );
  const root = join(dir, "mailboxes"),
    r = runtime(dir),
    store = new MailboxStore(root);
  const notices: string[] = [];
  r.ctx.ui.notify = (text: string) => notices.push(text);
  t.after(() => {
    r.hooks.get("session_shutdown")?.();
    if (old === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = old;
    rmSync(dir, { recursive: true, force: true });
  });
  mailbox(r.pi, root);
  await r.hooks.get("session_start")({}, r.ctx);
  assert.equal(inspectMailbox(r.pi, SESSION)?.listening, true);
  let busy = true,
    draft = "";
  r.ctx.isIdle = () => !busy;
  r.ctx.ui.getEditorText = () => draft;
  const sent = await r.tool.execute("send", {
    action: "send",
    mailbox: SESSION,
    type: "result",
    message: "PRIVATE\u001b[2J",
  });
  const original = store.list(SESSION).messages[0];
  assert.equal(original.sender, SESSION);
  assert.match(sent.content[0].text, /sender/);
  r.hooks.get("agent_settled")();
  assert.equal(r.messages.length, 0);
  busy = false;
  draft = "human draft";
  r.hooks.get("agent_settled")();
  assert.equal(r.messages.length, 0);
  draft = "";
  r.hooks.get("ui_prompt_start")();
  r.hooks.get("agent_settled")();
  assert.equal(r.messages.length, 0);
  r.hooks.get("ui_prompt_end")();
  assert.equal(r.messages.length, 1);
  assert.match(r.messages[0].content, /ageMs/);
  assert.match(r.messages[0].content, /UNTRUSTED MAILBOX MESSAGES/);
  assert.equal(store.list(SESSION).messages[0].attempts, 1);
  const before = readFileSync(join(root, `${SESSION}.json`));
  await r.commands.get("mailbox").handler("", r.ctx);
  assert.deepEqual(readFileSync(join(root, `${SESSION}.json`)), before);
  assert.ok(!notices.at(-1)!.includes("PRIVATE"));
  assert.match(notices.at(-1)!, /attempt 1/);
  await r.tool.execute("ack", {
    action: "ack",
    mailbox: SESSION,
    ids: [original.id],
  });
  r.hooks.get("session_tree")({}, r.ctx);
  assert.equal(store.list(SESSION).pending, 0);
  const pending = store.send(SESSION, "instruction", "closed backlog", SESSION);
  const fork = "00000000-0000-4000-8000-000000000002";
  await r.hooks.get("session_start")({ reason: "fork" }, context(dir, fork));
  assert.equal(store.list(fork).pending, 0);
  assert.equal(store.list(SESSION).pending, 1);
  assert.equal(r.messages.length, 1);
  await r.hooks.get("session_start")({ reason: "resume" }, r.ctx);
  assert.equal(r.messages.length, 2);
  assert.match(r.messages[1].content, new RegExp(pending.id));
  await r.commands.get("mailbox-clear").handler("", r.ctx);
  assert.equal(store.list(SESSION).pending, 0);
  assert.match(notices.at(-1)!, /Removed 1 messages.*cannot be retracted/);
  store.send(SESSION, "result", "fresh", SESSION);
  r.hooks.get("agent_settled")();
  assert.equal(r.messages.length, 3);
  r.hooks.get("session_shutdown")();
  store.send(SESSION, "result", "closed", SESSION);
  assert.equal(r.messages.length, 3);
  assert.equal(inspectMailbox(r.pi, SESSION), undefined);
});

test("duplicate session consumer is unavailable and cannot clear another owner's pending wake", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mailbox-duplicate-")),
    root = join(dir, "boxes");
  const a = runtime(dir),
    b = runtime(dir);
  mailbox(a.pi, root);
  mailbox(b.pi, root);
  t.after(() => {
    a.hooks.get("session_shutdown")();
    b.hooks.get("session_shutdown")();
    rmSync(dir, { recursive: true, force: true });
  });
  await a.hooks.get("session_start")({}, a.ctx);
  await b.hooks.get("session_start")({}, b.ctx);
  assert.equal(inspectMailbox(a.pi, SESSION)?.listening, true);
  assert.equal(inspectMailbox(b.pi, SESSION), undefined);
  await assert.rejects(
    b.tool.execute("x", {
      action: "send",
      mailbox: SESSION,
      type: "result",
      message: "x",
    }),
    /unavailable/,
  );
});
