import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spillIfNeeded } from "../_shared/spillover.ts";
import type { SpawnRunResult } from "./index.ts";

export async function retainChildResult(result: SpawnRunResult) {
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized) <= 2500) return JSON.parse(serialized);
  try {
    const dir = await mkdtemp(join(tmpdir(), "pi-subagent-outcome-"));
    const path = join(dir, "result.json");
    await writeFile(path, serialized, { mode: 0o600, flag: "wx" });
    return { resultFile: path, usage: result.usage ?? null };
  } catch {
    return {
      retentionError: "Child outcome storage failed",
      usage: result.usage ?? null,
    };
  }
}

/** Keep complete adapter outcomes outside the bounded Background sidecar when needed. */
export async function retainBatchResult(batch: SpawnRunResult, callId: string) {
  const serialized = JSON.stringify(batch);
  if (Buffer.byteLength(serialized) <= 60000) return JSON.parse(serialized);
  // ASCII escapes make the shared character threshold conservative for UTF-8 too.
  const ascii = serialized.replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const spill = await spillIfNeeded(
    [{ type: "text", text: ascii }],
    `${callId}-batch-${randomUUID()}`,
  );
  return {
    allOk: batch.details.allOk,
    failed: batch.details.failed,
    total: batch.details.total,
    usage: batch.usage ?? null,
    ...(spill.spilled
      ? { resultFile: spill.filePath, resultFormat: "json" }
      : {
          retentionError:
            "Full batch output could not be retained; accounting and child statuses remain available",
        }),
    children: (batch.details.outcomes as SpawnRunResult[]).map(
      (child, index) => ({
        index,
        ok: child.details.ok,
        aborted: child.details.aborted ?? false,
        usage: child.usage ?? null,
      }),
    ),
  };
}
