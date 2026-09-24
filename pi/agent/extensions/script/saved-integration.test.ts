import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createAgentSession,
  createEventBus,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { fixture } from "./fixture.ts";
import script from "./index.ts";
import background from "../background/index.ts";
import offlineModel from "../background/interactive-fixture.ts";
import { getBackgroundService } from "../background/api.ts";

test(
  "isolated real Pi session executes actual saved definition and automatically receives one background outcome",
  { timeout: 15000 },
  async (t) => {
    let dispose = async () => {};
    t.after(() => dispose());
    const f = await fixture(t);
    await mkdir(join(f.dir, "scripts"));
    await copyFile(
      resolve(import.meta.dirname, "../../scripts/summarize-values.js"),
      join(f.dir, "scripts/summarize-values.js"),
    );
    const bus = createEventBus();
    const settings = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    // The deterministic model's START call is translated to the named public contract.
    // No remote model, credentials, global settings, or existing session are involved.
    const namedCall = (pi: ExtensionAPI) => {
      pi.on("tool_call", (event) => {
        if (event.toolName !== "script" || event.input.action !== "run") return;
        delete event.input.source;
        event.input.name = "summarize-values";
        event.input.args = { values: [2, 3, 5] };
        event.input.providers = [];
      });
    };
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
      extensionFactories: [background, script, offlineModel, namedCall],
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const { session } = await createAgentSession({
      cwd: f.dir,
      agentDir: f.dir,
      settingsManager: settings,
      sessionManager: SessionManager.create(f.dir, f.dir),
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
    let outcomes = 0;
    const delivered = new Promise<void>((resolve) => {
      const off = session.subscribe((event) => {
        if (
          event.type === "message_end" &&
          event.message.role === "assistant" &&
          JSON.stringify(event.message.content).includes(
            "AUTOMATIC_OUTCOME_RECEIVED_WITHOUT_POLLING",
          )
        ) {
          outcomes++;
          off();
          resolve();
        }
      });
    });
    await session.prompt("START");
    await delivered;
    await session.waitForIdle();
    const service = getBackgroundService({ events: bus });
    const records = service.list("script");
    assert.equal(records.length, 1);
    const record = service.inspect("script", records[0].id);
    assert.equal(record.status, "success");
    assert.deepEqual(JSON.parse((record.result as any).json), {
      count: 3,
      total: 10,
    });
    assert.equal((record.result as any).definition.name, "summarize-values");
    assert.equal(record.notification.handoff, "handed_to_pi");
    assert.equal(record.notification.consumed, false); // Offline model has no HTTP response hook.
    assert.equal(outcomes, 1);
    await session.prompt("SECOND");
    assert.match(
      JSON.stringify(session.messages.at(-1)),
      /SECOND_MESSAGE_HANDLED/,
    );
    assert.deepEqual(errors, []);
  },
);
