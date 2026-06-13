import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PREVIEW_BYTES,
  THRESHOLD_CHARS,
  buildEnvelope,
  joinText,
  cleanupOldSpilloverFiles,
  spillIfNeeded,
} from "./spillover.ts";

// ---------------------------------------------------------------------------
// joinText
// ---------------------------------------------------------------------------

describe("joinText", () => {
  test("returns empty string for empty content", () => {
    assert.equal(joinText([]), "");
  });

  test("returns empty string for image-only content", () => {
    assert.equal(joinText([{ type: "image", url: "x" }]), "");
  });

  test("returns text from a single text block", () => {
    assert.equal(joinText([{ type: "text", text: "hello" }]), "hello");
  });

  test("joins multiple text blocks with newline", () => {
    assert.equal(
      joinText([
        { type: "text", text: "foo" },
        { type: "text", text: "bar" },
      ]),
      "foo\nbar",
    );
  });

  test("ignores image blocks between text blocks", () => {
    assert.equal(
      joinText([
        { type: "text", text: "a" },
        { type: "image", url: "x" },
        { type: "text", text: "b" },
      ]),
      "a\nb",
    );
  });
});

// ---------------------------------------------------------------------------
// buildEnvelope
// ---------------------------------------------------------------------------

describe("buildEnvelope", () => {
  test("wraps in persisted-output tags", () => {
    const env = buildEnvelope({
      filePath: "/tmp/test.txt",
      originalSize: 100,
      joinedText: "hello world",
    });
    assert.ok(env.startsWith("<persisted-output>\n"));
    assert.ok(env.endsWith("\n</persisted-output>"));
  });

  test("path is backtick-wrapped", () => {
    const env = buildEnvelope({
      filePath: "/tmp/pi-extension-spillover/call_abc.txt",
      originalSize: 100,
      joinedText: "hello",
    });
    assert.ok(env.includes("`/tmp/pi-extension-spillover/call_abc.txt`"));
  });

  test("header shows KB and char count", () => {
    const joinedText = "x".repeat(10240); // 10 KB
    const env = buildEnvelope({
      filePath: "/tmp/t.txt",
      originalSize: joinedText.length,
      joinedText,
    });
    assert.ok(env.includes("10.0 KB / 10240 chars"));
  });

  test("preview contains first PREVIEW_BYTES chars of joined text", () => {
    const joinedText = "a".repeat(5000);
    const env = buildEnvelope({
      filePath: "/tmp/t.txt",
      originalSize: joinedText.length,
      joinedText,
    });
    const expected = "a".repeat(PREVIEW_BYTES);
    assert.ok(env.includes(expected));
  });

  test("preview heading derives its byte label from PREVIEW_BYTES", () => {
    const env = buildEnvelope({
      filePath: "/tmp/t.txt",
      originalSize: 5000,
      joinedText: "a".repeat(5000),
    });
    const expectedKb = (PREVIEW_BYTES / 1024).toFixed(1);
    assert.ok(env.includes(`Preview (first ${expectedKb} KB):`));
  });

  test("truncated-byte marker shows correct byte count (ASCII)", () => {
    // ASCII: bytes == chars
    const joinedText = "x".repeat(5000);
    const head = joinedText.slice(0, PREVIEW_BYTES);
    const expectedTruncated =
      Buffer.byteLength(joinedText, "utf8") - Buffer.byteLength(head, "utf8");
    const env = buildEnvelope({
      filePath: "/tmp/t.txt",
      originalSize: joinedText.length,
      joinedText,
    });
    assert.ok(env.includes(`…${expectedTruncated} bytes truncated…`));
  });

  test("truncated-byte marker is byte-accurate for multibyte chars", () => {
    // Use multibyte characters so byte count != char count
    const joinedText = "é".repeat(3000); // 2 bytes per char = 6000 bytes
    const head = joinedText.slice(0, PREVIEW_BYTES);
    const expectedTruncated =
      Buffer.byteLength(joinedText, "utf8") - Buffer.byteLength(head, "utf8");
    const env = buildEnvelope({
      filePath: "/tmp/t.txt",
      originalSize: joinedText.length,
      joinedText,
    });
    assert.ok(env.includes(`…${expectedTruncated} bytes truncated…`));
  });

  test("includes closing read-tool instruction", () => {
    const env = buildEnvelope({
      filePath: "/tmp/t.txt",
      originalSize: 100,
      joinedText: "hello",
    });
    assert.ok(
      env.includes(
        "Use the read tool on the path above to fetch the full content.",
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// spillIfNeeded
// ---------------------------------------------------------------------------

describe("spillIfNeeded", () => {
  let scratchDir: string;

  before(async () => {
    scratchDir = join(tmpdir(), `spillover-test-${Date.now()}`);
    await mkdir(scratchDir, { recursive: true });
  });

  after(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  test("below threshold: returns content unchanged, spilled=false", async () => {
    const content = [{ type: "text" as const, text: "short" }];
    const result = await spillIfNeeded(content, "call_001", scratchDir);
    assert.equal(result.spilled, false);
    assert.deepEqual(result.content, content);
  });

  test("empty content: returns unchanged, spilled=false", async () => {
    const result = await spillIfNeeded([], "call_empty", scratchDir);
    assert.equal(result.spilled, false);
    assert.deepEqual(result.content, []);
  });

  test("image-only content: returns unchanged, spilled=false", async () => {
    const content = [
      { type: "image" as const, url: "data:image/png;base64,x" },
    ];
    const result = await spillIfNeeded(content, "call_img", scratchDir);
    assert.equal(result.spilled, false);
    assert.deepEqual(result.content, content);
  });

  test("above threshold: spilled=true, file written, envelope returned", async () => {
    const bigText = "a".repeat(THRESHOLD_CHARS + 1);
    const content = [{ type: "text" as const, text: bigText }];
    const result = await spillIfNeeded(content, "call_big", scratchDir);

    assert.equal(result.spilled, true);
    if (!result.spilled) throw new Error("unreachable");

    // File was written with owner-only permissions
    const written = await readFile(result.filePath, "utf8");
    assert.equal(written, bigText);
    assert.equal((await stat(result.filePath)).mode & 0o777, 0o600);

    // Details
    assert.equal(result.originalSize, bigText.length);

    // Content is a single text block with the envelope
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    const text = (result.content[0] as { type: "text"; text: string }).text;
    assert.ok(text.startsWith("<persisted-output>"));
    assert.ok(text.includes(`\`${result.filePath}\``));
  });

  test("above threshold: filePath matches details.filePath", async () => {
    const bigText = "b".repeat(THRESHOLD_CHARS + 100);
    const content = [{ type: "text" as const, text: bigText }];
    const result = await spillIfNeeded(content, "call_path_check", scratchDir);
    assert.equal(result.spilled, true);
    if (!result.spilled) throw new Error("unreachable");
    assert.ok(result.filePath.endsWith("call_path_check.txt"));
  });

  test("multi-block text: blocks joined before measuring and writing", async () => {
    // Each block is under threshold, but combined they exceed it
    const half = "c".repeat(THRESHOLD_CHARS / 2 + 1);
    const content = [
      { type: "text" as const, text: half },
      { type: "text" as const, text: half },
    ];
    const result = await spillIfNeeded(content, "call_multi", scratchDir);
    assert.equal(result.spilled, true);
    if (!result.spilled) throw new Error("unreachable");

    const written = await readFile(result.filePath, "utf8");
    assert.equal(written, `${half}\n${half}`);
  });

  test("image blocks are preserved in returned content", async () => {
    const bigText = "d".repeat(THRESHOLD_CHARS + 1);
    const imgBlock = {
      type: "image" as const,
      url: "data:image/png;base64,abc",
    };
    const content = [{ type: "text" as const, text: bigText }, imgBlock];
    const result = await spillIfNeeded(
      content,
      "call_img_preserve",
      scratchDir,
    );
    assert.equal(result.spilled, true);
    if (!result.spilled) throw new Error("unreachable");

    const imgBlocks = result.content.filter((b) => b.type === "image");
    assert.equal(imgBlocks.length, 1);
    assert.deepEqual(imgBlocks[0], imgBlock);
  });

  test("toolCallId with unsafe chars is sanitized in filename", async () => {
    const bigText = "e".repeat(THRESHOLD_CHARS + 1);
    const content = [{ type: "text" as const, text: bigText }];
    const result = await spillIfNeeded(content, "call/abc?def", scratchDir);
    assert.equal(result.spilled, true);
    if (!result.spilled) throw new Error("unreachable");
    assert.ok(result.filePath.endsWith("call_abc_def.txt"));
  });

  test("writeFile failure: returns passthrough content, spilled=false", async () => {
    const bigText = "f".repeat(THRESHOLD_CHARS + 1);
    const content = [{ type: "text" as const, text: bigText }];
    // Pass a path that cannot be created (file as dir)
    const unwritableDir = join(scratchDir, "not-a-dir.txt");
    // Create it as a file so mkdir to create it as a directory fails
    await writeFile(unwritableDir, "blocker");
    // Use a subdir of the file (can't be created)
    const result = await spillIfNeeded(content, "call_fail", unwritableDir);
    assert.equal(result.spilled, false);
    assert.deepEqual(result.content, content);
  });

  test("writeFile failure does not write to console", async () => {
    const warn = mock.method(console, "warn", () => {});
    const bigText = "f".repeat(THRESHOLD_CHARS + 1);
    const content = [{ type: "text" as const, text: bigText }];
    const unwritableDir = join(scratchDir, "console-not-a-dir.txt");
    await writeFile(unwritableDir, "blocker");

    await spillIfNeeded(content, "call_no_console", unwritableDir);

    assert.equal(warn.mock.callCount(), 0);
  });

  test("cleanupOldSpilloverFiles removes old spill files only", async () => {
    const oldFile = join(scratchDir, "old.txt");
    const freshFile = join(scratchDir, "fresh.txt");
    const ignoredFile = join(scratchDir, "old.log");
    await writeFile(oldFile, "old", "utf8");
    await writeFile(freshFile, "fresh", "utf8");
    await writeFile(ignoredFile, "ignored", "utf8");
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await utimes(oldFile, oldDate, oldDate);
    await utimes(ignoredFile, oldDate, oldDate);

    await cleanupOldSpilloverFiles(scratchDir);

    await assert.rejects(() => stat(oldFile), { code: "ENOENT" });
    assert.equal(await readFile(freshFile, "utf8"), "fresh");
    assert.equal(await readFile(ignoredFile, "utf8"), "ignored");
  });

  test("preview truncated to PREVIEW_BYTES with correct truncated-byte count", async () => {
    const joinedText = "g".repeat(THRESHOLD_CHARS + 1000);
    const content = [{ type: "text" as const, text: joinedText }];
    const result = await spillIfNeeded(content, "call_preview", scratchDir);
    assert.equal(result.spilled, true);
    if (!result.spilled) throw new Error("unreachable");

    const envelopeText = (result.content[0] as { type: "text"; text: string })
      .text;
    const head = joinedText.slice(0, PREVIEW_BYTES);
    const expectedTruncated =
      Buffer.byteLength(joinedText, "utf8") - Buffer.byteLength(head, "utf8");
    assert.ok(envelopeText.includes(`…${expectedTruncated} bytes truncated…`));
  });
});

// ---------------------------------------------------------------------------
// Import { writeFile } override test (wx flag collision)
// ---------------------------------------------------------------------------

describe("spillIfNeeded wx flag", () => {
  let scratchDir: string;

  before(async () => {
    scratchDir = join(tmpdir(), `spillover-wx-test-${Date.now()}`);
    await mkdir(scratchDir, { recursive: true });
  });

  after(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  test("second call with same toolCallId writes a unique file", async () => {
    const bigText = "h".repeat(THRESHOLD_CHARS + 1);
    const content = [{ type: "text" as const, text: bigText }];
    const first = await spillIfNeeded(content, "call_wx", scratchDir);
    assert.equal(first.spilled, true);
    if (!first.spilled) throw new Error("unreachable");

    const second = await spillIfNeeded(content, "call_wx", scratchDir);
    assert.equal(second.spilled, true);
    if (!second.spilled) throw new Error("unreachable");
    assert.notEqual(second.filePath, first.filePath);
    assert.ok(second.filePath.endsWith("call_wx-1.txt"));
    assert.equal(await readFile(second.filePath, "utf8"), bigText);
  });
});
