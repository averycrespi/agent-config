import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fetchGitHub,
  isGitHubRateLimitError,
  parseGitHubUrl,
} from "./github.ts";

test("parseGitHubUrl returns null for non-URL input", () => {
  assert.equal(parseGitHubUrl("not a url"), null);
  assert.equal(parseGitHubUrl(""), null);
});

test("parseGitHubUrl returns null for non-github hosts", () => {
  assert.equal(parseGitHubUrl("https://gitlab.com/foo/bar"), null);
  assert.equal(
    parseGitHubUrl("https://raw.githubusercontent.com/foo/bar"),
    null,
  );
});

test("parseGitHubUrl returns null when owner or repo is missing", () => {
  assert.equal(parseGitHubUrl("https://github.com"), null);
  assert.equal(parseGitHubUrl("https://github.com/"), null);
  assert.equal(parseGitHubUrl("https://github.com/foo"), null);
  assert.equal(parseGitHubUrl("https://github.com/foo/"), null);
});

test("parseGitHubUrl parses a bare owner/repo URL", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/badlogic/pi-mono"), {
    owner: "badlogic",
    repo: "pi-mono",
  });
});

test("parseGitHubUrl strips a trailing '.git' from the repo name", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/badlogic/pi-mono.git"), {
    owner: "badlogic",
    repo: "pi-mono",
  });
});

test("parseGitHubUrl tolerates a trailing slash", () => {
  assert.deepEqual(parseGitHubUrl("https://github.com/badlogic/pi-mono/"), {
    owner: "badlogic",
    repo: "pi-mono",
  });
});

test("parseGitHubUrl parses tree URLs with ref and nested path", () => {
  assert.deepEqual(
    parseGitHubUrl(
      "https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent",
    ),
    {
      owner: "badlogic",
      repo: "pi-mono",
      type: "tree",
      ref: "main",
      path: "packages/coding-agent",
    },
  );
});

test("parseGitHubUrl parses blob URLs with ref and file path", () => {
  assert.deepEqual(
    parseGitHubUrl("https://github.com/badlogic/pi-mono/blob/main/README.md"),
    {
      owner: "badlogic",
      repo: "pi-mono",
      type: "blob",
      ref: "main",
      path: "README.md",
    },
  );
});

test("parseGitHubUrl ignores unknown third segments (not blob/tree)", () => {
  assert.deepEqual(
    parseGitHubUrl("https://github.com/badlogic/pi-mono/issues/42"),
    { owner: "badlogic", repo: "pi-mono" },
  );
});

test("parseGitHubUrl parses tree URL with ref but no path", () => {
  assert.deepEqual(
    parseGitHubUrl("https://github.com/badlogic/pi-mono/tree/main"),
    {
      owner: "badlogic",
      repo: "pi-mono",
      type: "tree",
      ref: "main",
    },
  );
});

test("isGitHubRateLimitError detects 403/429 and rate-limit bodies", () => {
  assert.equal(
    isGitHubRateLimitError(
      new Error("GitHub API HTTP 403: rate limit exceeded"),
    ),
    true,
  );
  assert.equal(
    isGitHubRateLimitError(new Error("HTTP 429 from github.com")),
    true,
  );
  assert.equal(isGitHubRateLimitError(new Error("File not found")), false);
});

test("fetchGitHub rejects immediately when the signal is already aborted", async () => {
  const owner = "pi-test-owner";
  const repo = "abort-repo";
  const clonePath = join("/tmp/pi-github-repos", owner, repo);
  await rm(join("/tmp/pi-github-repos", owner), {
    recursive: true,
    force: true,
  });
  await mkdir(join(clonePath, ".git"), { recursive: true });
  await writeFile(join(clonePath, "README.md"), "readme");
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () =>
      fetchGitHub(
        { owner, repo, type: "blob", path: "README.md" },
        10_000,
        controller.signal,
      ),
    { name: "AbortError" },
  );
});

test("fetchGitHub uses a ref-specific clone path for blob URLs", async () => {
  const owner = "pi-test-owner";
  const repo = "ref-repo";
  const oldPath = join("/tmp/pi-github-repos", owner, repo);
  const refPath = join(
    "/tmp/pi-github-repos",
    owner,
    `${repo}--feature_branch`,
  );
  await rm(join("/tmp/pi-github-repos", owner), {
    recursive: true,
    force: true,
  });
  await mkdir(join(oldPath, ".git"), { recursive: true });
  await mkdir(join(refPath, ".git"), { recursive: true });
  await writeFile(join(oldPath, "README.md"), "default branch");
  await writeFile(join(refPath, "README.md"), "feature branch");

  const result = await fetchGitHub(
    {
      owner,
      repo,
      type: "blob",
      ref: "feature/branch",
      path: "README.md",
    },
    10_000,
  );

  assert.equal(result.clonePath, refPath);
  assert.match(result.text, /feature branch/);
  assert.doesNotMatch(result.text, /default branch/);
});
