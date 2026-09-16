import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { chmodSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createConnection } from "node:net";
import { once } from "node:events";
import {
  Bridge,
  checkRoot,
  discover,
  subscribeEvents,
} from "./session-transport.ts";
import { temporaryRoot } from "./test-support.ts";

async function fixture(t: any) {
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
test("migrated subscriptions reject unsafe directories, endpoints, selectors and stale incarnations", async (t) => {
  const { root, bridge } = await fixture(t);
  assert.deepEqual(await discover(root), [bridge.target]);
  chmodSync(root, 0o755);
  assert.throws(() => checkRoot(root));
  chmodSync(root, 0o700);
  const regular = randomUUID(),
    link = randomUUID();
  writeFileSync(join(root, `${regular}.sock`), "PRIVATE", { mode: 0o600 });
  symlinkSync(
    join(root, `${bridge.target.incarnation}.sock`),
    join(root, `${link}.sock`),
  );
  const subscribe = (id: string, names: any = ["agent_settled"]) =>
    subscribeEvents(
      root,
      id,
      names,
      1000,
      () => {},
      () => {},
    );
  for (const id of [regular, link, "../bad"])
    await assert.rejects(subscribe(id));
  await assert.rejects(
    subscribe(bridge.target.incarnation, ["background:notification"]),
  );
  bridge.close();
  const replacement = new Bridge(root, bridge.target.sessionId);
  await replacement.start();
  try {
    assert.notEqual(replacement.target.incarnation, bridge.target.incarnation);
    await assert.rejects(subscribe(bridge.target.incarnation));
  } finally {
    replacement.close();
  }
});

test(
  "oversized peer requests and absolute handshake expiry preserve another subscription",
  { timeout: 5000 },
  async (t) => {
    const { root, bridge } = await fixture(t);
    let matched!: () => void;
    const match = new Promise<void>((resolve) => {
      matched = resolve;
    });
    const sub = await subscribeEvents(
      root,
      bridge.target.incarnation,
      ["agent_settled"],
      4000,
      matched,
      () => {},
    );
    t.after(sub.close);
    const peer = createConnection(
      join(root, `${bridge.target.incarnation}.sock`),
    );
    peer.on("error", () => {});
    peer.write("x".repeat(9000));
    await once(peer, "close");
    const slow = createConnection(
      join(root, `${bridge.target.incarnation}.sock`),
    );
    slow.on("error", () => {});
    await once(slow, "connect");
    const drip = setInterval(() => slow.write(" "), 100);
    t.after(() => {
      clearInterval(drip);
      slow.destroy();
    });
    await once(slow, "close");
    bridge.publish("agent_settled", {});
    await match;
  },
);

test("bounded discovery does not delete stale or unrelated files", async (t) => {
  const { root } = await fixture(t);
  for (let i = 0; i < 129; i++)
    writeFileSync(join(root, `${i}.txt`), "retained");
  await assert.rejects(discover(root));
});
