import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { stripVTControlCharacters } from "node:util";
import { createManagedLogger } from "../_shared/logging.ts";
import { spillIfNeeded } from "../_shared/spillover.ts";
import { wrapUntrustedTextBlocks } from "../_shared/untrusted.ts";
import { record, redactCredentials, type CallResult } from "./client.ts";

export type Content = AgentToolResult<unknown>["content"];
export function display(value: unknown, limit = 240): string {
  return redactCredentials(
    stripVTControlCharacters(typeof value === "string" ? value : ""),
  )
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
export function textContent(content: Content): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function normalizeResult(result: CallResult): Content {
  const content: Content = [];
  const imageSize = result.content.reduce<number>(
    (sum, block) =>
      sum +
      (record(block) && block.type === "image" && typeof block.data === "string"
        ? block.data.length
        : 0),
    0,
  );
  for (const block of result.content) {
    if (
      record(block) &&
      block.type === "text" &&
      typeof block.text === "string"
    ) {
      content.push({ type: "text", text: redactCredentials(block.text) });
    } else if (
      record(block) &&
      block.type === "image" &&
      typeof block.data === "string" &&
      typeof block.mimeType === "string" &&
      /^image\/(?:png|jpeg|gif|webp)$/.test(block.mimeType) &&
      imageSize <= 5_000_000
    ) {
      content.push({
        type: "image",
        data: block.data,
        mimeType: block.mimeType,
      });
    } else if (
      record(block) &&
      block.type === "resource" &&
      record(block.resource) &&
      typeof block.resource.text === "string"
    ) {
      content.push({
        type: "text",
        text: redactCredentials(JSON.stringify(block.resource)),
      });
    } else {
      content.push({
        type: "text",
        text: redactCredentials(JSON.stringify(block) ?? "null"),
      });
    }
  }
  if (result.structuredContent !== undefined)
    content.push({
      type: "text",
      text: `Structured content:\n${redactCredentials(JSON.stringify(result.structuredContent, null, 2))}`,
    });
  return content;
}

export async function prepareContent(
  kind: string,
  content: Content,
  id: string,
  dir?: string,
) {
  const framed = wrapUntrustedTextBlocks(kind, content);
  const spill = await spillIfNeeded(
    framed.map((block) => ({ ...block })),
    id,
    dir,
  );
  return {
    content: (spill.spilled
      ? wrapUntrustedTextBlocks(kind, spill.content)
      : spill.content) as Content,
    details: spill.spilled
      ? { spillFilePath: spill.filePath, originalSize: spill.originalSize }
      : {},
  };
}

export async function failureLog(
  id: string,
  code: string,
  invocationId?: string,
): Promise<string | undefined> {
  try {
    const logger = createManagedLogger({
      extensionName: "mcp-gateway",
      id: `${id}-failure`,
    });
    logger.write(
      `mcp_call failed: ${display(code)}\n${invocationId ? `Invocation: ${display(invocationId)}\n` : ""}`,
    );
    await logger.close();
    return logger.path;
  } catch {
    return undefined;
  }
}
