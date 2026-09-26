import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import {
  digest,
  readIndex,
  type Index,
} from "../../skills/coordinate-repo/scripts/index.js";
import {
  host,
  launchWorker,
  preflightWorker,
} from "../../skills/coordinate-repo/scripts/launch-worker.js";
import { inspectMonitor } from "../monitor/api.ts";
import { inspectMailbox, mailboxSupervision } from "../mailbox/api.ts";
import { describeScriptProviders } from "../script/api.ts";
import {
  assignments,
  absolute,
  bind,
  load,
  need,
  patch,
  text,
  type Binding,
  type Worker,
} from "./state.ts";

export const roleGuide = fileURLToPath(new URL("./ROLES.md", import.meta.url));
export interface SpawnInput {
  assignmentId: string;
  revision: number;
  branch: string;
  path: string;
  workspaceLabel: string;
  workerName: string;
  brief: string;
  checkpoint: string;
  base?: string;
  supervisionId: string;
}
export function coverage(pi: ExtensionAPI, mailbox: string, id: string) {
  const result = inspectMonitor(pi, id, mailboxSupervision({ mailbox }).source);
  const r = result?.receipt;
  need(
    r &&
      result.sourceMatches &&
      r.status === "active" &&
      r.recurring &&
      r.intervalMs &&
      r.deadline > Date.now() &&
      !r.gap &&
      !r.interrupted &&
      !r.outcomeUnknown &&
      r.wakes < r.maxWakes &&
      r.coverage.some(
        (c) =>
          c &&
          typeof c === "object" &&
          !Array.isArray(c) &&
          c.mailbox === mailbox,
      ),
    "Active matching recurring mailbox supervision required; inspect Monitor and retained allowance, do not auto-rearm",
  );
  return r;
}
export async function spawn(
  pi: ExtensionAPI,
  cwd: string,
  index: Index,
  b: Binding,
  input: SpawnInput,
  signal?: AbortSignal,
) {
  need(b.role === "coordinator" && b.active, "Coordinator binding required");
  need(process.env.HERDR_ENV === "1", "Herdr required");
  need(
    /^[a-zA-Z0-9_-]{1,80}$/.test(input.assignmentId) &&
      Number.isSafeInteger(input.revision) &&
      input.revision > 0,
    "Invalid assignment/revision",
  );
  need(
    /^[a-z][a-z0-9_-]{0,31}$/.test(input.workerName),
    "Invalid Herdr worker name",
  );
  absolute(input.path, "worktree path");
  absolute(input.checkpoint, "checkpoint path");
  text(input.brief, "self-contained brief", 16000);
  text(input.workspaceLabel, "workspace label", 100);
  text(input.branch, "branch", 200);
  const rows = assignments(index);
  need(
    !rows.some((r) => r.assignmentId === input.assignmentId),
    "Assignment exists; inspect retained launch, never replay",
  );
  need(inspectMailbox(pi, b.mailbox), "Mailbox unavailable");
  await describeScriptProviders(pi, cwd, ["mailbox"]);
  coverage(pi, b.mailbox, input.supervisionId);
  signal?.throwIfAborted();
  // Resolve once in the CALLER checkout, never the primary checkout or moving tip.
  const base = await host.exec("git", [
    "-C",
    cwd,
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${input.base ?? "HEAD"}^{commit}`,
  ]);
  need(/^[a-f0-9]{40}$/.test(base), "Immutable base unavailable");
  await host.exec("git", [
    "-C",
    cwd,
    "check-ref-format",
    "--branch",
    input.branch,
  ]);
  const dirty = !!(await host.exec("git", [
    "-C",
    cwd,
    "status",
    "--porcelain",
  ]));
  const launchId = input.assignmentId;
  const brief = {
    coordinate: true,
    kind: "implementation",
    repo: b.checkout,
    checkout: input.path,
    base,
    supervisionId: input.supervisionId,
    extensionPaths: [
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      fileURLToPath(new URL("../mailbox/index.ts", import.meta.url)),
    ],
    branch: input.branch,
    workspaceLabel: input.workspaceLabel,
    assignmentId: input.assignmentId,
    revision: input.revision,
    runId: launchId,
    agent: input.workerName,
    task: input.brief,
    acceptance:
      "The self-contained objective above owns the acceptance criteria.",
    constraints:
      "One checkout writer. No nested persistent delegation, uncertain replay, implicit installation, reload, cleanup or unrelated effects. Read Coordinate role guidance. Live qualification requires separate authority.",
    executionAuthority: b.authority,
    publicationAuthority:
      "Only explicit authority in the task brief; enabling Coordinate grants none.",
    launchAuthority: b.authority,
    coordinator: b.sessionId,
    ownerDigest: digest(index.values!["Owner and authority"]),
    mailbox: b.mailbox,
    checkpoint: input.checkpoint,
    reportingInstructions:
      "Checkpoint and retain an immutable artifact before mailbox send (question/blocker/result/resolution). Include reportId, assignmentId, revision, runId, sessionId/incarnation from this index, exact head, checkpoint and reference. Questions add requestId/contextRevision; resolutions retain questionHead/answerReference. Questions use mailbox, not modal UI. Routine progress stays child-owned. No automatic resend. Result requires exact evidence and release/no further writes; ACK is not acceptance.",
    references: [roleGuide],
    bounds: { startMs: 30000, confirmMs: 15000, deadline: Date.now() + 180000 },
  };
  await preflightWorker({ brief, launchId });
  signal?.throwIfAborted();
  rows.push({
    assignmentId: input.assignmentId,
    revision: input.revision,
    runId: launchId,
    launchId,
    launchBrief: brief,
  });
  index = await patch(cwd, index, { Assignments: JSON.stringify(rows) });
  const request = { repo: b.checkout, indexId: index.id, launchId };
  const io = {
    ...host,
    env: { ...process.env, PI_SESSION_ID: b.sessionId },
    async coverageCheck(
      _observation: unknown,
      _brief: unknown,
      worker: Worker,
    ) {
      signal?.throwIfAborted();
      const { binding: child } = await load(input.path, worker.sessionId);
      need(
        child?.active &&
          child.role === "child" &&
          child.parentId === index.id &&
          child.assignmentId === input.assignmentId &&
          child.revision === input.revision &&
          child.mailbox === b.mailbox &&
          child.checkpoint === input.checkpoint,
        "Child binding missing or changed",
      );
      need(
        inspectMailbox(pi, b.mailbox),
        "Mailbox unavailable before submission",
      );
      return coverage(pi, b.mailbox, input.supervisionId);
    },
  };
  const prepared = await launchWorker({ ...request, phase: "prepare" }, io);
  if (prepared.status !== "prepared" || !prepared.worker || !prepared.handoff)
    return {
      ...prepared,
      base,
      worktree: input.path,
      excludedUncommittedChanges: dirty,
    };
  signal?.throwIfAborted();
  const worker = prepared.worker;
  index = await readIndex(cwd, index.id);
  const preparedRows = assignments(index);
  const row = preparedRows.find((r) => r.assignmentId === input.assignmentId)!;
  row.launch!.intent = {
    effect: "binding",
    sessionId: worker.sessionId,
    parentId: index.id,
  };
  index = await patch(cwd, index, {
    Assignments: JSON.stringify(preparedRows),
  });
  // Any failure here retains the prepared worker and binding intent. No replay.
  await bind(input.path, {
    ...b,
    role: "child",
    sessionId: worker.sessionId,
    checkout: input.path,
    parentId: index.id,
    assignmentId: input.assignmentId,
    revision: input.revision,
    brief: prepared.handoff,
    checkpoint: input.checkpoint,
  });
  row.launch!.intent = null;
  row.reporting = {
    mailbox: b.mailbox,
    checkpoint: input.checkpoint,
    coordinator: b.sessionId,
    index: index.path,
    handoff: prepared.handoff,
    member: `${input.assignmentId}/${input.revision}/${worker.sessionId}/${worker.incarnation}`,
  };
  await patch(cwd, index, { Assignments: JSON.stringify(preparedRows) });
  return {
    ...(await launchWorker({ ...request, phase: "submit" }, io)),
    base,
    worktree: input.path,
    excludedUncommittedChanges: dirty,
  };
}
