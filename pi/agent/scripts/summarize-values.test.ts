import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { savedFixture } from "../extensions/script/saved-fixture.ts";

test("actual saved summary uses the generic named runtime in foreground and background", async (t) => {
  const h = await savedFixture(t);
  await copyFile(
    resolve(import.meta.dirname, "summarize-values.js"),
    join(h.store, "summarize-values.js"),
  );
  const input = {
    action: "run",
    name: "summarize-values",
    providers: [],
    args: { values: [2, 3, 5] },
  };
  const foreground = await h.call(input);
  assert.equal(foreground.details.status, "success");
  assert.match(foreground.content[1].text, /"count":3,"total":10/);
  await assert.rejects(
    h.call({ ...input, args: { values: ["2"] } }),
    /invalid_arguments/,
  );
  const terminal = h.terminal();
  const admitted = await h.call({ ...input, execution: "background" });
  await terminal;
  const record = h.service.inspect("script", admitted.details.records[0].id);
  assert.equal(record.status, "success");
  assert.deepEqual(JSON.parse((record.result as any).json), {
    count: 3,
    total: 10,
  });
  assert.equal(h.messages.length, 1);
});
