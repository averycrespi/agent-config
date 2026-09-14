import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { chmodSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createConnection, createServer } from "node:net";
import { Bridge, checkRoot, discover, observe } from "./transport.ts";
import { project, filters, validNotice } from "./events.ts";
import { temporaryRoot, pause, harness, value } from "./test-support.ts";

async function bridgeFixture(t: any) {
  const temp = temporaryRoot(),
    bridge = new Bridge(temp.root, randomUUID());
  const keepalive = setInterval(() => {}, 1000);
  t.after(() => {
    bridge.close();
    clearInterval(keepalive);
    temp.remove();
  });
  await bridge.start();
  return { ...temp, bridge };
}

test("pre-registration events are excluded; ACK then immediate match is not lost; disconnect never reconnects", async (t) => {
  const { bridge, root } = await bridgeFixture(t);
  bridge.publish("agent_settled", {});
  const watch = await observe(
    root,
    bridge.target.incarnation,
    ["agent_settled"],
    5000,
  );
  let settled = false;
  void watch.result.then(() => {
    settled = true;
  });
  await pause();
  assert.equal(settled, false);
  bridge.publish("agent_start", {});
  await pause();
  assert.equal(settled, false);
  bridge.publish("agent_settled", {});
  bridge.publish("agent_settled", {});
  assert.equal((await watch.result)?.sequence, 3);
  const next = await observe(
    root,
    bridge.target.incarnation,
    ["agent_settled"],
    5000,
  );
  bridge.close();
  assert.equal(await next.result, undefined);
  const replacement = new Bridge(root, bridge.target.sessionId);
  await replacement.start();
  try {
    assert.notEqual(replacement.target.incarnation, bridge.target.incarnation);
    await assert.rejects(
      observe(root, bridge.target.incarnation, ["agent_settled"], 5000),
    );
  } finally {
    replacement.close();
  }
});

test("unsafe root, symlink/regular-file endpoints and invalid filters fail closed", async (t) => {
  const { root, bridge } = await bridgeFixture(t);
  assert.deepEqual(await discover(root), [bridge.target]);
  chmodSync(root, 0o755);
  assert.throws(() => checkRoot(root));
  chmodSync(root, 0o700);
  const target = randomUUID(),
    path = join(root, `${target}.sock`);
  writeFileSync(path, "PRIVATE", { mode: 0o600 });
  await assert.rejects(observe(root, target, ["agent_settled"], 1000));
  const other = randomUUID();
  symlinkSync(
    join(root, `${bridge.target.incarnation}.sock`),
    join(root, `${other}.sock`),
  );
  await assert.rejects(observe(root, other, ["agent_settled"], 1000));
  await assert.rejects(observe(root, "../bad", ["agent_settled"], 1000));
  await assert.rejects(
    observe(
      root,
      bridge.target.incarnation,
      ["session-watch:terminated"] as any,
      1000,
    ),
  );
  assert.equal(filters(["monitor:terminated", "monitor:terminated"]), false);
});

test("bounded wire validation rejects wrong identities, stale sequences, unexpected metadata and oversized records", async (t) => {
  const temp = temporaryRoot();
  const keepalive = setInterval(() => {}, 1000);
  t.after(() => {
    clearInterval(keepalive);
    temp.remove();
  });
  for (const kind of [
    "identity",
    "sequence",
    "metadata",
    "oversized",
    "early-event",
  ] as const) {
    const target = randomUUID(),
      path = join(temp.root, `${target}.sock`);
    const server = createServer((socket) => {
      socket.once("data", (chunk) => {
        const request = JSON.parse(String(chunk));
        const ack = {
          incarnation: target,
          sessionId: randomUUID(),
          nonce: request.nonce,
          startedAt: 1,
          sequence: 1,
        };
        const event = {
          target: kind === "identity" ? randomUUID() : target,
          nonce: request.nonce,
          event: {
            name: "agent_settled",
            sequence: kind === "sequence" ? 1 : 2,
            at: 2,
            metadata: kind === "metadata" ? { private: "PRIVATE" } : {},
          },
        };
        socket.end(
          kind === "oversized"
            ? "x".repeat(9000)
            : (kind === "early-event" ? "" : JSON.stringify(ack) + "\n") +
                JSON.stringify(event) +
                "\n",
        );
      });
    });
    server.listen(path);
    await once(server, "listening");
    chmodSync(path, 0o600);
    try {
      if (["oversized", "early-event"].includes(kind))
        await assert.rejects(
          observe(temp.root, target, ["agent_settled"], 1000),
        );
      else
        assert.equal(
          await (
            await observe(temp.root, target, ["agent_settled"], 1000)
          ).result,
          undefined,
        );
    } finally {
      server.close();
    }
  }
});

test("raw bus payloads project to bounded identity/enums only and watcher bookkeeping is excluded", () => {
  const id = randomUUID();
  assert.deepEqual(
    project("loop:yielded", {
      type: "yielded",
      loop: {
        id,
        status: "yielded",
        message: "PRIVATE instruction",
        detail: "PRIVATE reason",
      },
    }),
    { id, status: "yielded" },
  );
  assert.deepEqual(
    project("ask-user:input_requested", { requestId: id, question: "PRIVATE" }),
    { requestId: id },
  );
  assert.equal(
    project("monitor:notification", { id, notification: "PRIVATE" }),
    undefined,
  );
  assert.equal(filters(["session-watch:notification"]), false);
  assert.equal(
    validNotice({
      name: "agent_settled",
      at: 1,
      sequence: 1,
      metadata: { question: "PRIVATE" },
    }),
    false,
  );
});

