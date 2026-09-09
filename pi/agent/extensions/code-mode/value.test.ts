import assert from "node:assert/strict";
import test from "node:test";
import { encode } from "gpt-tokenizer/encoding/cl100k_base";
import { fixture, tool, reply } from "../mcp-gateway/fixture.ts";
import { registerTools } from "../mcp-gateway/tools.ts";
import { createGatewayAccess } from "../mcp-gateway/api.ts";
import { runCode } from "./runtime.ts";
import { presentRun } from "./tool.ts";

// Tokenize each complete unique tool transcript once; exclude common discovery,
// prompt/schema overhead and the final answer. This is not cumulative billing.
const measure = (messages: unknown[]) =>
  encode(JSON.stringify(messages)).length;
const rows = Array.from({ length: 60 }, (_, id) => ({
  id,
  keep: id % 3 === 0,
  value: id * 2,
  prose: `Record ${id}: ${"Unneeded fixture detail. ".repeat(6)}`,
}));

test("reproducible direct/code comparisons: identical answers with lower visible fixture tokens", async (t) => {
  const f = await fixture(t, (body, response) => {
    if (body.method === "tools/list")
      return reply(response, body, {
        tools: [
          tool("example.page"),
          tool("example.ids"),
          tool("example.detail"),
          tool("example.aggregate"),
        ],
      });
    const name = body.params.name;
    const n = Number(body.params.arguments.query ?? 0);
    const result =
      name === "example.page"
        ? { rows: rows.slice(n * 20, n * 20 + 20), next: n < 2 ? n + 1 : null }
        : name === "example.ids"
          ? { ids: [2, 4, 6], noise: rows }
          : name === "example.detail"
            ? { row: rows[n], noise: rows.slice(0, 20) }
            : { total: n + 10, noise: rows.slice(0, 20) };
    reply(response, body, { content: [], structuredContent: result });
  });
  const tools = new Map<string, any>();
  registerTools(
    {
      on() {},
      registerTool(d: any) {
        tools.set(d.name, d);
      },
    } as any,
    f.client,
  );
  const transcripts: unknown[] = [];
  async function direct(name: string, args: Record<string, unknown>) {
    const output = await tools
      .get("mcp_call")
      .execute(`direct-${transcripts.length}`, { name, arguments: args });
    // None of these individual fixture responses spill; assert rather than ignore it.
    assert.equal(output.details.spillFilePath, undefined);
    transcripts.push({
      call: { name: "mcp_call", arguments: { name, arguments: args } },
      result: output.content,
    });
    const text = output.content.map((b: any) => b.text ?? "").join("\n");
    return JSON.parse(
      text.split("Structured content:\n")[1].split("\n--- END UNTRUSTED")[0],
    );
  }
  const scenarios = [
    {
      name: "pagination/filtering",
      rounds: 3,
      source: `let page=0; const ids=[]; do { const r=(await mcp.call("example.page",{query:String(page)})).structuredContent; ids.push(...r.rows.filter(x=>x.keep).map(x=>x.id)); page=r.next; } while(page!==null); return ids;`,
      direct: async () => {
        let page: number | null = 0;
        const ids: number[] = [];
        do {
          const r = await direct("example.page", { query: String(page) });
          ids.push(...r.rows.filter((x: any) => x.keep).map((x: any) => x.id));
          page = r.next;
        } while (page !== null);
        return ids;
      },
    },
    {
      name: "dependent lookups",
      rounds: 2,
      source: `const r=(await mcp.call("example.ids",{})).structuredContent; return await parallel(r.ids.map(id=>async ()=>(await mcp.call("example.detail",{query:String(id)})).structuredContent.row.value));`,
      direct: async () => {
        const r = await direct("example.ids", {});
        return Promise.all(
          r.ids.map(
            async (id: number) =>
              (await direct("example.detail", { query: String(id) })).row.value,
          ),
        );
      },
    },
    {
      name: "aggregation",
      rounds: 1,
      source: `const r=await parallel([1,2,3].map(id=>async ()=>(await mcp.call("example.aggregate",{query:String(id)})).structuredContent.total)); return r.reduce((a,b)=>a+b,0);`,
      direct: async () =>
        (
          await Promise.all(
            [1, 2, 3].map(
              async (id) =>
                (await direct("example.aggregate", { query: String(id) }))
                  .total,
            ),
          )
        ).reduce((a, b) => a + b, 0),
    },
  ];
  for (const scenario of scenarios) {
    transcripts.length = 0;
    const answer = await scenario.direct();
    const directTokens = measure(transcripts);
    const run = await runCode(scenario.source, createGatewayAccess(f.client));
    assert.equal(run.status, "success");
    assert.deepEqual(JSON.parse(run.json!), answer);
    const output = await presentRun(run, `value-${scenario.name}`, f.dir);
    const codeTokens = measure([
      {
        call: { name: "code", arguments: { source: scenario.source } },
        result: output.content,
      },
    ]);
    assert.ok(
      codeTokens < directTokens,
      `${scenario.name}: ${codeTokens} < ${directTokens}`,
    );
    t.diagnostic(
      `${scenario.name}: direct=${directTokens}, code=${codeTokens} cl100k_base tokens; model tool rounds=${scenario.rounds}/1; equal answers=true`,
    );
  }
});
