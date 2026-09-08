import assert from "node:assert/strict";
import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { mock } from "node:test";
import {
  fixture,
  reply,
  rpcError,
  tool,
  TEST_BEARER,
} from "../mcp-gateway/fixture.ts";
import { runSubagent } from "./run.ts";
import { _spawn } from "./spawn.ts";
import {
  createWorkflowAgentSpawner,
  runWorkflow,
} from "../workflows/runtime.ts";
import { parseWorkflowScript } from "../workflows/parser.ts";
import {
  buildSpawnPlan,
  spawnPi,
  _spawn as _scheduledSpawn,
} from "../scheduled-tasks/spawn.ts";
import { DEFAULT_CONFIG as scheduledDefaults } from "../scheduled-tasks/config.ts";

for (const mode of [
  "direct",
  "workflow",
  "scheduled",
  "normal",
  "scheduled-missing",
  "scheduled-denied",
  "scheduled-unavailable",
] as const) {
  test(
    `${mode} real Pi child loads gateway without opt-in and refreshes read-only admission`,
    { timeout: 60_000 },
    async (t) => {
      const prior = { ...process.env };
      t.after(() => {
        process.env = prior;
        mock.restoreAll();
      });
      const isScheduled = mode.startsWith("scheduled");
      const failureMode = isScheduled && mode !== "scheduled";
      let readOnly = true;
      let turn = 0;
      const modelRequests: any[] = [];
      const steps = failureMode
        ? ([["mcp_search", { query: "" }]] as const)
        : ([
            ["mcp_search", { query: "" }],
            ["mcp_describe", { name: "example.read" }],
            ["mcp_call", { name: "example.read", arguments: {} }],
            ...(mode === "scheduled" ? [["read", {}] as const] : []),
            ["mcp_call", { name: "example.write", arguments: {} }],
            ["mcp_call", { name: "example.read", arguments: {} }],
          ] as const);
      const f = await fixture(t, (body, response) => {
        if (body.method) {
          if (mode === "scheduled-denied")
            return rpcError(response, body, "call_rejected");
          if (mode === "scheduled-unavailable") {
            response.writeHead(503);
            response.end();
            return;
          }
          if (body.method === "tools/list")
            return reply(response, body, {
              tools: [
                tool("example.read", readOnly),
                tool("example.write", false),
              ],
            });
          readOnly = false;
          return reply(response, body, {
            content: [
              {
                type: "text",
                text:
                  mode === "scheduled"
                    ? "read sentinel\n" +
                      "payload ".repeat(4000) +
                      "\nspill inspection sentinel"
                    : "read sentinel",
              },
            ],
          });
        }
        modelRequests.push(body);
        const step = steps[turn++];
        let callArgs: unknown = step?.[1];
        if (step?.[0] === "read") {
          const previousResult = (body as any).messages.findLast(
            (message: any) => message.role === "tool",
          );
          const path = previousResult.content.match(/saved to: `([^`]+)`/)?.[1];
          assert.ok(path, "gateway returned a readable spill path");
          callArgs = { path };
        }
        const delta = step
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `call-${turn}`,
                  type: "function",
                  function: {
                    name: step[0],
                    arguments: JSON.stringify(callArgs),
                  },
                },
              ],
            }
          : { role: "assistant", content: "fixture finished" };
        response.writeHead(200, { "content-type": "text/event-stream" });
        const chunk = (value: unknown, finish: string | null) =>
          `data: ${JSON.stringify({ id: `chatcmpl-${turn}`, object: "chat.completion.chunk", created: 0, model: "model", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
        response.end(
          chunk(delta, null) +
            chunk({}, step ? "tool_calls" : "stop") +
            "data: [DONE]\n\n",
        );
      });
      const agentDir = join(f.dir, "agent");
      await mkdir(join(agentDir, "extensions"), { recursive: true });
      await writeFile(
        join(agentDir, "settings.json"),
        JSON.stringify({
          extensions: [
            fileURLToPath(new URL("../mcp-gateway", import.meta.url)),
          ],
          "extension:mcp-gateway": { endpoint: f.config.endpoint },
          "extension:subagents": {
            profileBalancedModel: "cutover-fixture/model",
            profileBalancedEffort: "off",
          },
        }),
      );
      const providerPath = join(f.dir, "provider.ts");
      await writeFile(
        providerPath,
        `export default function(pi) { pi.registerProvider("cutover-fixture", { baseUrl: ${JSON.stringify(f.config.endpoint.replace(/\/mcp$/, "/v1"))}, apiKey: "synthetic", api: "openai-completions", models: [{ id: "model", name: "Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 1024 }] }); }`,
      );
      process.env.PI_CODING_AGENT_DIR = agentDir;
      process.env.MCP_GATEWAY_AGENT_TOKEN =
        mode === "scheduled-missing" ? "" : TEST_BEARER;
      delete process.env.MCP_GATEWAY_ENDPOINT;
      process.env.MCP_GATEWAY_READONLY = "0";
      process.env.PI_SUBAGENT_DEPTH = "0";
      let launched = 0;
      mock.method(
        isScheduled || mode === "normal" ? _scheduledSpawn : _spawn,
        "fn",
        (command: string, args: string[], options: any) => {
          launched++;
          assert.equal(
            args.includes("--no-extensions"),
            mode === "direct" || mode === "workflow",
          );
          assert.ok(!args.includes("--mcp-gateway"));
          if (mode === "direct" || mode === "workflow")
            assert.ok(args.some((arg) => arg.endsWith("mcp-gateway")));
          assert.equal(options.env.MCP_GATEWAY_READONLY, "1");
          assert.equal(
            options.env.MCP_GATEWAY_AGENT_TOKEN,
            mode === "scheduled-missing" ? "" : TEST_BEARER,
          );
          assert.equal(options.env.MCP_GATEWAY_ENDPOINT, undefined);
          assert.equal(command, "pi");
          const cli = fileURLToPath(
            new URL(
              "./cli.js",
              import.meta.resolve("@earendil-works/pi-coding-agent"),
            ),
          );
          return nodeSpawn(
            process.execPath,
            [cli, "-e", providerPath, ...args],
            options,
          );
        },
      );
      const modelRegistry = {
        find: () => ({
          provider: "cutover-fixture",
          id: "model",
          reasoning: false,
        }),
      };
      const signal = AbortSignal.timeout(45_000);
      if (mode === "direct") {
        const result = await runSubagent({
          intent: "fixture",
          prompt: "Run fixture",
          capabilities: ["read-mcp"],
          profile: "balanced",
          cwd: f.dir,
          modelRegistry,
          signal,
        });
        assert.equal(result.ok, true, result.errorMessage ?? "child succeeded");
        assert.match(result.stdout, /fixture finished/);
      } else if (mode === "workflow") {
        const result = await runWorkflow(
          parseWorkflowScript(
            'export const meta = { name: "gateway", description: "fixture" }; export async function run() { return await agent("Run fixture", { intent: "fixture", capabilities: ["read-mcp"], profile: "balanced" }); }',
          ),
          {
            cwd: f.dir,
            signal,
            spawnAgent: createWorkflowAgentSpawner({
              cwd: f.dir,
              modelRegistry,
              logId: "gateway-fixture",
            }),
          },
        );
        assert.match(String(result.result), /fixture finished/);
      } else {
        const promptPath = join(f.dir, "prompt.txt");
        await writeFile(promptPath, "Run fixture");
        const plan = isScheduled
          ? buildSpawnPlan({
              config: { ...scheduledDefaults, rootDir: f.dir },
              task: {
                id: "gateway-fixture",
                path: join(f.dir, "task.md"),
                body: "Run fixture",
                enabled: false,
                catchup: false,
                handoff: false,
                rawFrontmatter: {},
                cwd: f.dir,
                model: "cutover-fixture/model",
                tools: ["mcp_search", "mcp_describe", "mcp_call", "read"],
                env: { MCP_GATEWAY_READONLY: "1" },
                timeoutMinutes: 0.75,
              },
              runId: "fixture",
              runDir: f.dir,
              promptPath,
            })
          : {
              command: "pi",
              args: [
                "--mode",
                "json",
                "--no-session",
                "--model",
                "cutover-fixture/model",
                "--tools",
                "mcp_search,mcp_describe,mcp_call,read",
                "-p",
                "Run fixture",
              ],
              cwd: f.dir,
              env: { MCP_GATEWAY_READONLY: "1" },
              timeoutMs: 45_000,
            };
        const result = await spawnPi(plan, join(f.dir, "run.log"));
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.timedOut, false);
        assert.match(result.stdout, /fixture finished/);
      }
      assert.equal(launched, 1);
      assert.equal(modelRequests.length, steps.length + 1);
      if (mode === "scheduled") {
        const inspection = modelRequests
          .at(-1)
          .messages.find(
            (message: any) =>
              message.role === "tool" && message.tool_call_id === "call-4",
          );
        assert.match(inspection.content, /spill inspection sentinel/);
      }
      const exposed = modelRequests[0].tools
        .map((entry: any) => entry.function.name)
        .sort();
      assert.deepEqual(exposed, [
        "mcp_call",
        "mcp_describe",
        "mcp_search",
        "read",
      ]);
      const calls = f.requests.filter(
        (request) => request.method === "tools/call",
      );
      assert.equal(calls.length, failureMode ? 0 : 1);
      const transcript = JSON.stringify(modelRequests.at(-1).messages);
      if (failureMode) {
        const error = modelRequests
          .at(-1)
          .messages.find((message: any) => message.role === "tool");
        assert.match(error.content, /mcp_search:/);
        if (mode === "scheduled-missing") {
          assert.match(error.content, /MCP_GATEWAY_AGENT_TOKEN/);
          assert.equal(
            f.requests.filter((request) => request.method).length,
            0,
          );
        } else {
          assert.ok(f.requests.filter((request) => request.method).length <= 3);
        }
      } else {
        assert.equal(calls[0].params.name, "example.read");
        assert.match(transcript, /read sentinel/);
        assert.equal(
          modelRequests
            .at(-1)
            .messages.filter(
              (message: any) =>
                message.role === "tool" &&
                /not available in read-only mode/.test(message.content),
            ).length,
          2,
        );
      }
      assert.doesNotMatch(transcript, new RegExp(TEST_BEARER));
    },
  );
}
