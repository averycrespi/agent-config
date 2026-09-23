import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
test("retired session provider and transport have no active imports or callers", () => {
  for (const name of [
    "sessions.ts",
    "session-events.ts",
    "session-transport.ts",
  ])
    assert.equal(
      existsSync(join(root, "pi/agent/extensions/background", name)),
      false,
    );
  for (const path of files(join(root, "pi"))) {
    if (!/\.(?:ts|js)$/.test(path) || path.endsWith("migration.test.ts"))
      continue;
    const text = readFileSync(path, "utf8");
    assert.doesNotMatch(
      text,
      /(?:from\s*|import\s*\()["'][^"']*\/(?:session-transport|session-events|sessions)\.ts/,
      path,
    );
    assert.doesNotMatch(text, /provider:\s*["']sessions["']/, path);
  }
  const index = readFileSync(
    join(root, "pi/agent/extensions/background/index.ts"),
    "utf8",
  );
  for (const hook of [
    "agent_settled",
    "message_start",
    "session_shutdown",
    "session_before_tree",
    "session_tree",
  ])
    assert.ok(index.includes(`pi.on("${hook}"`), hook);
});
