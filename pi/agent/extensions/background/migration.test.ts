import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import {
  EVENTS,
  filters,
  project,
  subscribeBus,
  validNotice,
} from "./session-events.ts";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
function files(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(path, e.name))
      : e.isFile()
        ? [join(path, e.name)]
        : [],
  );
}
test("retired extension registrations/imports and active documentation links stay absent", () => {
  for (const name of ["loop", "monitor", "session-watch"])
    assert.equal(existsSync(join(root, "pi/agent/extensions", name)), false);
  for (const path of [
    ...files(join(root, "pi")),
    ...files(join(root, ".pi")),
    join(root, "README.md"),
  ]) {
    if (
      !/\.(?:ts|js|md|json)$/.test(path) ||
      path.endsWith("migration.test.ts")
    )
      continue;
    const text = readFileSync(path, "utf8");
    assert.doesNotMatch(
      text,
      /(?:from\s*|import\s*\()["'][^"']*\/(?:loop|monitor|session-watch)\//,
      path,
    );
    if (/\.(?:ts|js)$/.test(path))
      assert.doesNotMatch(
        text,
        /name:\s*["'](?:loop|monitor|session_watch)["']/,
        path,
      );
    if (path.endsWith(".md"))
      assert.doesNotMatch(
        text,
        /\]\([^)]*(?:extensions\/|\.\.\/)(?:loop|monitor|session-watch)\//,
        path,
      );
  }
});

test("session projection exposes only lifecycle and safe input metadata", () => {
  assert.deepEqual(EVENTS, [
    "agent_start",
    "agent_settled",
    "session_shutdown",
    "ask-user:input_requested",
    "ask-user:input_resolved",
  ]);
  const pi = { events: createEventBus() },
    seen: unknown[] = [];
  const off = subscribeBus(pi, (name, metadata) =>
    seen.push({ name, metadata }),
  );
  const id = "11111111-2222-4333-8444-555555555555";
  pi.events.emit("ask-user:input_requested", {
    requestId: id,
    question: "PRIVATE",
    options: ["PRIVATE"],
  });
  pi.events.emit("ask-user:input_resolved", {
    requestId: id,
    outcome: "cancelled",
    answer: "PRIVATE",
  });
  assert.deepEqual(seen, [
    { name: "ask-user:input_requested", metadata: { requestId: id } },
    {
      name: "ask-user:input_resolved",
      metadata: { requestId: id, outcome: "cancelled" },
    },
  ]);
  assert.doesNotMatch(JSON.stringify(seen), /PRIVATE/);
  for (const name of [
    "monitor:notification",
    "loop:yielded",
    "session-watch:notification",
    "background:notification",
  ]) {
    assert.equal(
      filters([name]),
      false,
      "historical/bookkeeping selectors cannot cause wake feedback",
    );
    pi.events.emit(name, { id });
  }
  assert.equal(seen.length, 2);
  assert.equal(
    project("ask-user:input_resolved", { requestId: id, outcome: "PRIVATE" }),
    undefined,
  );
  assert.equal(
    validNotice({
      name: "agent_settled",
      sequence: 1,
      at: 1,
      metadata: { secret: "PRIVATE" },
    }),
    false,
  );
  off();
  pi.events.emit("ask-user:input_requested", { requestId: id });
  assert.equal(seen.length, 2);
});
