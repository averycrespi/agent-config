import { createEventBus } from "@earendil-works/pi-coding-agent";
export const SESSION = "00000000-0000-4000-8000-000000000001";
export function context(cwd: string, id = SESSION): any {
  return {
    cwd,
    mode: "tui",
    hasUI: false,
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => id },
    ui: { getEditorText: () => "", notify() {}, setWidget() {} },
  };
}
export function runtime(cwd: string) {
  const hooks = new Map<string, any>(),
    commands = new Map<string, any>();
  const messages: any[] = [];
  let tool: any;
  const pi: any = {
    events: createEventBus(),
    on: (name: string, fn: any) => hooks.set(name, fn),
    registerCommand: (name: string, fn: any) => commands.set(name, fn),
    registerMessageRenderer() {},
    registerTool: (value: any) => {
      tool = value;
    },
    sendMessage: (message: any) => messages.push(message),
  };
  const ctx = context(cwd);
  return {
    pi,
    ctx,
    hooks,
    commands,
    messages,
    get tool() {
      return tool;
    },
  };
}
