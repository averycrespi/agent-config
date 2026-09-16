import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fixture, echo } from "./fixture.ts";
import { renderers, presentRun, discoveryFailure } from "./tool.ts";
import { registerScriptProvider } from "./api.ts";
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
  const ctx: any = {
    cwd: f.dir,
    hasUI: false,
    sessionManager: {
      getSessionId: () => "fixture",
      getSessionFile: () => undefined,
    },
  };
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

const plainTheme: any = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};
const renderResult = (
  result: any,
  args: any = {},
  expanded = false,
  isError = false,
) =>
  renderers.renderResult!(result, { expanded, isPartial: false }, plainTheme, {
    args,
    isError,
  } as any)
    .render(200)
    .join("\n");

test("discovery reports actionable categories and bounded inventories through the real loader", async (t) => {
  const f = await fixture(t, { echo });
  const loaded = await discoverAndLoadExtensions(
    [fileURLToPath(new URL("./index.ts", import.meta.url))],
    f.dir,
    f.dir,
    f.pi.events,
  );
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  const tool = extension.tools.get("script")!.definition;
  const args = {
    action: "describe",
    description: "Inspect providers",
    providers: ["fixture"],
  };
  const invoke = (providers = args.providers, signal?: AbortSignal) =>
    tool.execute("discovery", { ...args, providers }, signal, undefined, {
      cwd: f.dir,
      sessionManager: {
        getSessionId: () => "fixture",
        getSessionFile: () => undefined,
      },
    } as any);
  const success = await invoke();
  assert.match(
    renderResult(success, args),
    /completed · 1 provider · 1 method/,
  );
  assert.match(renderResult(success, args, true), /fixture\.echo/);
  assert.doesNotMatch(renderResult(success, args), /0 calls|fixture\.echo/);
  const badCallArgs = {
    ...args,
    action: "run",
    source:
      'try { await fixture.echo("SECRET_ARGUMENT"); } catch {} return null;',
  };
  const badCall = await tool.execute(
    "bad-call",
    badCallArgs,
    undefined,
    undefined,
    {
      cwd: f.dir,
      sessionManager: {
        getSessionId: () => "fixture",
        getSessionFile: () => undefined,
      },
    } as any,
  );
  assert.match(
    renderResult(badCall, badCallArgs),
    /one or more provider calls failed/,
  );
  assert.match(renderResult(badCall, badCallArgs, true), /invalid_arguments/);
  assert.match(
    renderResult(badCall, badCallArgs, true),
    /positional-array schema/,
  );
  assert.doesNotMatch(JSON.stringify(badCall), /SECRET_ARGUMENT/);

  await f.config({ allowedProviders: [] });
  const denied = await invoke();
  assert.equal((denied.details as any).code, "capability_denied");
  assert.match(JSON.stringify(denied.content), /allowedProviders/);
  assert.match(
    renderResult(denied, args),
    /blocked · provider selection denied by Script policy/,
  );
  assert.doesNotMatch(JSON.stringify(denied), /select fewer|exceeds output/);
  const hook = extension.handlers.get("tool_result")![0] as any;
  assert.deepEqual(
    await hook({ toolName: "script", details: denied.details }, {}),
    { isError: true },
  );
  const empty = await invoke([]);
  assert.match(
    renderResult(empty, { ...args, providers: [] }),
    /no permitted providers discovered/,
  );

  await f.config({ allowedProviders: ["fixture"] });
  f.unavailable();
  const unavailable = await invoke();
  assert.equal((unavailable.details as any).code, "capability_unavailable");
  assert.match(JSON.stringify(unavailable.content), /loading and readiness/);
  await f.config({ allowedProviders: "*" });
  assert.equal(((await invoke()).details as any).code, "invalid_config");
  const controller = new AbortController();
  controller.abort(new Error("SECRET_ABORT"));
  const cancelled = await invoke([], controller.signal);
  assert.equal((cancelled.details as any).status, "cancelled");
  assert.doesNotMatch(JSON.stringify(cancelled), /SECRET_ABORT/);

  let calls = 0;
  const dispose = registerScriptProvider(f.pi, {
    namespace: "large",
    available: () => true,
    methods: Object.fromEntries(
      Array.from({ length: 32 }, (_, i) => [
        `method${i}`,
        {
          description: "Inspect a fixture value",
          inputSchema: {
            type: "array",
            maxItems: 0,
            description: "x".repeat(1000),
          },
          handler: async () => {
            calls++;
            return { value: null };
          },
        },
      ]),
    ),
  });
  t.after(dispose);
  await f.config({ allowedProviders: ["large"] });
  const oversized = await invoke(["large"]);
  assert.equal((oversized.details as any).code, "output_limit");
  assert.match(JSON.stringify(oversized.content), /Select fewer providers/);
  assert.doesNotMatch(JSON.stringify(oversized), /xxxx/);
  assert.equal(calls, 0);
});

test("unknown discovery exceptions are suppressed rather than used as recovery guidance", () => {
  const result = discoveryFailure(
    new Error("SECRET_DISCOVERY_EXCEPTION"),
    false,
  );
  assert.equal(result.details.code, "discovery_unavailable");
  assert.doesNotMatch(JSON.stringify(result), /SECRET_DISCOVERY_EXCEPTION/);
});

