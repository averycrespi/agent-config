import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test, mock } from "node:test";

import { _loggingFs, createManagedLogger } from "./logging.ts";

test("createManagedLogger creates sanitized logs under the shared temp root", async () => {
  const root = await mkdtemp(join(tmpdir(), "managed-logger-test-"));
  const tmpStub = mock.method(_loggingFs, "tmpdir", () => root);

  try {
    const logger = createManagedLogger({
      extensionName: "sub agents/../x",
      id: "tool call/1",
    });
    logger.write("hello");
    await logger.close();

    assert.equal(
      dirname(logger.path),
      join(root, "pi-extension-logs", "sub_agents____x"),
    );
    assert.equal(basename(logger.path), "tool_call_1.log");
    assert.equal(await readFile(logger.path, "utf8"), "hello");
    assert.equal((await stat(logger.path)).mode & 0o777, 0o600);
  } finally {
    tmpStub.mock.restore();
  }
});

test("createManagedLogger chooses a unique path when the requested id exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "managed-logger-test-"));
  const dir = join(root, "pi-extension-logs", "subagents");
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(dir, { recursive: true }),
  );
  await writeFile(join(dir, "run.log"), "old", "utf8");

  const tmpStub = mock.method(_loggingFs, "tmpdir", () => root);
  const nowStub = mock.method(_loggingFs, "now", () => 1234);

  try {
    const logger = createManagedLogger({
      extensionName: "subagents",
      id: "run",
    });
    logger.write("new");
    await logger.close();

    assert.equal(basename(logger.path), "run-1234.log");
    assert.equal(await readFile(join(dir, "run.log"), "utf8"), "old");
    assert.equal(await readFile(logger.path, "utf8"), "new");
  } finally {
    tmpStub.mock.restore();
    nowStub.mock.restore();
  }
});

test("ManagedLogger writes raw string and buffer chunks", async () => {
  const root = await mkdtemp(join(tmpdir(), "managed-logger-test-"));
  const tmpStub = mock.method(_loggingFs, "tmpdir", () => root);

  try {
    const logger = createManagedLogger({ extensionName: "x", id: "raw" });
    logger.write("Authorization: Bearer secret-token\n");
    logger.write(Buffer.from("token=abc123\n"));
    await logger.close();

    assert.equal(
      await readFile(logger.path, "utf8"),
      "Authorization: Bearer secret-token\ntoken=abc123\n",
    );
  } finally {
    tmpStub.mock.restore();
  }
});

test("createManagedLogger removes old retained logs lazily", async () => {
  const root = await mkdtemp(join(tmpdir(), "managed-logger-test-"));
  const tmpStub = mock.method(_loggingFs, "tmpdir", () => root);
  const now = Date.now();
  const nowStub = mock.method(_loggingFs, "now", () => now);

  try {
    const dir = join(root, "pi-extension-logs", "x");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(dir, { recursive: true }),
    );
    const oldLog = join(dir, "old.log");
    const freshLog = join(dir, "fresh.log");
    const ignored = join(dir, "old.txt");
    await writeFile(oldLog, "old", "utf8");
    await writeFile(freshLog, "fresh", "utf8");
    await writeFile(ignored, "ignored", "utf8");
    const oldMtime = now - 8 * 24 * 60 * 60 * 1000;
    const freshMtime = now;
    const statStub = mock.method(_loggingFs, "statSync", (path: string) => ({
      isFile: () => true,
      mtimeMs: path === freshLog ? freshMtime : oldMtime,
    }));

    const logger = createManagedLogger({ extensionName: "x", id: "run" });
    await logger.close();

    assert.equal(existsSync(oldLog), false);
    assert.equal(existsSync(freshLog), true);
    assert.equal(existsSync(ignored), true);
    statStub.mock.restore();
  } finally {
    tmpStub.mock.restore();
    nowStub.mock.restore();
  }
});

test("ManagedLogger delete removes the log and ignores missing files", async () => {
  const root = await mkdtemp(join(tmpdir(), "managed-logger-test-"));
  const tmpStub = mock.method(_loggingFs, "tmpdir", () => root);

  try {
    const logger = createManagedLogger({ extensionName: "x", id: "cleanup" });
    logger.write("content");
    await logger.close();

    assert.equal(existsSync(logger.path), true);
    logger.delete();
    assert.equal(existsSync(logger.path), false);
    assert.doesNotThrow(() => logger.delete());
  } finally {
    tmpStub.mock.restore();
  }
});
