import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { realpathSync, chmodSync } from "node:fs";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Bridge, subscribeEvents } from "./session-transport.ts";

test("continuous subscriptions retain ordered events after ACK and report disconnect", async (t) => {
  const root = await mkdtemp(join(realpathSync("/tmp"), "pi-stream-"));
  const bridge = new Bridge(root, randomUUID());
  await bridge.start();
  const events: number[] = [];
  let lost = 0;
  t.after(async () => {
    bridge.close();
    await rm(root, { recursive: true, force: true });
  });
  bridge.publish("agent_settled", {});
  const sub = await subscribeEvents(
    root,
    bridge.target.incarnation,
    ["agent_settled"],
    5000,
    (n) => events.push(n.sequence),
    () => lost++,
  );
  bridge.publish("agent_settled", {});
  bridge.publish("agent_settled", {});
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(events, [2, 3]);
  assert.equal(sub.target.incarnation, bridge.target.incarnation);
  bridge.close();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(lost, 1);
  sub.close();
  assert.equal(lost, 1);
});

test(
  "cross-process subscription observes multiple safe producer events, then loses coverage on reload",
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(realpathSync("/tmp"), "pi-stream-child-"));
    const child = fork(
      new URL("./session-fixture-worker.ts", import.meta.url),
      [root],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    const exited = once(child, "exit");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
      await rm(root, { recursive: true, force: true });
    });
    const [ready] = await Promise.race([
      once(child, "message"),
      exited.then(() => {
        throw new Error("fixture exited");
      }),
    ]);
    const call = async (command: string) => {
      const response = once(child, "message");
      child.send({ command, id: randomUUID() });
      const [result] = await response;
      assert.notEqual(result.error, true);
      return result;
    };
    await call("ask");
    const seen: any[] = [];
    let lost = 0;
    const sub = await subscribeEvents(
      root,
      ready.ready.incarnation,
      ["ask-user:input_requested", "ask-user:input_resolved", "agent_settled"],
      10000,
      (n) => seen.push(n),
      () => lost++,
    );
    await call("ask");
    await call("pending");
    const childState = await call("settled");
    assert.deepEqual(
      childState.jobs,
      ["active"],
      "settlement is not CI completion",
    );
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(
      seen.map((n) => n.name),
      ["ask-user:input_requested", "ask-user:input_resolved", "agent_settled"],
    );
    assert.doesNotMatch(
      JSON.stringify(seen),
      /PRIVATE|question|answer|option|source/,
    );
    await call("reload");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(lost, 1);
    await call("settled");
    assert.equal(seen.length, 3);
    sub.close();
    await call("stop");
  },
);

test("continuous wire rejects stale identity/sequence and preserves ACK-adjacent events", async (t) => {
  const root = await mkdtemp(join(realpathSync("/tmp"), "pi-stream-wire-"));
  const keepalive = setInterval(() => {}, 1000);
  t.after(async () => {
    clearInterval(keepalive);
    await rm(root, { recursive: true, force: true });
  });
  for (const invalid of ["identity", "sequence", "metadata"]) {
    const target = randomUUID(),
      path = join(root, `${target}.sock`);
    let sendInvalid!: () => void;
    const server = createServer((socket) =>
      socket.once("data", (chunk) => {
        const { nonce } = JSON.parse(String(chunk));
        const notice = {
          target,
          nonce,
          event: { name: "agent_settled", at: 2, sequence: 1, metadata: {} },
        };
        socket.write(
          JSON.stringify({
            incarnation: target,
            sessionId: randomUUID(),
            nonce,
            startedAt: 1,
            sequence: 0,
          }) +
            "\n" +
            JSON.stringify(notice) +
            "\n",
        );
        sendInvalid = () => {
          socket.write(
            JSON.stringify({
              ...notice,
              ...(invalid === "identity" ? { target: randomUUID() } : {}),
              event: {
                ...notice.event,
                sequence: invalid === "sequence" ? 1 : 2,
                metadata: invalid === "metadata" ? { private: "SECRET" } : {},
              },
            }) + "\n",
          );
        };
      }),
    );
    t.after(() => server.close());
    server.listen(path);
    await once(server, "listening");
    chmodSync(path, 0o600);
    const seen: number[] = [];
    let loss!: () => void;
    const lost = new Promise<void>((resolve) => {
      loss = resolve;
    });
    const sub = await subscribeEvents(
      root,
      target,
      ["agent_settled"],
      5000,
      (n) => seen.push(n.sequence),
      loss,
    );
    sendInvalid();
    await lost;
    assert.deepEqual(seen, [1]);
    sub.close();
    server.close();
  }
});
