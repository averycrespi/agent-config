import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fixture, echo } from "./fixture.ts";
import { renderers } from "./tool.ts";
import { _spawn } from "./runtime.ts";

test("real loader runs without gateway, coexists with code, discovers schemas, and cancels on shutdown", async (t) => {
  const f = await fixture(t, { echo });
  const loaded = await discoverAndLoadExtensions(
    ["./index.ts", "../code-mode/index.ts"].map((p) =>
      fileURLToPath(new URL(p, import.meta.url)),
    ),
    f.dir,
    f.dir,
    f.pi.events,
  );
  assert.deepEqual(loaded.errors, []);
  assert.deepEqual(
    loaded.extensions.map((e) => [...e.tools.keys()]),
    [["script"], ["code"]],
  );
  const extension = loaded.extensions[0];
  const definition = extension.tools.get("script")!.definition;
  const ctx: any = { cwd: f.dir, hasUI: false };
  const invoke = (args: Record<string, unknown>) =>
    definition.execute(
      "fixture",
      { description: "Fixture operation", providers: [], ...args },
      undefined,
      undefined,
      ctx,
    );
  const result = await invoke({ action: "run", source: "return {answer:42};" });
  assert.equal((result.details as any).status, "success");
  assert.match(JSON.stringify(result.content), /42/);
  const discovered = await invoke({
    action: "describe",
    providers: ["fixture"],
  });
  assert.match(JSON.stringify(discovered.content), /inputSchema/);
  assert.doesNotMatch(JSON.stringify(discovered), /handler|validate|signal/);
  const withProvider = await invoke({
    action: "run",
    providers: ["fixture"],
    source: "return await fixture.echo(7);",
  });
  assert.equal((withProvider.details as any).status, "success");
  for (const description of [undefined, "", " \n", "\u200b"])
    await assert.rejects(
      invoke({ action: "run", source: "return null;", description }),
      /description/,
    );
  const failed = await invoke({ action: "run", source: "return undefined;" });
  const hook = extension.handlers.get("tool_result")![0] as any;
  assert.deepEqual(
    await hook({ toolName: "script", details: failed.details }, ctx),
    { isError: true },
  );
  assert.equal(
    await hook({ toolName: "code", details: failed.details }, ctx),
    undefined,
  );
  const pending = invoke({ action: "run", source: "while(true) {}" });
  for (const handler of extension.handlers.get("session_shutdown") ?? [])
    await (handler as any)({}, ctx);
  assert.equal(((await pending).details as any)?.status, "cancelled");
});

test("renderers are bounded, payload-free, and distinguish framework/semantic failures", () => {
  const colors: string[] = [];
  const theme: any = {
    fg: (c: string, s: string) => {
      colors.push(c);
      return s;
    },
    bold: (s: string) => s,
  };
  const ctx: any = { state: {}, isError: false };
  const header = renderers.renderCall!(
    {
      description: "read\x1b]52;c;evil\x07\nitems",
      source: "SECRET_SOURCE",
    } as any,
    theme,
    ctx,
  );
  assert.doesNotMatch(header.render(100).join(), /SECRET|\x1b|\x07|\n/);
  for (const state of [
    { isPartial: true, error: false, semantic: false, color: "warning" },
    { isPartial: false, error: false, semantic: false, color: "success" },
    { isPartial: false, error: true, semantic: false, color: "error" },
    { isPartial: false, error: false, semantic: true, color: "error" },
  ]) {
    ctx.isError = state.error;
    colors.length = 0;
    const component = renderers.renderResult!(
      {
        content: [{ type: "text", text: "SECRET_PAYLOAD" }],
        details: {
          scriptError: state.semantic,
          outcomeUnknown: true,
          partialExecution: true,
          traces: [
            {
              tool: "fixture.\x1b[31mecho",
              state: "failed",
              code: "failure\ncode",
              durationMs: 1,
            },
          ],
        },
      },
      { expanded: true, isPartial: state.isPartial },
      theme,
      ctx,
    );
    assert.equal(colors[0], state.color);
    for (const width of [0, 1, 8, 100])
      for (const line of component.render(width)) {
        assert.ok(visibleWidth(line) <= width);
        assert.doesNotMatch(
          line.replaceAll("\x1b[22;23;24;25;27;28;29;39m", ""),
          /SECRET|\x1b|\x07/,
        );
      }
  }
});

test("Node permission boundary denies ambient access even outside VM", async (t) => {
  const f = await fixture(t);
  const original = _spawn.fn;
  t.mock.method(_spawn, "fn", (...args: Parameters<typeof original>) => {
    const child = original(...args);
    child.stdin!.end(`
      import fs from 'node:fs'; import {spawnSync} from 'node:child_process'; import {Worker} from 'node:worker_threads';
      const evidence={env:Object.keys(process.env),denied:[]};
      for(const [label,fn] of [['read',()=>fs.readFileSync('/etc/passwd')],['write',()=>fs.writeFileSync(${JSON.stringify(f.dir + "/forbidden")},'no')],['spawn',()=>spawnSync(process.execPath,['-e','1'])],['worker',()=>new Worker('1',{eval:true})]]) { try{fn()}catch(e){if(e.code==='ERR_ACCESS_DENIED')evidence.denied.push(label)} }
      try{await fetch('http://127.0.0.1:12345')}catch(e){if(e.code==='ERR_ACCESS_DENIED'||e.cause?.code==='ERR_ACCESS_DENIED')evidence.denied.push('network')}
      process.send(JSON.stringify({type:'result',json:JSON.stringify(evidence)}));
    `);
    return Object.assign(child, { stdin: undefined });
  });
  const r = await f.run("return null;");
  assert.equal(r.status, "success");
  assert.deepEqual(JSON.parse(r.json!), {
    env: [],
    denied: ["read", "write", "spawn", "worker", "network"],
  });
});
