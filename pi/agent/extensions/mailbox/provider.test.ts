import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { fixture } from "../script/fixture.ts";
import { describeScriptProviders } from "../script/api.ts";
import { subscribeProvider, describeEvents } from "../monitor/providers.ts";
import mailbox from "./index.ts";
import { MailboxStore } from "./store.ts";
import { mailboxSupervision } from "./api.ts";

async function setup(t: import("node:test").TestContext) {
  const f = await fixture(t);
  await f.config({ allowedProviders: ["mailbox"] });
  const hooks = new Map<string, () => void>();
  let tool: any;
  const root = join(f.dir, "mailboxes");
  mailbox(
    {
      ...f.pi,
      on: (n: string, fn: () => void) => hooks.set(n, fn),
      registerTool: (t: any) => {
        tool = t;
      },
    } as any,
    root,
  );
  hooks.get("session_start")!();
  t.after(() => hooks.get("session_shutdown")!());
  return {
    ...f,
    root,
    tool,
    hooks,
    run: (source: string) => f.run(source, { providers: ["mailbox"] }),
  };
}
test("explicit provider selection, durable gap catch-up, minimal events and lost notification retention", async (t) => {
  const h = await setup(t);
  const schema = await describeScriptProviders(h.pi, h.dir, ["mailbox"]);
  assert.deepEqual(
    schema[0].methods.map((m) => m.name),
    ["send", "list", "observe", "ack"],
  );
  assert.equal(
    (await describeEvents(h.pi, h.dir, ["mailbox"]))[0].provider,
    "mailbox",
  );
  h.pi.events.on("mailbox:changed", () => {
    throw new Error("failed notification");
  });
  const sent = await h.run(
    'return await mailbox.send("project", "question", "PRIVATE question");',
  );
  assert.equal(sent.status, "success");
  const events: unknown[] = [];
  const controller = new AbortController();
  const sub = await subscribeProvider(
    h.pi,
    h.dir,
    ["mailbox"],
    { provider: "mailbox", event: "changed", args: ["project"] },
    {
      signal: controller.signal,
      deadlineMs: Date.now() + 5000,
      emit: (e) => events.push(e),
      lost: () => assert.fail("coverage lost"),
    },
  );
  t.after(() => sub.close());
  const first = await h.run('return await mailbox.list({mailbox: "project"});');
  assert.equal(JSON.parse(first.json!).pending, 1);
  new MailboxStore(h.root).send("project", "result", "PRIVATE result");
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(events.length > 0);
  assert.ok(events.every((e) => JSON.stringify(e) === '{"mailbox":"project"}'));
  sub.close();
  new MailboxStore(h.root).send("project", "question", "registration gap");
  assert.equal(
    JSON.parse(
      (await h.run('return await mailbox.list({mailbox: "project"});')).json!,
    ).pending,
    3,
  );
  await h.config({ allowedProviders: [] });
  assert.notEqual(
    (await h.run('return await mailbox.list({mailbox: "project"});')).status,
    "success",
  );
});
test("supervision recipe executes through real Script with bounded state and sticky invalid policy", async (t) => {
  const h = await setup(t);
  const store = new MailboxStore(h.root);
  for (let i = 0; i < 60; i++) store.send("p", "result", "private body");
  const recipe = mailboxSupervision({ mailbox: "p" });
  const first = await h.run(`const state = null; ${recipe.source}`);
  assert.equal(first.status, "success");
  const value = JSON.parse(first.json!);
  assert.equal(value.decision, "wake");
  assert.equal(value.evidence.pending, 60);
  assert.ok(!first.json!.includes("private body"));
  const second = await h.run(
    `const state = ${JSON.stringify(value.state)}; ${recipe.source}`,
  );
  assert.equal(second.status, "success");
  assert.equal(JSON.parse(second.json!).decision, "wait");
  assert.equal(store.list("p").pending, 60);
  const invalid = await h.run(
    'try { await mailbox.observe("p", null, {ageMs: 60000, reminderMs: 60000}); } catch {} return true;',
  );
  assert.equal(invalid.status, "failed");
  assert.equal(store.list("p").pending, 60);
});
test("invalid direct mutations and caught provider failures cannot conceal host failure", async (t) => {
  const h = await setup(t);
  await assert.rejects(
    h.tool.execute("id", {
      action: "send",
      mailbox: "p",
      type: "result",
      message: "test",
      ids: [],
    }),
    /invalid_input/,
  );
  const result = await h.run(
    'try { await mailbox.send("p", "bad type", "x"); } catch {} return true;',
  );
  assert.equal(result.status, "failed");
  assert.equal(new MailboxStore(h.root).list("p").pending, 0);
});
