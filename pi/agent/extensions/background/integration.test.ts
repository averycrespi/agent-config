import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { fixture } from "../script/fixture.ts";
import background from "./index.ts";
import script from "../script/index.ts";
import interactiveFixture from "./interactive-fixture.ts";
import { getBackgroundService } from "./api.ts";

test(
  "real Pi agent lifecycle: background tool admission, second prompt, cancellation notification without model polling, navigation",
  { timeout: 15000 },
  async (t) => {
    let dispose = async () => {};
    t.after(() => dispose());
    const f = await fixture(t);
    const bus = createEventBus();
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
      extensionFactories: [background, script, interactiveFixture],
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
      tools: ["script"],
    });
    dispose = async () => {
      await session.extensionRunner.emit({
        type: "session_shutdown",
        reason: "quit",
      });
      session.dispose();
    };
    const errors: unknown[] = [];
    await session.bindExtensions({
      mode: "json",
      onError: (e) => errors.push(e),
    });
    await session.setModel(
      session.modelRuntime.getModel("background-fixture", "fixture")!,
    );
    await session.prompt("START");
    const service = getBackgroundService({ events: bus });
    const record = service.list("script")[0];
    assert.ok(record, JSON.stringify(session.messages));
    assert.equal(record.status, "running");
    await session.prompt("SECOND");
    assert.match(
      JSON.stringify(session.messages.at(-1)),
      /SECOND_MESSAGE_HANDLED/,
    );
    assert.equal(service.inspect("script", record.id).status, "running");
    const notification = new Promise<void>((resolve) => {
      const off = session.subscribe((e) => {
        if (
          e.type === "message_end" &&
          e.message.role === "assistant" &&
          JSON.stringify(e.message.content).includes(
            "AUTOMATIC_OUTCOME_RECEIVED_WITHOUT_POLLING",
          )
        ) {
          off();
          resolve();
        }
      });
    });
    service.cancel("script", record.id);
    await notification;
    await session.waitForIdle();
    assert.equal(service.inspect("script", record.id).status, "cancelled");
    assert.equal(
      service.inspect("script", record.id).notification.handoff,
      "handed_to_pi",
    );
    // Offline model has no HTTP response hook: do not invent observed consumption.
    assert.equal(
      service.inspect("script", record.id).notification.consumed,
      false,
    );
    await session.prompt("DISMISS");
    assert.equal(service.inspect("script", record.id).dismissed, true);
    await session.navigateTree(record.anchor, { summarize: false });
    assert.throws(() => service.cancel("script", record.id), /unavailable/);
    assert.equal(
      getBackgroundService({ events: bus }).inspect("script", record.id).status,
      "cancelled",
    );
    assert.deepEqual(errors, []);
  },
);
