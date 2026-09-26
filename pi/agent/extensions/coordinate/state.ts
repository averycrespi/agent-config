import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  readIndex,
  persistIndex,
  updateIndex,
  type Index,
} from "../../skills/coordinate-repo/scripts/index.js";

export interface Binding {
  version: 1;
  role: "coordinator" | "child";
  sessionId: string;
  checkout: string;
  common: string;
  active: boolean;
  mailbox: string;
  authority: string;
  parentId?: string;
  assignmentId?: string;
  revision?: number;
  brief?: string;
  checkpoint?: string;
}
export interface Worker {
  sessionId: string;
  incarnation: string;
  pane: string;
  workspace: string;
  terminal: string;
  transcript: string;
}
export interface Assignment {
  assignmentId: string;
  revision: number;
  runId: string;
  launchId: string;
  launchBrief: Record<string, unknown>;
  launch?: {
    status: string;
    intent?: unknown;
    worker?: Worker;
    handoff?: string;
    resources?: unknown;
    execution?: unknown;
    next?: string;
  };
  reporting?: Record<string, unknown>;
  acceptance?: {
    head: string;
    resultRevision: string;
    evidence: string;
    release: string;
    furtherWrites: false;
  };
  reported?: { disposition: string; reference: string };
}
export function need(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function text(
  value: unknown,
  label: string,
  max = 4096,
): asserts value is string {
  need(
    typeof value === "string" &&
      value.trim() &&
      value.length <= max &&
      !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value),
    `Invalid ${label}`,
  );
}
export function sessionKey(sessionId: string) {
  need(
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(sessionId),
    "Invalid session identity",
  );
  return `coordinate-${sessionId}`;
}
export function repository(cwd: string) {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  return {
    checkout: git("rev-parse", "--show-toplevel"),
    common: git("rev-parse", "--path-format=absolute", "--git-common-dir"),
  };
}
export async function load(cwd: string, sessionId: string) {
  let repo: ReturnType<typeof repository>;
  try {
    repo = repository(cwd);
  } catch {
    return {
      index: {
        id: sessionKey(sessionId),
        path: "",
        text: null,
        values: null,
        digest: null,
      } as Index,
      binding: undefined,
    };
  }
  const index = await readIndex(cwd, sessionKey(sessionId));
  if (!index.values) return { index, binding: undefined };
  const b = JSON.parse(index.values["Owner and authority"]) as Binding;
  need(
    b.version === 1 &&
      b.sessionId === sessionId &&
      ["coordinator", "child"].includes(b.role) &&
      typeof b.active === "boolean",
    "Invalid binding; reconcile without adoption",
  );
  need(
    (await realpath(repo.checkout)) === b.checkout &&
      (await realpath(repo.common)) === b.common,
    "Binding checkout/common-directory mismatch",
  );
  need(
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(b.mailbox),
    "Invalid bound mailbox",
  );
  text(b.authority, "bound authority");
  if (b.role === "child") {
    need(
      typeof b.parentId === "string" &&
        /^coordinate-[a-f0-9-]{36}$/.test(b.parentId) &&
        b.parentId !== index.id,
      "Invalid parent binding",
    );
    text(b.assignmentId, "bound assignment", 80);
    need(
      Number.isSafeInteger(b.revision) && b.revision! > 0,
      "Invalid bound revision",
    );
    absolute(b.brief, "bound brief");
    absolute(b.checkpoint, "bound checkpoint");
  }
  return { index, binding: b };
}
export function assignments(index: Index): Assignment[] {
  const rows: Assignment[] = JSON.parse(index.values?.Assignments ?? "[]");
  need(
    Array.isArray(rows),
    "Invalid assignment inventory; inspect retained index",
  );
  const ids = new Set();
  for (const r of rows) {
    need(
      r &&
        typeof r.assignmentId === "string" &&
        !ids.has(r.assignmentId) &&
        Number.isSafeInteger(r.revision) &&
        r.revision > 0 &&
        r.launchBrief,
      "Invalid assignment identity",
    );
    ids.add(r.assignmentId);
  }
  return rows;
}
export async function patch(
  cwd: string,
  index: Index,
  changes: Record<string, string | null>,
) {
  await updateIndex({
    cwd,
    id: index.id,
    expected: index.digest,
    changes,
    attemptId: randomUUID(),
  });
  return readIndex(cwd, index.id);
}
export async function bind(cwd: string, binding: Binding) {
  const existing = await readIndex(cwd, sessionKey(binding.sessionId));
  need(
    !existing.values,
    "Session already bound; no automatic adoption or replacement",
  );
  return persistIndex({
    cwd,
    id: existing.id,
    expected: null,
    attemptId: randomUUID(),
    values: {
      "Owner and authority": JSON.stringify(binding),
      ...(binding.role === "coordinator"
        ? {
            Assignments: "[]",
            Mailbox: JSON.stringify({
              address: binding.mailbox,
              reports: {},
              questions: {},
            }),
            Observation: "{}",
          }
        : {}),
      Next:
        binding.role === "coordinator"
          ? "Coordinator: record authority and finite supervision before spawn"
          : "Worker: read brief, own checkpoint and report through mailbox",
    },
  });
}
export function absolute(
  value: unknown,
  label: string,
): asserts value is string {
  text(value, label, 1024);
  need(
    value.startsWith("/") && resolve(value) === value && !/[\r\n]/.test(value),
    `Invalid absolute ${label}`,
  );
}
export function obligations(index: Index) {
  const box = JSON.parse(index.values?.Mailbox ?? "{}");
  const questions = Object.values(box.questions ?? {}).filter(
    (q) => (q as { status?: string }).status !== "resolved",
  );
  return {
    assignments: assignments(index)
      .filter((r) => !r.acceptance || r.launch?.intent)
      .map((r) => r.assignmentId),
    questions: questions.length,
    control: index.values?.["Unresolved control"] ?? null,
  };
}
export async function complete(
  cwd: string,
  index: Index,
  input: {
    assignmentId: string;
    revision: number;
    head: string;
    resultRevision: string;
    evidence: string;
    release: string;
    furtherWrites: boolean;
  },
) {
  const rows = assignments(index);
  const row = rows.find(
    (r) =>
      r.assignmentId === input.assignmentId && r.revision === input.revision,
  );
  need(
    row && row.launch?.status === "execution-confirmed" && !row.launch.intent,
    "Exact launched assignment required; reconcile pending effects",
  );
  need(
    /^[a-f0-9]{40}$/.test(input.head) && input.furtherWrites === false,
    "Exact result head and explicit no-further-writes required",
  );
  for (const key of ["resultRevision", "evidence", "release"] as const)
    text(input[key], key);
  const questions = Object.values(
    JSON.parse(index.values?.Mailbox ?? "{}").questions ?? {},
  ) as Array<{ assignmentId?: string; status?: string }>;
  need(
    !questions.some(
      (q) => q.assignmentId === input.assignmentId && q.status !== "resolved",
    ) && !index.values?.["Unresolved control"],
    "Reconcile unresolved questions/control before acceptance",
  );
  const accepted = {
    head: input.head,
    resultRevision: input.resultRevision,
    evidence: input.evidence,
    release: input.release,
    furtherWrites: false as const,
  };
  need(
    !row.acceptance ||
      JSON.stringify(row.acceptance) === JSON.stringify(accepted),
    "Existing acceptance differs; reconcile, never overwrite",
  );
  if (row.acceptance) return index;
  row.acceptance = accepted;
  return patch(cwd, index, { Assignments: JSON.stringify(rows) });
}
