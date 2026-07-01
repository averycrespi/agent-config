import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createExtraContextExtension,
  parseExtraContextConfig,
  resolveContextPath,
} from "./index.ts";

function makePi() {
  const commands = new Map<string, any>();
  const handlers = new Map<string, any>();
  return {
    commands,
    handlers,
    registerCommand(name: string, command: any) {
      commands.set(name, command);
    },
    on(name: string, handler: any) {
      handlers.set(name, handler);
    },
  } as any;
}

function makeCtx(cwd: string) {
  const notifications: Array<{ msg: string; level: string }> = [];
  return {
    cwd,
    notifications,
    ui: {
      notify(msg: string, level: string) {
        notifications.push({ msg, level });
      },
    },
  } as any;
}

test("extra-context appends configured files to the system prompt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "extra-context-"));
  try {
    const contextFile = join(dir, "AGENTS.private.md");
    await writeFile(
      contextFile,
      "# Private guidance\n\nPrefer concise answers.\n",
    );
    const pi = makePi();
    const ctx = makeCtx(dir);
    createExtraContextExtension({
      loadConfig: async () => ({
        config: {
          enabled: true,
          files: [contextFile],
          missingFileBehavior: "warn",
        },
        warnings: [],
      }),
    })(pi);

    await pi.handlers.get("session_start")({}, ctx);
    const result = await pi.handlers.get("before_agent_start")(
      { systemPrompt: "base prompt" },
      ctx,
    );

    assert.match(result.systemPrompt, /^base prompt/);
    assert.match(result.systemPrompt, /<extra_context>/);
    assert.match(result.systemPrompt, /<extra_context_file path=/);
    assert.match(result.systemPrompt, /AGENTS\.private\.md/);
    assert.match(result.systemPrompt, /Prefer concise answers/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extra-context warns and omits missing configured files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "extra-context-"));
  try {
    const missingFile = join(dir, "missing.md");
    const pi = makePi();
    const ctx = makeCtx(dir);
    createExtraContextExtension({
      loadConfig: async () => ({
        config: {
          enabled: true,
          files: [missingFile],
          missingFileBehavior: "warn",
        },
        warnings: [],
      }),
    })(pi);

    await pi.handlers.get("session_start")({}, ctx);
    const result = await pi.handlers.get("before_agent_start")(
      { systemPrompt: "base prompt" },
      ctx,
    );

    assert.equal(result, undefined);
    assert.match(ctx.notifications.at(-1)?.msg, /Extra context file not found/);
    assert.equal(ctx.notifications.at(-1)?.level, "warning");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseExtraContextConfig validates settings and environment overrides", () => {
  const warnings: string[] = [];
  const config = parseExtraContextConfig({
    settings: {
      enabled: true,
      files: ["/from-settings.md"],
      missingFileBehavior: "ignore",
    },
    env: {
      EXTRA_CONTEXT_ENABLED: "false",
      EXTRA_CONTEXT_FILES: "/one.md,/two.md",
      EXTRA_CONTEXT_MISSING_FILE_BEHAVIOR: "warn",
    } as any,
    warnings,
  });

  assert.deepEqual(config, {
    enabled: false,
    files: ["/one.md", "/two.md"],
    missingFileBehavior: "warn",
  });
  assert.deepEqual(warnings, []);
});

test("resolveContextPath expands home and cwd-relative paths", () => {
  const cwdRelative = resolveContextPath("private/AGENTS.md", "/repo");
  assert.equal(cwdRelative, "/repo/private/AGENTS.md");

  const homeRelative = resolveContextPath("~/private/AGENTS.md", "/repo");
  assert.match(homeRelative, /\/private\/AGENTS\.md$/);
  assert.doesNotMatch(homeRelative, /^~\//);
});

test("/extra-context-config displays effective config", async () => {
  const pi = makePi();
  const ctx = makeCtx("/repo");
  createExtraContextExtension({
    loadConfig: async () => ({
      config: {
        enabled: true,
        files: ["~/.private/pi/AGENTS.private.md"],
        missingFileBehavior: "warn",
      },
      warnings: [],
    }),
  })(pi);

  await pi.commands.get("extra-context-config").handler("", ctx);

  assert.match(
    ctx.notifications.at(-1)?.msg,
    /extra-context effective config:/,
  );
  assert.match(ctx.notifications.at(-1)?.msg, /AGENTS\.private\.md/);
});
