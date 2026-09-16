import { randomUUID } from "node:crypto";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import askUser from "../ask-user/index.ts";
import { SessionProvider } from "./sessions.ts";
import { discover } from "./session-transport.ts";
import { BackgroundEngine } from "./engine.ts";
import { registration } from "./contract.ts";

const tools = new Map<string, any>();
const pi: any = {
  events: createEventBus(),
  registerTool: (tool: any) => tools.set(tool.name, tool),
};
askUser(pi);
const sessionId = randomUUID();
let provider = new SessionProvider(pi, sessionId, process.argv[2]);
const engine = new BackgroundEngine({
  idle: () => true,
  persist() {},
  changed() {},
  handoff() {
    throw Error("unexpected handoff");
  },
  subscribe: async () => {
    throw Error("unexpected subscription");
  },
  evaluate: async () => ({
    status: "success",
    json: '{"decision":"wait","evidence":null}',
    traces: [],
    partialExecution: false,
    effectsMayPersist: false,
    outcomeUnknown: false,
  }),
});
// IPC owns fixture liveness; production sockets and timers remain unreferenced.
process.on("message", async (message: any) => {
  try {
    if (message.command === "ask") {
      await tools.get("ask_user").execute(
        "PRIVATE tool ID",
        {
          question: "PRIVATE question",
          options: [
            { label: "PRIVATE option A" },
            { label: "PRIVATE option B" },
          ],
        },
        undefined,
        undefined,
        {
          hasUI: true,
          mode: "tui",
          ui: {
            async custom(factory: any) {
              factory(
                { requestRender() {} },
                { fg: (_c: string, s: string) => s, bold: (s: string) => s },
                {},
                () => {},
              );
              return null;
            },
          },
        },
      );
    } else if (message.command === "pending") {
      await engine.start(
        registration({
          name: "CI pending",
          message: "Inspect",
          providers: [],
          source: "fixture",
          interval_ms: 1000,
          cycle_timeout_ms: 60000,
          lifetime_ms: 120000,
          max_wakes: 1,
        }),
      );
    } else if (message.command === "settled") provider.publish("agent_settled");
    else if (message.command === "reload") {
      provider.close();
      provider = new SessionProvider(pi, sessionId, process.argv[2]);
      await provider.start();
    } else if (message.command === "stop") {
      engine.close(false);
      provider.close();
      process.send?.({ id: message.id });
      process.disconnect?.();
      return;
    }
    process.send?.({
      id: message.id,
      jobs: engine.list().map((r) => r.status),
    });
  } catch {
    process.send?.({ id: message.id, error: true });
  }
});
await provider.start();
process.send?.({ ready: (await discover(process.argv[2]))[0] });
