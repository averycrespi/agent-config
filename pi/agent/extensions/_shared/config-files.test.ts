import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { readJsonFileObject, readPiSettingsFiles } from "./config.ts";

test("readJsonFileObject returns parsed objects and ignores missing/non-object files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-config-test-"));
  const file = join(dir, "settings.json");
  await writeFile(
    file,
    JSON.stringify({ "extension:x": { enabled: true } }),
    "utf8",
  );

  assert.deepEqual(await readJsonFileObject(file), {
    "extension:x": { enabled: true },
  });
  assert.deepEqual(await readJsonFileObject(join(dir, "missing.json")), {});

  const arrayFile = join(dir, "array.json");
  await writeFile(arrayFile, "[]", "utf8");
  assert.deepEqual(await readJsonFileObject(arrayFile), {});
});

test("readJsonFileObject surfaces parse warnings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-config-test-"));
  const file = join(dir, "settings.json");
  const warnings: string[] = [];
  await writeFile(file, "{ invalid", "utf8");

  assert.deepEqual(await readJsonFileObject(file, warnings), {});
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /Ignoring invalid JSON settings file/);
  assert.match(warnings[0]!, /settings\.json/);
});

test("readPiSettingsFiles reads global and project settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-settings-test-"));
  const agentDir = join(root, "agent");
  const cwd = join(root, "repo");
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ "extension:x": { bankId: "global" } }),
    { encoding: "utf8", flag: "w" },
  ).catch(async () => {
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(agentDir, { recursive: true }),
    );
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ "extension:x": { bankId: "global" } }),
      "utf8",
    );
  });
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(join(cwd, ".pi"), { recursive: true }),
  );
  await writeFile(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({ "extension:x": { bankId: "project" } }),
    "utf8",
  );

  assert.deepEqual(await readPiSettingsFiles({ agentDir, cwd }), {
    globalSettings: { "extension:x": { bankId: "global" } },
    projectSettings: { "extension:x": { bankId: "project" } },
  });
});
