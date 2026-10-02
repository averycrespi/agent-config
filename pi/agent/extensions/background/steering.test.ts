import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { fixture } from "../script/fixture.ts";
import background from "./index.ts";
import { getBackgroundService } from "./api.ts";
import monitor from "../monitor/index.ts";
import mailbox from "../mailbox/index.ts";
import { MailboxStore } from "../mailbox/store.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

for (const producer of [
  "script",
  "subagents",
  "workflow",
  "monitor",
  "mailbox",
] as const) {
  test(
    `real Pi boundary: ${producer} steers active tool work without abort or settlement, then wakes idle`,
    { timeout: 12000 },
    async (t) => {
      const f = await fixture(t);
      await writeFile(
        join(f.dir, "settings.json"),
        JSON.stringify({ "extension:mailbox": { batchWindowMs: 0 } }),
      );
      const bus = createEventBus();
      const entered = deferred(),
        release = deferred();
      let handed = deferred();
      let toolFinished = false,
        aborted = false,
        requests = 0,
        settled = 0;
      const contexts: string[] = [];
      let startMonitor!: () => Promise<unknown>;
      let notificationType = "";
      const factory = async (pi: ExtensionAPI) => {
        const send = pi.sendMessage.bind(pi);
        const adapter = {
          ...pi,
          sendMessage(message: any, options: any) {
            notificationType = message.customType;
            send(message, options);
            handed.resolve();
          },
          registerTool(tool: any) {
            if (tool.name === "monitor")
              startMonitor = () =>
                tool.execute("timer", {
                  action: "start",
                  name: "boundary",
                  message: "Inspect",
                  providers: [],
                  delay_ms: 1000,
                  cycle_timeout_ms: 5000,
                  lifetime_ms: 6000,
                  max_wakes: 1,
                });
            pi.registerTool(tool);
          },
        } as ExtensionAPI;
        if (producer === "monitor") await monitor(adapter);
        else if (producer === "mailbox")
          mailbox(adapter, join(f.dir, "mailboxes"));
        else background(adapter);
        pi.on("agent_settled", () => {
          settled++;
        });
        pi.registerTool({
          name: "boundary_tool",
          label: "Boundary",
          description: "Offline controlled tool",
          parameters: Type.Object({}),
          async execute(_id, _args, signal) {
            entered.resolve();
            await release.promise;
            aborted = signal?.aborted ?? false;
            toolFinished = true;
            return {
              content: [{ type: "text", text: "TOOL_COMPLETED_NORMALLY" }],
              details: {},
            };
          },
        });
        pi.registerProvider("steering-fixture", {
          baseUrl: "http://127.0.0.1",
          apiKey: "offline-fixture-not-a-secret",
          api: "steering-fixture",
          models: [
            {
              id: "fixture",
              name: "Offline boundary",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 4096,
            },
          ],
          streamSimple(model, context) {
            requests++;
            contexts.push(JSON.stringify(context.messages));
            const first = requests === 1;
            const output: AssistantMessage = {
              role: "assistant",
              content: first
                ? [
                    {
                      type: "toolCall",
                      id: "controlled-tool",
                      name: "boundary_tool",
                      arguments: {},
                    },
                  ]
                : [{ type: "text", text: "DONE" }],
              api: model.api,
              provider: model.provider,
              model: model.id,
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  total: 0,
                },
              },
              stopReason: first ? "toolUse" : "stop",
              timestamp: Date.now(),
            };
            const stream = createAssistantMessageEventStream();
            stream.push({ type: "start", partial: output });
            stream.push({
              type: "done",
              reason: first ? "toolUse" : "stop",
              message: output,
            });
            stream.end();
            return stream;
          },
        });
      };
      const settings = SettingsManager.inMemory({
        compaction: { enabled: false },
        retry: { enabled: false },
      });
      const loader = new DefaultResourceLoader({
        cwd: f.dir,
        agentDir: f.dir,
        settingsManager: settings,
        eventBus: bus,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        extensionFactories: [factory],
      });
      await loader.reload();
      assert.deepEqual(loader.getExtensions().errors, []);
      const manager = SessionManager.create(f.dir, f.dir);
      const { session } = await createAgentSession({
        cwd: f.dir,
        agentDir: f.dir,
        settingsManager: settings,
        sessionManager: manager,
        resourceLoader: loader,
        tools: ["boundary_tool"],
      });
      t.after(async () => {
        release.resolve();
        await session.waitForIdle();
        await session.extensionRunner.emit({
          type: "session_shutdown",
          reason: "quit",
        });
        session.dispose();
      });
      const errors: unknown[] = [];
      await session.bindExtensions({
        mode: "json",
        onError: (e) => errors.push(e),
      });
      await session.setModel(
        session.modelRuntime.getModel("steering-fixture", "fixture")!,
      );
      const notify = async () => {
        if (producer === "monitor") await startMonitor();
        else if (producer === "mailbox")
          new MailboxStore(join(f.dir, "mailboxes")).send(
            manager.getSessionId(),
            "result",
            "BOUNDARY_NOTIFICATION",
            manager.getSessionId(),
          );
        else
          getBackgroundService({ events: bus }).admit({
            owner: producer,
            label: "boundary",
            deadlineMs: Date.now() + 5000,
            run: async () => ({
              status: "success",
              effectsMayPersist: false,
              outcomeUnknown: false,
            }),
          });
      };
      const run = session.prompt("BEGIN");
      await entered.promise;
      await notify();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          handed.promise,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("notification withheld during active tool")),
              3000,
            );
          }),
        ]);
        assert.equal(toolFinished, false);
        assert.equal(settled, 0);
        assert.equal(requests, 1);
      } finally {
        clearTimeout(timer);
        release.resolve();
      }
      await run;
      assert.equal(aborted, false);
      assert.equal(toolFinished, true);
      assert.match(contexts[1], /TOOL_COMPLETED_NORMALLY/);
      assert.match(
        contexts[1],
        /Background .* execution|Monitor|BOUNDARY_NOTIFICATION/,
      );
      assert.ok(
        session.messages.some(
          (m: any) => m.role === "custom" && m.customType === notificationType,
        ),
      );
      assert.equal(requests, 2);
      assert.equal(settled, 1);
      // A distinct eligible outcome also starts an ordinary run when idle.
      if (producer === "mailbox") {
        const store = new MailboxStore(join(f.dir, "mailboxes"));
        store.ack(
          manager.getSessionId(),
          store.list(manager.getSessionId()).messages.map((m) => m.id),
        );
      }
      handed = deferred();
      await notify();
      await handed.promise;
      await session.waitForIdle();
      assert.equal(requests, 3);
      assert.equal(settled, 2);
      assert.deepEqual(errors, []);
    },
  );
}
