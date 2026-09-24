import { mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Outcome } from "../background/api.ts";

/** A stable reference remains inspectable even if the service is revoked during drain. */
export async function prepareWorkflowOutcome() {
  const directory = await mkdtemp(join(tmpdir(), "pi-workflow-outcome-"));
  const resultFile = join(directory, "result.json");
  await writeFile(
    resultFile,
    JSON.stringify({ state: "pending", replay: false }),
    { mode: 0o600, flag: "wx" },
  );
  return {
    resultFile,
    async finish(value: unknown) {
      const staging = join(directory, "final.json");
      await writeFile(staging, JSON.stringify(value), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(staging, resultFile);
    },
  };
}

export function workflowOutcomeStatus(details: {
  errorCode?: string;
  aborted?: boolean;
  agentFailureCount?: number;
  loggedBranchFailureCount?: number;
  settledBranchFailureCount?: number;
  result?: unknown;
}): Outcome["status"] {
  if (details.errorCode === "workflow_timeout") return "timeout";
  if (details.aborted) return "cancelled";
  if (
    details.errorCode ||
    details.agentFailureCount ||
    details.loggedBranchFailureCount ||
    details.settledBranchFailureCount
  )
    return "failed";
  // Preserve explicit incomplete review data without inventing a new acceptance gate.
  if (
    details.result &&
    typeof details.result === "object" &&
    "complete" in details.result &&
    details.result.complete === false
  )
    return "failed";
  return "success";
}