test(
  "two-process real publishers: input attention, zero pending messages, settlement during CI wait, one follow-up, replacement",
  { timeout: 15000 },
  async (t) => {
    const temp = temporaryRoot();
    const parent = harness(temp.root);
    const child = fork(
      new URL("./fixture-worker.ts", import.meta.url),
      [temp.root],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    const exited = once(child, "exit");
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    t.after(async () => {
      await parent.hook("session_shutdown");
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
      temp.remove();
    });
    const [ready] = await Promise.race([
      once(child, "message"),
      exited.then(() => {
        throw Error(`fixture exited before readiness: ${stderr}`);
      }),
    ]);
    assert.ok(ready.ready, stderr);
    await parent.hook("session_start");
    const call = (command: string) =>
      new Promise<any>((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(
          () => reject(Error(`fixture ${command} timed out: ${stderr}`)),
          3000,
        );
        const listener = (data: any) => {
          if (data.id !== id) return;
          child.off("message", listener);
          clearTimeout(timer);
          resolve(data);
        };
        child.on("message", listener);
        child.send({ command, id });
      });
    const start = async (events: string[]) =>
      value(
        await parent.call({
          action: "start",
          target: ready.ready.incarnation,
          name: "api-worker",
          events,
          timeout_ms: 5000,
          message: "Inspect attention only",
        }),
      );
    await call("ask"); // predates registration; never replayed
    const a = await start(["ask-user:input_requested"]);
    await pause(50);
    assert.equal(parent.messages.length, 0);
    await call("ask");
    await pause(50);
    assert.equal(parent.messages.length, 1);
    assert.equal(parent.messages[0].message.details.id, a.id);
    assert.equal(
      parent.messages[0].message.details.event.name,
      "ask-user:input_requested",
    );
    assert.doesNotMatch(JSON.stringify(parent.messages), /PRIVATE/);
    assert.deepEqual(parent.messages[0].options, {
      deliverAs: "followUp",
      triggerTurn: true,
    });
    const b = await start(["agent_settled"]);
    await call("monitor");
    const state = await call("settled");
    await pause(50);
    assert.ok(
      state.monitors.some((s: string) => ["waiting", "observing"].includes(s)),
    );
    assert.equal(parent.messages.length, 2);
    assert.equal(parent.messages[1].message.details.id, b.id);
    assert.equal(
      parent.messages[1].message.details.event.name,
      "agent_settled",
    );
    assert.match(
      parent.messages[1].message.content,
      /not proof of task completion or green CI/,
    );
    const c = await start(["ask-user:input_requested"]);
    await call("reload");
    await pause(50);
    assert.equal(parent.messages[2].message.details.id, c.id);
    assert.equal(parent.messages[2].message.details.state, "failure");
    await call("ask");
    await pause();
    assert.equal(parent.messages.length, 3);
    const old = await parent.call({
      action: "start",
      target: ready.ready.incarnation,
      events: ["agent_settled"],
      timeout_ms: 1000,
      message: "No replacement",
    });
    assert.equal(old.details.watchError, true);
    await call("stop");
  },
);

test("oversized incoming request disconnects without affecting another subscription", async (t) => {
  const { root, bridge } = await bridgeFixture(t);
  const watch = await observe(
    root,
    bridge.target.incarnation,
    ["agent_settled"],
    1000,
  );
  const bad = createConnection(join(root, `${bridge.target.incarnation}.sock`));
  bad.on("error", () => {});
  bad.write("x".repeat(9000));
  await new Promise<void>((resolve) => bad.once("close", resolve));
  bridge.publish("agent_settled", {});
  assert.equal((await watch.result)?.name, "agent_settled");
});

test("a match in the same read as the ACK survives before start returns", async (t) => {
  const temp = temporaryRoot();
  const keepalive = setInterval(() => {}, 1000);
  const target = randomUUID(),
    sessionId = randomUUID(),
    path = join(temp.root, `${target}.sock`);
  const server = createServer((socket) =>
    socket.once("data", (chunk) => {
      const { nonce } = JSON.parse(String(chunk));
      socket.end(
        JSON.stringify({
          incarnation: target,
          sessionId,
          nonce,
          startedAt: 1,
          sequence: 0,
        }) +
          "\n" +
          JSON.stringify({
            target,
            nonce,
            event: { name: "agent_settled", at: 2, sequence: 1, metadata: {} },
          }) +
          "\n",
      );
    }),
  );
  t.after(() => {
    server.close();
    clearInterval(keepalive);
    temp.remove();
  });
  server.listen(path);
  await once(server, "listening");
  chmodSync(path, 0o600);
  const observation = await observe(temp.root, target, ["agent_settled"], 1000);
  assert.deepEqual(observation.target, { incarnation: target, sessionId });
  assert.equal((await observation.result)?.sequence, 1);
});

test(
  "absolute handshake expires even when a peer keeps dripping bytes",
  { timeout: 5000 },
  async (t) => {
    const { root, bridge } = await bridgeFixture(t);
    const socket = createConnection(
      join(root, `${bridge.target.incarnation}.sock`),
    );
    socket.on("error", () => {});
    await once(socket, "connect");
    const started = Date.now(),
      drip = setInterval(() => socket.write(" "), 100);
    t.after(() => {
      clearInterval(drip);
      socket.destroy();
    });
    await new Promise<void>((resolve) => socket.once("close", resolve));
    assert.ok(Date.now() - started < 3000);
  },
);

test("discovery refuses overfull directory rather than silently returning a partial inventory", async (t) => {
  const temp = temporaryRoot();
  t.after(temp.remove);
  for (let i = 0; i < 129; i++) writeFileSync(join(temp.root, `${i}.txt`), "");
  await assert.rejects(discover(temp.root));
});