test("rows distinguish discovery scope, provider selection, and call outcomes", () => {
  const run = {
    status: "success" as const,
    traces: [],
    effectsMayPersist: false,
    partialExecution: false,
    outcomeUnknown: false,
    json: "null",
  };
  const args = { action: "run", description: "Compute totals", providers: [] };
  const header = (input: any) =>
    renderers.renderCall!(input, plainTheme, {} as any)
      .render(200)
      .join("\n");
  assert.match(header(args), /providers: none.*Compute totals/);
  assert.match(
    header({ ...args, providers: ["mcp", "web"] }),
    /providers: mcp, web/,
  );
  assert.match(header({ ...args, action: "describe" }), /scope: all/);
  assert.match(
    header({ ...args, action: "describe", providers: ["mcp", "web"] }),
    /scope: mcp, web/,
  );
  assert.match(header({ description: "streaming" }), /providers: pending/);
  assert.match(
    header({ action: "describe", description: "streaming" }),
    /scope: pending/,
  );
  assert.match(
    header({ ...args, providers: ["first", "second", "third", "fourth"] }),
    /first, second, third, \+1 more/,
  );
  assert.match(
    renderResult(
      presentRun(run),
      { ...args, providers: ["first", "second", "third", "fourth"] },
      true,
    ),
    /selected provider: fourth/,
  );
  for (const providers of [[], ["mcp"]])
    assert.equal(
      renderResult(presentRun(run), { ...args, providers }),
      "completed · no calls",
    );
  assert.equal(
    renderResult(
      { content: [{ type: "text", text: "SECRET_FRAMEWORK" }] },
      args,
      true,
      true,
    ),
    "failed · tool execution error",
  );
  const trace = {
    id: 1,
    tool: "web.fetch",
    state: "succeeded" as const,
    dispatched: true,
    startedMs: 0,
    durationMs: 5,
    outcomeUnknown: false,
  };
  assert.match(
    renderResult(
      presentRun({ ...run, traces: [trace], effectsMayPersist: true }),
      args,
    ),
    /1 call succeeded/,
  );
  const failed = presentRun({
    ...run,
    status: "failed",
    code: "output_limit",
    traces: [trace],
    effectsMayPersist: true,
    partialExecution: true,
    outcomeUnknown: true,
  });
  const collapsed = renderResult(failed, args);
  assert.match(collapsed, /failed · returned JSON exceeds 24,000 bytes/);
  assert.match(collapsed, /Outcome unknown; do not automatically retry/);
  assert.match(collapsed, /Partial execution; effects may persist/);
  assert.doesNotMatch(collapsed, /web.fetch|Reduce the returned JSON/);
  const expanded = renderResult(failed, args, true);
  assert.match(expanded, /web.fetch · succeeded/);
  assert.match(expanded, /Reduce the returned JSON/);
  assert.match(JSON.stringify(failed.content), /Reconcile provider effects/);
  assert.match(
    renderResult(
      presentRun({ ...run, status: "timeout", code: "deadline_exceeded" }),
      args,
    ),
    /timed out/,
  );
  assert.match(
    renderResult(
      presentRun({ ...run, status: "cancelled", code: "cancelled" }),
      args,
    ),
    /cancelled/,
  );
});

test("every fixed core run failure has actionable, payload-free expanded guidance", () => {
  for (const [code, guidance] of [
    ["capability_denied", "global allowedProviders"],
    ["capability_unavailable", "loading and readiness"],
    ["invalid_config", "SCRIPT_* environment"],
    ["invalid_selection", "unique provider namespace"],
    ["provider_conflict", "duplicate Script namespaces"],
    ["invalid_arguments", "positional-array schema"],
    ["invalid_source", "at most 256 KiB"],
    ["executor_unavailable", "extension installation"],
    ["sandbox_error", "host process resources"],
    ["sandbox_exit", "host process resource limits"],
    ["ipc_error", "host process health"],
    ["invalid_ipc", "version compatibility"],
    ["invalid_result", "Explicitly return plain JSON"],
    ["script_error", "Inspect the JavaScript body"],
    ["call_limit", "reduce attempted calls"],
    ["unfinished_calls", "Await every provider call"],
    ["isolation_unavailable", "never remove permission flags"],
    ["nested_call_failed", "guest catches do not erase"],
    ["provider_error", "provider documentation"],
    ["deadline_exceeded", "provider deadlines"],
    ["cancelled", "Cancellation is not rollback"],
    ["output_limit", "Reduce the returned JSON"],
    ["ipc_limit", "provider output limits"],
  ]) {
    const result = presentRun({
      status: "failed",
      code,
      traces: [],
      effectsMayPersist: false,
      partialExecution: false,
      outcomeUnknown: false,
      json: '"SECRET_RETURN"',
    });
    const rendered = renderResult(
      result,
      { action: "run", providers: [] },
      true,
    );
    assert.ok(rendered.includes(guidance), code);
    assert.ok(rendered.includes(`code: ${code}`), code);
    assert.ok(JSON.stringify(result.content).includes(guidance), code);
    assert.doesNotMatch(rendered, /SECRET_RETURN/);
  }
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
      providers: ["web", "hostile\u001b[31m\nprovider"],
    } as any,
    theme,
    ctx,
  );
  assert.doesNotMatch(header.render(100).join(), /SECRET|\x1b|\x07|\n/);
  assert.match(header.render(200).join(), /providers: web, \(invalid\)/);
  for (const width of [0, 1, 8, 40, 100])
    for (const line of header.render(width))
      assert.ok(visibleWidth(line) <= width);
  const reused = renderers.renderCall!(
    { action: "describe", description: "Inspect", providers: [] },
    theme,
    { ...ctx, lastComponent: header },
  );
  assert.equal(reused, header);
  assert.match(reused.render(200).join(), /scope: all/);
  assert.doesNotMatch(reused.render(200).join(), /providers: web/);
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
