import { readFile } from "node:fs/promises";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { registerConfigCommand } from "../_shared/config.ts";
import {
  loadStructuredOutputConfig,
  type StructuredOutputConfig,
} from "./config.ts";
import {
  STRUCTURED_OUTPUT_EXTENSION_NAME,
  STRUCTURED_OUTPUT_TOOL_NAME,
} from "./api.ts";

type JsonSchema = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadSchemaFile(
  schemaFile: string,
  warnings: string[] = [],
): Promise<JsonSchema | undefined> {
  let raw: string;
  try {
    raw = await readFile(schemaFile, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(
      `Unable to read structured output schema ${schemaFile}: ${message}`,
    );
    return undefined;
  }

  try {
    const schema = JSON.parse(raw);
    if (isPlainObject(schema)) return schema;
    warnings.push(
      `Ignoring structured output schema ${schemaFile}: root must be an object`,
    );
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(
      `Ignoring invalid structured output schema ${schemaFile}: ${message}`,
    );
    return undefined;
  }
}

function createStructuredOutputTool(
  schema: JsonSchema,
  config: StructuredOutputConfig,
  onCapture: () => void,
) {
  const wrapped = schema.type !== "object";
  const parameters = wrapped
    ? Type.Object(
        { value: Type.Unsafe(schema) },
        { additionalProperties: false },
      )
    : Type.Unsafe(schema);

  return {
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    label: "Structured Output",
    description:
      "Return a final schema-backed machine-readable answer. Use this as your last action when structured output is required.",
    promptSnippet:
      "Emit a final structured answer as a terminating tool result",
    parameters,
    async execute(_toolCallId: string, params: unknown) {
      onCapture();
      const value = wrapped ? (params as { value: unknown }).value : params;
      return {
        content: [
          {
            type: "text" as const,
            text: "Structured output captured",
          },
        ],
        details: { value },
        terminate: config.terminate,
      };
    },
  };
}

export default function (pi: ExtensionAPI) {
  registerConfigCommand(pi, {
    extensionName: STRUCTURED_OUTPUT_EXTENSION_NAME,
    loadConfig: loadStructuredOutputConfig,
  });

  let registeredKey: string | undefined;
  let activeConfig: StructuredOutputConfig | undefined;
  let captured = false;
  let remindersSent = 0;
  let reminderTurnStarting = false;
  let terminalRunFailure = false;

  async function ensureRegistered(cwd: string): Promise<void> {
    const warnings: string[] = [];
    const config = await loadStructuredOutputConfig(cwd, warnings);
    if (!config.schemaFile) {
      activeConfig = undefined;
      return;
    }

    const key = `${config.schemaFile}\n${config.terminate}`;
    if (registeredKey === key) {
      activeConfig = config;
      return;
    }

    const schema = await loadSchemaFile(config.schemaFile, warnings);
    if (!schema) {
      activeConfig = undefined;
      return;
    }

    pi.registerTool(
      createStructuredOutputTool(schema, config, () => {
        captured = true;
      }) as any,
    );
    registeredKey = key;
    activeConfig = config;
  }

  function resetAttempt(): void {
    captured = false;
    remindersSent = 0;
    terminalRunFailure = false;
  }

  pi.on("session_start", async (_event, ctx) => {
    reminderTurnStarting = false;
    resetAttempt();
    await ensureRegistered(ctx.cwd);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    await ensureRegistered(ctx.cwd);
    return undefined;
  });

  pi.on("agent_start", async () => {
    if (reminderTurnStarting) {
      reminderTurnStarting = false;
    } else {
      resetAttempt();
    }
  });

  pi.on(
    "agent_end",
    async (event: { messages?: unknown }, ctx: ExtensionContext) => {
      if (!Array.isArray(event.messages)) return;
      for (let index = event.messages.length - 1; index >= 0; index -= 1) {
        const message = event.messages[index];
        if (
          typeof message === "object" &&
          message !== null &&
          (message as { role?: unknown }).role === "assistant"
        ) {
          const stopReason = (message as { stopReason?: unknown }).stopReason;
          terminalRunFailure =
            stopReason === "error" || stopReason === "aborted";
          break;
        }
      }

      if (
        !activeConfig ||
        captured ||
        terminalRunFailure ||
        remindersSent >= activeConfig.missingOutputReminders
      ) {
        return;
      }
      if (await ctx.hasPendingMessages()) return;

      remindersSent += 1;
      reminderTurnStarting = true;
      pi.sendUserMessage(
        `Your response did not call ${STRUCTURED_OUTPUT_TOOL_NAME}. Call it now with your final answer. Do not repeat the work or respond only in prose.`,
        { deliverAs: "followUp" },
      );
    },
  );
}
