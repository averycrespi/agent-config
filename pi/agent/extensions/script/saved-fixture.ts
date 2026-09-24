import type { TestContext } from "node:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ScriptMethod } from "./api.ts";
import { fixture } from "./fixture.ts";
import script from "./index.ts";
import background from "../background/index.ts";
import { getBackgroundService } from "../background/api.ts";

export const definitionSource = (
  body = "return args;",
  meta: Record<string, unknown> = {},
) =>
  `export const meta = ${JSON.stringify({ name: "sample", description: "Example", args: { type: "object" }, providers: [], limits: { maxCalls: 2, maxConcurrency: 1, timeoutMs: 5000 }, ...meta })};\nexport async function run() { ${body} }`;

export async function savedFixture(
  t: TestContext,
  methods?: Record<string, ScriptMethod>,
) {
  let stop = async () => {};
  t.after(() => stop());
  const f = await fixture(t, methods);
  const store = join(f.dir, "scripts");
  await mkdir(store);
  const hooks = new Map<string, any[]>();
  const messages: any[] = [];
  let tool: any;
  const ctx: any = {
    cwd: f.dir,
    mode: "json",
    hasUI: false,
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: {
      getSessionId: () => "saved-test",
      getSessionFile: () => join(f.dir, "session.jsonl"),
      getLeafId: () => "anchor",
      getBranch: () => [{ id: "anchor" }],
    },
  };
  const pi: any = {
    ...f.pi,
    on: (name: string, fn: any) =>
      hooks.set(name, [...(hooks.get(name) ?? []), fn]),
    registerCommand() {},
    registerMessageRenderer() {},
    registerTool: (value: any) => {
      tool = value;
    },
    sendMessage: (message: any) => messages.push(message),
  };
  const hook = async (name: string) => {
    for (const fn of hooks.get(name) ?? []) await fn({}, ctx);
  };
  background(pi);
  script(pi);
  await hook("session_start");
  stop = () => hook("session_shutdown");
  return {
    ...f,
    store,
    messages,
    hook,
    service: getBackgroundService(pi),
    call: (params: any) =>
      tool.execute(
        "test",
        { description: "Saved fixture", ...params },
        undefined,
        undefined,
        ctx,
      ),
    terminal: () =>
      new Promise<void>((resolve) => {
        const off = pi.events.on("background:terminal", () => {
          off();
          resolve();
        });
      }),
  };
}
