import { createServer, type Server } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type ToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Explicit-only offline integration: real Pi, sandbox and child; no remote model. */
export default function fixture(pi: ExtensionAPI) {
  let executionId = "";
  let server: Server | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const model = {
    id: "fixture",
    name: "Offline fixture",
    reasoning: false,
    input: ["text"] as ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
  pi.on("session_start", async () => {
    const dir = process.env.WORKFLOWS_SMOKE_AGENT_DIR;
    if (!dir || dir !== process.env.PI_CODING_AGENT_DIR)
      throw Error("isolated smoke directory required");
    server = createServer((request, response) => {
      request.resume();
      const timer = setTimeout(() => {
        timers.delete(timer);
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.end(
          `data: ${JSON.stringify({ id: "offline-child", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "WORKFLOW_CHILD_COMPLETE" }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } })}\n\ndata: [DONE]\n\n`,
        );
      }, 30000);
      timers.add(timer);
      response.on("close", () => {
        clearTimeout(timer);
        timers.delete(timer);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const provider = {
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
      apiKey: "offline-fixture-not-a-secret",
      api: "openai-completions" as const,
      models: [model],
    };
    await writeFile(
      join(dir, "models.json"),
      JSON.stringify({ providers: { "workflows-child-fixture": provider } }),
      { flag: "wx", mode: 0o600 },
    );
    pi.registerProvider("workflows-child-fixture", provider);
  });
  pi.on("session_shutdown", () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    server?.closeAllConnections();
    server?.close();
  });
  pi.on("tool_result", (e) => {
    const id = (e.details as { execution?: { id?: string } })?.execution?.id;
    if (e.toolName === "workflow" && id) executionId = id;
  });
  pi.registerProvider("workflows-parent-fixture", {
    baseUrl: "http://127.0.0.1",
    apiKey: "offline-fixture-not-a-secret",
    api: "workflows-parent-fixture",
    models: [model],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      const last = context.messages.at(-1);
      const text =
        typeof last?.content === "string"
          ? last.content
          : (last?.content
              .map((b) => (b.type === "text" ? b.text : ""))
              .join("") ?? "");
      let args: ToolCall["arguments"] | undefined;
      let response = "FIXTURE_READY";
      if (last?.role === "toolResult")
        response = last.isError
          ? "FIXTURE_TOOL_FAILED"
          : "FIXTURE_TOOL_RETURNED";
      else if (text === "START")
        args = {
          action: "run",
          execution: "background",
          script: `export const meta = { name: "offline-smoke", description: "Offline integration" }; export async function run() { phase("inspect"); const value = await agent("Return the fixture answer", { intent: "Offline workflow child", capabilities: [], profile: "fast" }); phase("report"); return await report(value, { gate: () => true }); }`,
        };
      else if (text === "SECOND")
        response = "SECOND_MESSAGE_HANDLED_DURING_WORKFLOW";
      else if (text === "DISMISS")
        args = { action: "dismiss", id: executionId };
      else if (text.includes("Background workflow execution"))
        response = "AUTOMATIC_WORKFLOW_OUTCOME_WITHOUT_POLLING";
      const output: AssistantMessage = {
        role: "assistant",
        content: args
          ? [
              {
                type: "toolCall",
                id: `fixture-${Date.now()}`,
                name: "workflow",
                arguments: args,
              },
            ]
          : [{ type: "text", text: response }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: args ? "toolUse" : "stop",
        timestamp: Date.now(),
      };
      stream.push({ type: "start", partial: output });
      stream.push({
        type: "done",
        reason: args ? "toolUse" : "stop",
        message: output,
      });
      stream.end();
      return stream;
    },
  });
}
