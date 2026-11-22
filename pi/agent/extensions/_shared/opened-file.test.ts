import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _openedFileHooks,
  containedPath,
  openedFileWithin,
} from "./opened-file.ts";

async function fixture() {
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "opened-file-test-")),
  );
  const root = join(base, "store");
  const outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, "inside.js"), "inside");
  await writeFile(join(outside, "secret.js"), "secret");
  return { base, root, outside };
}

// Run every case through the platform's descriptor path and through the
// identity fallback used where descriptors do not resolve (macOS).
for (const mode of ["platform", "identity fallback"] as const) {
  const withMode = async (fn: () => Promise<void>) => {
    const original = _openedFileHooks.descriptorPrefixes;
    if (mode === "identity fallback")
      _openedFileHooks.descriptorPrefixes = ["/nonexistent-descriptor-dir"];
    try {
      await fn();
    } finally {
      _openedFileHooks.descriptorPrefixes = original;
    }
  };

  test(`${mode}: accepts a regular file inside the root`, () =>
    withMode(async () => {
      const { root } = await fixture();
      const path = join(root, "inside.js");
      const handle = await open(path, "r");
      try {
        assert.equal(await openedFileWithin(root, path, handle), true);
      } finally {
        await handle.close();
      }
    }));

  test(`${mode}: rejects a file opened outside the root`, () =>
    withMode(async () => {
      const { root, outside } = await fixture();
      const path = join(outside, "secret.js");
      const handle = await open(path, "r");
      try {
        assert.equal(await openedFileWithin(root, path, handle), false);
      } finally {
        await handle.close();
      }
    }));

  test(`${mode}: rejects a path whose parent was swapped for an outside symlink after open`, () =>
    withMode(async () => {
      const { base, root, outside } = await fixture();
      const nested = join(root, "nested");
      await mkdir(nested);
      const path = join(nested, "entry.js");
      await writeFile(path, "original");
      // Open an outside file, then make the requested path resolve outside.
      const handle = await open(join(outside, "secret.js"), "r");
      try {
        await rename(nested, join(base, "moved"));
        await symlink(outside, nested);
        await rename(join(outside, "secret.js"), join(outside, "entry.js"));
        assert.equal(await openedFileWithin(root, path, handle), false);
      } finally {
        await handle.close();
      }
    }));

  test(`${mode}: rejects when the file at the path was replaced after open`, () =>
    withMode(async () => {
      const { root, outside } = await fixture();
      const path = join(root, "inside.js");
      const handle = await open(join(outside, "secret.js"), "r");
      try {
        // The path still names a contained file, but not the opened one.
        assert.equal(await openedFileWithin(root, path, handle), false);
      } finally {
        await handle.close();
      }
    }));
}

test("containedPath accepts the root and descendants only", () => {
  assert.equal(containedPath("/a/b", "/a/b"), true);
  assert.equal(containedPath("/a/b", "/a/b/c.js"), true);
  assert.equal(containedPath("/a/b", "/a/bc/d.js"), false);
  assert.equal(containedPath("/a/b", "/a"), false);
  assert.equal(containedPath("/a/b", "/a/b/../c"), false);
  assert.equal(containedPath("/a/b", "/a/b/..d/e.js"), true);
});
