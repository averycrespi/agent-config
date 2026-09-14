import askUser from "../ask-user/index.ts";
import { MonitorEngine } from "../monitor/engine.ts";
import { parseConfig } from "../monitor/config.ts";
import { harness, value } from "./test-support.ts";

// Controlled child process: actual extension hooks, event bus, and CONFIG-10 publishers.
const h = harness(process.argv[2], "json");
askUser(h.pi);
const monitor = new MonitorEngine(parseConfig({}, {}), {
  execute: async () => ({
    status: "success",
    json: '{"decision":"wait","evidence":null}',
    traces: [],
    partialExecution: false,
    effectsMayPersist: false,
    outcomeUnknown: false,
  }),
  persist() {},
  changed() {},
  handoff() {
    throw Error("unexpected monitor handoff");
  },
  event: (e) => h.events.emit(`monitor:${e.type}`, e),
});
// Attach IPC before awaiting unreferenced watcher sockets: this fixture, not
// Session Watch, must keep the controlled child alive during discovery.
process.on("message", async (message: any) => {
  try {
    if (message.command === "ask") {
      await h.tools.get("ask_user").execute(
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
    } else if (message.command === "monitor") {
      monitor.start(
        {
          name: "CI pending",
          description: "Fixture only",
          source: "PRIVATE source",
          message: "PRIVATE instruction",
          timeout_ms: 60000,
        },
        { maxCalls: 4, maxConcurrency: 2, timeoutMs: 1000 },
      );
    } else if (message.command === "settled") await h.hook("agent_settled");
    else if (message.command === "reload") {
      await h.hook("session_shutdown");
      await h.hook("session_start");
    } else if (message.command === "stop") {
      monitor.close();
      await h.hook("session_shutdown");
      process.send?.({ id: message.id });
      process.disconnect?.();
      return;
    }
    process.send?.({
      id: message.id,
      monitors: monitor.list().map((r) => r.state),
      messages: h.messages.length,
    });
  } catch {
    process.send?.({ id: message.id, error: true });
  }
});
await h.hook("session_start");
process.send?.({ ready: value(await h.call({ action: "list" })).self });
