import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type ToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerScriptProvider } from "../script/api.ts";

/** Explicit-only offline smoke fixture; never loaded by the extension entrypoint. */
export default function fixture(pi: ExtensionAPI) {
  let executionId = "";
  const dispose = registerScriptProvider(pi, {
    namespace: "fixture",
    available: () => true,
    methods: {
      wait: {
        description:
          "Wait a bounded number of milliseconds in an isolated smoke test",
        inputSchema: {
          type: "array",
          items: [{ type: "integer", minimum: 1, maximum: 60000 }],
          minItems: 1,
          maxItems: 1,
        },
        handler: async (args, { signal }) => {
          await new Promise<void>((resolve, reject) => {
            signal.throwIfAborted();
            const timer = setTimeout(() => {
              signal.removeEventListener("abort", abort);
              resolve();
            }, args[0] as number);
            const abort = () => {
              clearTimeout(timer);
              reject(Error("cancelled"));
            };
            signal.addEventListener("abort", abort, { once: true });
          });
          return { value: { completed: true } };
        },
      },
    },
  });
  pi.on("session_shutdown", dispose);
  pi.on("tool_result", (e) => {
    const d = e.details as { records?: Array<{ id: string }> } | undefined;
    if (e.toolName === "script" && d?.records?.[0])
      executionId = d.records[0].id;
  });
  pi.registerProvider("background-fixture", {
    baseUrl: "http://127.0.0.1",
    apiKey: "offline-fixture-not-a-secret",
    api: "background-fixture",
    models: [
      {
        id: "fixture",
        name: "Offline lifecycle fixture",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
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
          description: "smoke\u001b]52;c;hostile\u0007\n宽字符",
          providers: ["fixture"],
          source: "return await fixture.wait(30000);",
        };
      else if (text === "DISMISS")
        args = {
          action: "dismiss",
          description: "Dismiss fixture terminal row",
          id: executionId,
        };
      else if (text === "SECOND") response = "SECOND_MESSAGE_HANDLED";
      else if (text.includes("Background script execution"))
        response = "AUTOMATIC_OUTCOME_RECEIVED_WITHOUT_POLLING";
      const output: AssistantMessage = {
        role: "assistant",
        content: args
          ? [
              {
                type: "toolCall",
                id: `fixture-${Date.now()}`,
                name: "script",
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
