import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import sessionWatch from "./index.ts";

export const pause = (ms = 20) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
export function temporaryRoot() {
  const root = mkdtempSync(join(realpathSync("/tmp"), "sw-test-"));
  return { root, remove: () => rmSync(root, { recursive: true, force: true }) };
}
export const theme: any = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};
export function harness(root: string, mode = "tui", entries: any[] = []) {
  const handlers = new Map<string, any[]>(),
    tools = new Map<string, any>();
  const events = createEventBus();
  const messages: any[] = [],
    mounts: any[] = [];
  let component: any,
    paints = 0,
    throwHandoff = false;
  const sessionId = randomUUID();
  const ctx: any = {
    mode,
    hasUI: mode === "tui" || mode === "rpc",
    cwd: "/example",
    sessionManager: {
      getSessionId: () => sessionId,
      getLeafId: () => entries.at(-1)?.id ?? null,
      getEntry: (id: string) => entries.find((e) => e.id === id),
    },
    ui: {
      theme,
      notify() {},
      setWidget(key: string, content: any, options: any) {
        mounts.push({ key, content, options });
        component?.dispose?.();
        component =
          typeof content === "function"
            ? content(
                {
                  requestRender() {
                    paints++;
                  },
                },
                theme,
              )
            : undefined;
      },
    },
  };
  const pi: any = {
    events,
    on(name: string, handler: any) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({
        type: "custom",
        customType,
        data: structuredClone(data),
        id: randomUUID(),
        parentId: entries.at(-1)?.id ?? null,
      });
    },
    sendMessage(message: any, options: any) {
      messages.push({ message, options });
      if (throwHandoff) throw new Error("PRIVATE handoff error");
    },
  };
  sessionWatch(pi, () => root);
  return {
    pi,
    ctx,
    events,
    entries,
    messages,
    mounts,
    tools,
    get component() {
      return component;
    },
    get paints() {
      return paints;
    },
    failHandoff() {
      throwHandoff = true;
    },
    async hook(name: string) {
      for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
    },
    call(params: any, signal?: AbortSignal) {
      return tools
        .get("session_watch")
        .execute("fixture", params, signal, undefined, ctx);
    },
  };
}
export function value(result: any) {
  // Tool content is deliberately wrapped; receipts are also structured in details.
  const text = result.content[0].text as string;
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}
