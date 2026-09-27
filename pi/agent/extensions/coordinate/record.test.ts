import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readIndex, persistIndex, updateIndex } from "./record.js";

test("private record preserves multiline historical evidence and rejects stale or malformed writes", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "coordinate-record-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", cwd]);
  const values = {
    "Owner and authority": "original owner\nScope: second line",
    Assignments: JSON.stringify([
      { assignmentId: "example", brief: "line one\nline two" },
    ]),
    Mailbox: '{\n  "questions": {}\n}',
    Decisions: "    indented text\n\n### Rationale\n\nKeep trailing space  ",
    Next: "inspect",
  };
  await persistIndex({
    cwd,
    id: "example",
    expected: null,
    values,
    attemptId: "create",
  });
  const first = await readIndex(cwd, "example");
  assert.deepEqual(first.values, values);
  await updateIndex({
    cwd,
    id: "example",
    expected: first.digest,
    changes: { Next: "continue" },
    attemptId: "update",
  });
  const second = await readIndex(cwd, "example");
  assert.deepEqual(second.values, { ...values, Next: "continue" });
  await assert.rejects(
    updateIndex({
      cwd,
      id: "example",
      expected: first.digest,
      changes: { Next: "stale" },
      attemptId: "stale",
    }),
    /changed/,
  );
  for (const changes of [
    { Next: null },
    { Assignments: "" },
    { Unknown: "value" },
  ] as Record<string, string | null>[])
    await assert.rejects(
      updateIndex({
        cwd,
        id: "example",
        expected: second.digest,
        changes,
        attemptId: "invalid",
      }),
    );
  assert.equal((await readIndex(cwd, "example")).text, second.text);
  for (const malformed of [
    second.text!.replace("## Assignments", "## Unknown"),
    second.text!.replace("## Assignments", "## Owner and authority"),
    second.text!.replace("# Coordination example", "# Coordination other"),
  ]) {
    await writeFile(second.path, malformed);
    await assert.rejects(readIndex(cwd, "example"));
    await assert.rejects(
      persistIndex({
        cwd,
        id: "example",
        expected: second.digest,
        values,
        attemptId: "overwrite",
      }),
    );
    assert.equal(await readFile(second.path, "utf8"), malformed);
  }
  await rm(second.path);
  const target = join(cwd, "unrelated");
  await writeFile(target, "preserve");
  await symlink(target, second.path);
  await assert.rejects(readIndex(cwd, "example"), /unsafe/);
  await assert.rejects(
    persistIndex({
      cwd,
      id: "example",
      expected: null,
      values,
      attemptId: "unsafe",
    }),
    /unsafe/,
  );
  assert.equal(await readFile(target, "utf8"), "preserve");
});
