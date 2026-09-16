import assert from "node:assert/strict";
import test from "node:test";
import { AgentSession } from "@earendil-works/pi-coding-agent";
import { assistant, harness, user } from "./test-support.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}

// Real AgentSession.compact + navigation + SessionManager; only model/auth,
// transport, and summary generation are fixtures. No credentials or LLM calls.
function nativeHarness() {
  const h = harness();
  h.sm.appendMessage(user("old history ".repeat(500)));
  h.sm.appendMessage(assistant("old answer ".repeat(500)));
  h.sm.appendMessage(user("recent request"));
  h.sm.appendMessage(assistant("recent answer"));
  const session: any = Object.create(AgentSession.prototype);
  const usage = assistant("").usage;
  let summaries = 0;
  let turns = 0;
  let task: Promise<unknown> | undefined;
  const entered = deferred();
  const release = deferred();
  const settings = { enabled: true, keepRecentTokens: 30, reserveTokens: 10 };
  session.sessionManager = h.sm;
  session._isAgentRunActive = false;
  session.agent = {
    state: {
      model: { id: "fixture" },
      messages: h.sm.buildSessionContext().messages,
    },
    abort() {},
    prompt() {
      turns++;
      throw new Error("must not start agent");
    },
  };
  session.abortRetry = () => {};
  session._emit = () => {};
  session._getSummarizationRequestAuth = async (model: unknown) => ({
    model,
    apiKey: "fixture-not-a-credential",
  });
  session.settingsManager = { getCompactionSettings: () => settings };
  session._runDefaultCompaction = async (preparation: any) => {
    summaries++;
    assert.deepEqual(preparation.settings, settings);
    entered.resolve();
    await release.promise;
    return {
      summary: "fixture native summary",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      usage,
      details: { readFiles: ["example.ts"], modifiedFiles: [] },
    };
  };
  session._extensionRunner = {
    hasHandlers: () => true,
    emit: (event: any) => h.emit(event.type, event),
  };
  h.ctx.isIdle = () => session.isIdle;
  h.ctx.compact = (options) => {
    h.requests.push(options!);
    task = session.compact(options?.customInstructions).then(
      (result: any) => options?.onComplete?.(result),
      (error: Error) => options?.onError?.(error),
    );
  };
  return {
    ...h,
    session,
    entered,
    release,
    usage,
    task: () => task,
    summaries: () => summaries,
    turns: () => turns,
  };
}

test("idle extension uses native preparation, hooks, history and usage without a new turn", async () => {
  const h = nativeHarness();
  await h.start();
  const messageCount = h.sm
    .getEntries()
    .filter((e) => e.type === "message").length;
  h.time.advance(60_000);
  await h.entered.promise;
  assert.equal(h.session.isIdle, false);
  h.time.advance(120_000);
  assert.equal(h.requests.length, 1);
  h.release.resolve();
  await h.task();
  assert.equal(h.summaries(), 1);
  assert.equal(h.turns(), 0);
  const compaction = h.sm.getEntries().find((e) => e.type === "compaction");
  assert.ok(compaction && compaction.type === "compaction");
  assert.equal(compaction.fromHook, false);
  assert.deepEqual(compaction.usage, h.usage);
  assert.deepEqual(compaction.details, {
    readFiles: ["example.ts"],
    modifiedFiles: [],
  });
  assert.equal(
    h.sm.getEntries().filter((e) => e.type === "message").length,
    messageCount,
  );
  await h.command();
  assert.match(h.notifications.at(-1)!, /completed/);
  await h.start();
  h.time.advance(60_000);
  assert.equal(h.requests.length, 1);
});

test("timer-boundary input during native admission cancels before summary generation", async () => {
  const h = nativeHarness();
  await h.start();
  h.time.advance(60_000);
  h.input();
  await h.task();
  assert.equal(h.summaries(), 0);
  assert.equal(h.turns(), 0);
  assert.equal(
    h.sm.getEntries().filter((e) => e.type === "compaction").length,
    0,
  );
  await h.command();
  assert.match(h.notifications.at(-1)!, /cancelled/);
  h.time.advance(120_000);
  assert.equal(h.requests.length, 1);
});

test("native cancellation after generation starts records cancelled and never retries", async () => {
  const h = nativeHarness();
  await h.start();
  h.time.advance(60_000);
  await h.entered.promise;
  h.session.abortCompaction();
  h.release.resolve();
  await h.task();
  assert.equal(
    h.sm.getEntries().filter((e) => e.type === "compaction").length,
    0,
  );
  await h.command();
  assert.match(h.notifications.at(-1)!, /cancelled/);
  await h.start();
  h.time.advance(60_000);
  assert.equal(h.requests.length, 1);
});

test("native failure is recorded without exposing raw error or triggering agent work", async () => {
  const h = nativeHarness();
  h.session._runDefaultCompaction = async () => {
    throw new Error("private error content");
  };
  await h.start();
  h.time.advance(60_000);
  await h.task();
  await h.command();
  assert.match(h.notifications.at(-1)!, /failed/);
  assert.doesNotMatch(h.notifications.join("\n"), /private error content/);
  assert.equal(h.turns(), 0);
  h.time.advance(120_000);
  assert.equal(h.requests.length, 1);
});

test("accepted Pi 0.85.1 limitation: navigation can misattach native summary; stale extension callback writes nothing", async () => {
  const h = nativeHarness();
  const originalLeaf = h.sm.getLeafId()!;
  const root = h.sm.getBranch()[0].id;
  h.sm.branch(root);
  h.sm.appendMessage(user("other branch"));
  const other = h.sm.appendMessage(assistant("other answer"));
  h.sm.branch(originalLeaf);
  await h.start();
  h.time.advance(60_000);
  await h.entered.promise;
  await h.session.navigateTree(other, { summarize: false });
  const metadataCount = h.sm
    .getEntries()
    .filter((e) => e.type === "custom").length;
  h.release.resolve();
  await h.task();
  const last = h.sm.getEntries().at(-1);
  assert.equal(last?.type, "compaction");
  assert.equal(last?.parentId, other);
  assert.equal(
    h.sm.getEntries().filter((e) => e.type === "custom").length,
    metadataCount,
  );
  assert.equal(h.turns(), 0);
});
