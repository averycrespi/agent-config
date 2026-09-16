import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  createPowerShellTool,
  createGrepTool,
  createFindTool,
  createLsTool,
  type ExtensionAPI,
  type BashToolOptions,
} from "@earendil-works/pi-coding-agent";
import {
  registerScriptProvider,
  snapshotScriptJson,
  type JsonValue,
  type ScriptMethod,
  type ScriptSession,
} from "../script/api.ts";

const factories = {
  read: createReadTool,
  write: createWriteTool,
  edit: createEditTool,
  bash: createBashTool,
  grep: createGrepTool,
  find: createFindTool,
  ls: createLsTool,
  ...(process.platform === "win32" ? { powershell: createPowerShellTool } : {}),
};

function shellOptions(session?: ScriptSession): BashToolOptions {
  return {
    exposeSessionEnvironment: false,
    spawnHook: (context) => {
      const env = { ...context.env };
      if (session) {
        env.PI_SESSION_ID = session.id;
        if (session.file !== undefined) env.PI_SESSION_FILE = session.file;
        if (session.provider !== undefined) env.PI_PROVIDER = session.provider;
        if (session.model !== undefined) env.PI_MODEL = session.model;
        if (session.reasoningLevel !== undefined)
          env.PI_REASONING_LEVEL = session.reasoningLevel;
      }
      return { ...context, env };
    },
  };
}

/** Registration owns no tool activation, permission grants, hooks or mutation queue. */
export function registerBuiltinsProvider(
  pi: Pick<ExtensionAPI, "events" | "getActiveTools" | "getAllTools">,
  ready: () => boolean,
  schemaCwd: string,
) {
  const methods: Record<string, ScriptMethod> = {};
  for (const [name, factory] of Object.entries(factories)) {
    if (!factory) continue;
    const schema = factory(schemaCwd).parameters;
    const available = () =>
      ready() &&
      pi.getActiveTools().includes(name) &&
      pi.getAllTools().some((tool) => tool.name === name);
    methods[name] = {
      description: `Execute the active stock Pi ${name} tool with its argument object. Returns structured content and optional details. Images fail with unsupported_image_use_direct_read; use direct read instead. No nested Pi hooks; permission is not approval.`,
      inputSchema: {
        type: "array",
        items: [JSON.parse(JSON.stringify(schema))],
        minItems: 1,
        maxItems: 1,
        additionalItems: false,
      },
      available,
      errorCodes: [
        "unsupported_image_use_direct_read",
        "builtin_failed",
        "context_unavailable",
      ],
      async handler(args, { signal, execution }) {
        if (!execution || !isAbsolute(execution.cwd))
          return { value: null, error: "context_unavailable" };
        signal.throwIfAborted();
        const tool =
          name === "bash"
            ? createBashTool(execution.cwd, shellOptions(execution.session))
            : name === "powershell"
              ? createPowerShellTool(
                  execution.cwd,
                  shellOptions(execution.session),
                )
              : factory(execution.cwd);
        let result;
        try {
          result = await tool.execute(randomUUID(), args[0] as never, signal);
        } catch {
          // Stock errors do not carry a repeat-safety classification. Writes/shell
          // may have partially completed; never infer absence of effects from a throw.
          return { value: null, error: "builtin_failed", outcomeUnknown: true };
        }
        if (result.content.some((block) => block.type === "image"))
          return { value: null, error: "unsupported_image_use_direct_read" };
        // Pi uses explicit undefined for absent optional metadata. Omit only
        // those documented fields; strict snapshot rejects every other lossy value.
        const value: Record<string, unknown> = { ...result };
        if (value.details === undefined) delete value.details;
        else if (name === "edit") {
          const details = { ...(value.details as Record<string, unknown>) };
          if (details.firstChangedLine === undefined)
            delete details.firstChangedLine;
          value.details = details;
        }
        return { value: JSON.parse(snapshotScriptJson(value)) as JsonValue };
      },
    };
  }
  return registerScriptProvider(pi, {
    namespace: "builtins",
    methods,
    available: ready,
  });
}
