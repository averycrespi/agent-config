import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { createEventBus, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import coordinate from "./index.ts";
import { load, patch } from "./state.ts";
import { launchSummary, roleLine, statusSummary } from "./render.ts";
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

test("role/count display is truthful, sanitized and narrow without observer state", () => {
  assert.equal(statusSummary(0, 0), "No outstanding work");
  assert.equal(statusSummary(2, 1), "2 active assignments · 1 pending message");
  assert.equal(statusSummary(0, undefined), "Mailbox unavailable");
  assert.equal(
    roleLine(theme, 120, "child", "Project", 0),
    "Managed by Project",
  );
  assert.doesNotMatch(
    roleLine(theme, 120, "coordinator", "", 0, 0),
    /supervision/,
  );
  assert.doesNotMatch(
    roleLine(theme, 120, "coordinator", "", 2, 1),
    /supervision/,
  );
  for (const width of [0, 1, 12, 48, 100]) {
    const row = roleLine(
      theme,
      width,
      "child",
      "\x1b[2JParent\nproject\u202e",
      0,
    );
    assert.ok(visibleWidth(row) <= width);
    assert.doesNotMatch(stripVTControlCharacters(row), /[\x00-\x1f\u202e]/);
    assert.doesNotMatch(row, /\x1b\[2J/);
  }
});

test("spawn summary distinguishes execution, submission, process and resource evidence", () => {
  assert.equal(
    launchSummary("worker", { status: "execution-confirmed" }),
    "Started worker",
  );
  assert.equal(
    launchSummary("worker", { execution: { submittedEntry: "entry" } }),
    "Sent task to worker; execution not observed",
  );
  assert.equal(
    launchSummary("worker", { worker: {} }),
    "Prepared worker; task delivery unconfirmed",
  );
  assert.equal(
    launchSummary("worker", { resources: {} }),
    "Created worker; agent startup unconfirmed",
  );
  assert.match(
    launchSummary("worker", {}),
    /Could not confirm workspace creation/,
  );
});

test("bare enable, session mailbox reuse, observer independence and neutral disabled rendering", async (t) => {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "coordinate-ux-")));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q", cwd]);
  const id = "00000000-0000-4000-8000-000000000001";
  const hooks = new Map<string, any>(),
    commands = new Map<string, any>();
  const widgets: unknown[] = [],
    notices: string[] = [];
  let tool: any;
  const pi: any = {
    events: createEventBus(),
    appendEntry() {},
    on: (name: string, fn: any) => hooks.set(name, fn),
    registerCommand: (name: string, command: any) =>
      commands.set(name, command),
    registerTool: (value: any) => {
      tool = value;
    },
  };
  const ctx: any = {
    cwd,
    hasUI: true,
    mode: "rpc",
    sessionManager: { getSessionId: () => id },
    ui: {
      theme,
      setWidget: (_key: string, value: unknown) => widgets.push(value),
      notify: (text: string) => notices.push(text),
    },
  };
  coordinate(pi);
  const enable = (args = "") =>
    commands.get("coordinate-enable").handler(args, ctx);
  const disable = () => commands.get("coordinate-disable").handler("", ctx);
  await assert.rejects(enable("custom-address"), /no arguments/);
  assert.equal((await load(cwd, id)).binding, undefined);
  pi.events.on("mailbox:inspect-v1", (q: any) => q.reply({ pending: 0 }));
  await enable();
  let { index, binding } = await load(cwd, id);
  assert.equal(binding?.mailbox, id);
  assert.equal(index.values?.Mailbox, undefined);
  assert.equal(index.values?.Observation, undefined);
  assert.equal(notices[0], "Coordinator enabled");
  await enable();
  assert.equal((await load(cwd, id)).index.digest, index.digest);
  await disable();
  assert.equal(widgets.at(-1), undefined);
  index = (await load(cwd, id)).index;
  // Existing bindings retain their original custom mailbox without migration.
  await patch(cwd, index, {
    "Owner and authority": JSON.stringify({
      ...binding,
      active: false,
      mailbox: "original-custom",
    }),
  });
  await enable();
  assert.equal((await load(cwd, id)).binding?.mailbox, "original-custom");
  let status = "active";
  pi.events.on("monitor:inspect-v1", (q: any) =>
    q.reply({
      sourceMatches: true,
      receipt: { id: q.id, status, inFlight: false },
    }),
  );
  await hooks.get("tool_result")(
    {
      toolName: "monitor",
      input: { action: "start" },
      details: { receipt: { id: "observer" } },
      isError: false,
    },
    ctx,
  );
  const saved = (await load(cwd, id)).index;
  assert.equal(saved.values!.Observation, undefined);
  status = "finished";
  await disable();
  assert.equal(widgets.at(-1), undefined);
  let failure = "";
  try {
    await tool.execute(
      "status",
      { action: "status" },
      undefined,
      undefined,
      ctx,
    );
  } catch (error) {
    failure = (error as Error).message;
  }
  assert.match(failure, /No effects performed/);
  const colors: string[] = [];
  const rendered = tool
    .renderResult(
      { content: [{ type: "text", text: failure }] },
      { expanded: false, isPartial: false },
      {
        ...theme,
        fg: (color: string, text: string) => {
          colors.push(color);
          return text;
        },
      },
      { isError: true },
    )
    .render(200);
  assert.deepEqual(rendered, [
    "Coordination is disabled · run /coordinate-enable",
  ]);
  assert.ok(!colors.includes("error"));
  await hooks.get("session_shutdown")({}, ctx);
});
