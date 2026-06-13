import assert from "node:assert/strict";
import { mock, test } from "node:test";
import startupHeaderExtension, { _startupHeaderDeps } from "./index.ts";

const identityTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("session_start renders fallback header when metadata load rejects", async () => {
  const renders: string[][] = [];
  const handlers = new Map<string, Function>();
  const loadStub = mock.method(
    _startupHeaderDeps,
    "loadGitMetadata",
    async () => {
      throw new Error("metadata failed");
    },
  );

  const pi = {
    on(event: string, handler: Function) {
      handlers.set(event, handler);
    },
  } as any;
  const ctx = {
    hasUI: true,
    cwd: "/repo/agent-config",
    ui: {
      setHeader(factory: Function) {
        let component: { render(width: number): string[] };
        component = factory(
          {
            requestRender() {
              renders.push(component.render(120));
            },
          },
          identityTheme,
        );
        renders.push(component.render(120));
      },
    },
  };

  try {
    startupHeaderExtension(pi);
    const handler = handlers.get("session_start");
    assert.ok(handler, "session_start handler should be registered");

    await handler!({ type: "session_start" }, ctx);
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(renders.length >= 2);
    assert.ok(renders.at(-1)?.some((line) => line.includes("agent-config")));
  } finally {
    loadStub.mock.restore();
  }
});
