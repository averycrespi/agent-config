import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const THRESHOLD_CHARS = 25_000;
export const PREVIEW_BYTES = 2_000;
export const SPILL_DIR = join(tmpdir(), "pi-extension-spillover");
export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const cleanedDirs = new Set<string>();

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; [k: string]: unknown }
  | { type: string; [k: string]: unknown };

/** Aggregate all text blocks joined with "\n". Non-text blocks are ignored. */
export function joinText(content: ContentBlock[]): string {
  const parts = content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text);
  return parts.join("\n");
}

export interface EnvelopeParams {
  filePath: string;
  originalSize: number;
  joinedText: string;
}

function formatKilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Build the persisted-output envelope string. */
export function buildEnvelope({
  filePath,
  originalSize,
  joinedText,
}: EnvelopeParams): string {
  const kb = (originalSize / 1024).toFixed(1);
  const head = joinedText.slice(0, PREVIEW_BYTES);
  const truncatedBytes =
    Buffer.byteLength(joinedText, "utf8") - Buffer.byteLength(head, "utf8");

  return [
    "<persisted-output>",
    `Output too large (${kb} KB / ${originalSize} chars). Full output saved to: \`${filePath}\``,
    "",
    `Preview (first ${formatKilobytes(PREVIEW_BYTES)}):`,
    head,
    "",
    `…${truncatedBytes} bytes truncated…`,
    "",
    "Use the read tool on the path above to fetch the full content.",
    "</persisted-output>",
  ].join("\n");
}

export interface SpillResult {
  spilled: false;
  content: ContentBlock[];
}

export interface SpilledResult {
  spilled: true;
  content: ContentBlock[];
  filePath: string;
  originalSize: number;
}

export type SpillIfNeededResult = SpillResult | SpilledResult;

export async function cleanupOldSpilloverFiles(
  dir: string = SPILL_DIR,
  maxAgeMs: number = DEFAULT_RETENTION_MS,
  now: number = Date.now(),
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".txt"))
      .map(async (entry) => {
        const path = join(dir, entry);
        try {
          const info = await stat(path);
          if (info.isFile() && now - info.mtimeMs > maxAgeMs) {
            await rm(path, { force: true });
          }
        } catch {
          // best-effort cleanup
        }
      }),
  );
}

/**
 * Public entry point. Returns content unchanged if below threshold or if text
 * is empty. On spill, writes to dir (default: SPILL_DIR) and returns envelope.
 *
 * @param dir - Override the spill directory (test-only).
 */
export async function spillIfNeeded(
  content: ContentBlock[],
  toolCallId: string,
  dir: string = SPILL_DIR,
): Promise<SpillIfNeededResult> {
  const joinedText = joinText(content);

  if (joinedText.length === 0 || joinedText.length <= THRESHOLD_CHARS) {
    return { spilled: false, content };
  }

  const safeName = toolCallId.replace(/[^a-zA-Z0-9_:-]/g, "_");
  let filePath: string | undefined;

  try {
    await mkdir(dir, { recursive: true });
    if (!cleanedDirs.has(dir)) {
      cleanedDirs.add(dir);
      await cleanupOldSpilloverFiles(dir);
    }
    for (let i = 0; i <= 100; i += 1) {
      const candidate = join(
        dir,
        i === 0 ? `${safeName}.txt` : `${safeName}-${i}.txt`,
      );
      try {
        await writeFile(candidate, joinedText, { flag: "wx", mode: 0o600 });
        filePath = candidate;
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code !== "EEXIST") throw error;
      }
    }
  } catch {
    return { spilled: false, content };
  }

  if (!filePath) return { spilled: false, content };

  const originalSize = joinedText.length;
  const envelope = buildEnvelope({ filePath, originalSize, joinedText });

  // Replace all text blocks with a single envelope block at the position of
  // the first text block; non-text blocks pass through unchanged.
  const firstTextIdx = content.findIndex((b) => b.type === "text");
  const envelopeBlock: ContentBlock = { type: "text", text: envelope };
  const before = content
    .slice(0, firstTextIdx)
    .filter((b) => b.type !== "text");
  const after = content
    .slice(firstTextIdx + 1)
    .filter((b) => b.type !== "text");
  const newContent: ContentBlock[] = [...before, envelopeBlock, ...after];

  return { spilled: true, content: newContent, filePath, originalSize };
}
