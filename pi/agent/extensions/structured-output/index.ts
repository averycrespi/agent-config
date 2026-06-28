import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
) {
  return {
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    label: "Structured Output",
    description:
      "Return a final schema-backed machine-readable answer. Use this as your last action when structured output is required.",
    promptSnippet:
      "Emit a final structured answer as a terminating tool result",
    parameters: Type.Unsafe(schema),
    async execute(_toolCallId: string, params: unknown) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Structured output captured",
          },
        ],
        details: { value: params },
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

  async function ensureRegistered(cwd: string): Promise<void> {
    const warnings: string[] = [];
    const config = await loadStructuredOutputConfig(cwd, warnings);
    if (!config.schemaFile) return;

    const key = `${config.schemaFile}\n${config.terminate}`;
    if (registeredKey === key) return;

    const schema = await loadSchemaFile(config.schemaFile, warnings);
    if (!schema) return;

    pi.registerTool(createStructuredOutputTool(schema, config) as any);
    registeredKey = key;
  }

  pi.on("session_start", async (_event, ctx) => {
    await ensureRegistered(ctx.cwd);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    await ensureRegistered(ctx.cwd);
    return undefined;
  });
}
