import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// Structural coverage of the published contract, not proof of model behavior.
test("supervision example encodes the agreed finite settlement-based defaults", async () => {
  const skill = await read("./SKILL.md");
  const example = JSON.parse(skill.match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.equal(example.action, "start");
  assert.equal(example.recurring, true);
  assert.deepEqual(example.providers, []);
  assert.equal(example.delay_ms, 20 * 60 * 1000);
  assert.equal(example.cycle_timeout_ms, 25 * 60 * 1000);
  assert.equal(example.lifetime_ms, 12 * 60 * 60 * 1000);
  assert.equal(example.max_wakes, 36);
  assert.ok(example.delay_ms < example.cycle_timeout_ms);
  assert.ok(example.cycle_timeout_ms <= 28 * 60 * 1000);
  assert.ok(example.message.length <= 2000);
  for (const key of ["source", "interval_ms", "events"]) {
    assert.equal(Object.hasOwn(example, key), false);
  }
});

test("supervision preserves authority, uncertain handoffs and original bounds", async () => {
  const skill = await read("./SKILL.md");
  for (const pattern of [
    /Merely loading a skill, launching a worker or receiving a worker message does not authorize supervision/,
    /new defaults do not extend historical authority/,
    /no operation or prior continuation is active, queued, unincorporated or uncertain/,
    /Bound a replacement by remaining time and wakes, never a fresh 12 hours or 36 wakes/,
    /New task labels or successor children do not reset the envelope/,
    /final wake-cap exhaustion may not emit an extra notification/,
    /never poll approval or resume blocked writes/,
    /do not restart work/,
  ]) {
    assert.match(skill, pattern);
  }
});

test("stack includes supervision but standalone spawning does not imply it", async () => {
  const stack = await read("../work-stack/SKILL.md");
  const spawn = await read("../spawn-agent/SKILL.md");
  assert.match(
    stack,
    /Authorized stack execution includes the default bounded watchdog/,
  );
  assert.ok(stack.includes("../supervise/SKILL.md"));
  assert.match(
    stack,
    /inspection or planning alone does not authorize execution or supervision/,
  );
  assert.match(stack, /not per-command grants or parent-inspection freezes/);
  assert.ok(spawn.includes("../supervise/SKILL.md"));
  assert.match(
    spawn,
    /A request to spawn alone does not authorize a recurring watchdog/,
  );
});
