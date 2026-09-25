import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { snapshotScriptJson } from "../script/api.ts";
import type { Execution } from "./api.ts";

export const LIMITS = Object.freeze({
  active: 8,
  retained: 256, // reserve a completion slot for every active admission
  notifications: 64,
  resultBytes: 64000,
  storeBytes: 20000000,
});
export const STORE_SUFFIX = ".background-executions-v1.json";
const uuid = (s: unknown) => typeof s === "string" && /^[a-f0-9-]{36}$/.test(s);
export function validate(records: unknown): Execution[] {
  const copied = JSON.parse(snapshotScriptJson(records, LIMITS.storeBytes));
  if (!Array.isArray(copied) || copied.length > LIMITS.retained)
    throw new Error("background_storage_invalid");
  const ids = new Set<string>();
  for (const r of copied) {
    if (
      !r ||
      !uuid(r.id) ||
      ids.has(r.id) ||
      typeof r.owner !== "string" ||
      !/^[a-z][a-z0-9_-]{0,47}$/.test(r.owner) ||
      Object.keys(r).some(
        (k) =>
          ![
            "id",
            "owner",
            "label",
            "anchor",
            "createdAt",
            "deadlineMs",
            "status",
            "endedAt",
            "cancelRequested",
            "dismissed",
            "effectsMayPersist",
            "outcomeUnknown",
            "result",
            "notification",
            "persistenceFailed",
            "progress",
            "activity",
          ].includes(k),
      ) ||
      typeof r.label !== "string" ||
      r.label.length > 200 ||
      typeof r.anchor !== "string" ||
      !r.anchor ||
      !Number.isSafeInteger(r.createdAt) ||
      !Number.isSafeInteger(r.deadlineMs) ||
      r.deadlineMs <= r.createdAt ||
      ![
        "running",
        "success",
        "failed",
        "cancelled",
        "timeout",
        "interrupted",
      ].includes(r.status) ||
      ![
        r.cancelRequested,
        r.dismissed,
        r.effectsMayPersist,
        r.outcomeUnknown,
      ].every((v) => typeof v === "boolean") ||
      !r.notification ||
      Object.keys(r.notification).sort().join() !==
        "consumed,handoff,id,intent" ||
      (r.status === "running" &&
        (r.notification.intent || r.dismissed || r.endedAt !== undefined)) ||
      (r.status !== "running" && !r.notification.intent) ||
      (r.notification.consumed && r.notification.handoff === "none") ||
      !uuid(r.notification.id) ||
      ![r.notification.intent, r.notification.consumed].every(
        (v) => typeof v === "boolean",
      ) ||
      !["none", "unknown", "handed_to_pi"].includes(r.notification.handoff) ||
      (r.status !== "running" &&
        (!Number.isSafeInteger(r.endedAt) || r.endedAt < r.createdAt))
    )
      throw new Error("background_storage_invalid");
    if (r.progress !== undefined) validateProgress(r.progress);
    if (r.activity !== undefined) validateActivity(r.activity);
    if (r.result !== undefined)
      snapshotScriptJson(r.result, LIMITS.resultBytes);
    ids.add(r.id);
  }
  return copied;
}
export function validateProgress(value: unknown): void {
  const p = value as { completed?: number; total?: number; failed?: number };
  if (
    !p ||
    Object.keys(p).sort().join() !== "completed,failed,total" ||
    ![p.completed, p.total, p.failed].every(Number.isSafeInteger) ||
    p.total! < 1 ||
    p.completed! < 0 ||
    p.completed! > p.total! ||
    p.failed! < 0 ||
    p.failed! > p.completed!
  )
    throw new Error("background_invalid_progress");
}
export function validateActivity(value: unknown): void {
  const a = value as {
    started?: number;
    completed?: number;
    failed?: number;
    phase?: string;
    profile?: string;
    queued?: number;
    canceled?: number;
    totalTokens?: number;
  };
  if (
    !a ||
    Object.keys(a).some(
      (k) =>
        ![
          "started",
          "completed",
          "failed",
          "phase",
          "profile",
          "queued",
          "canceled",
          "totalTokens",
        ].includes(k),
    ) ||
    ![a.started, a.completed, a.failed].every(Number.isSafeInteger) ||
    a.started! < 0 ||
    a.completed! < 0 ||
    a.failed! < 0 ||
    a.completed! > a.started! ||
    a.failed! > a.completed! ||
    [a.queued, a.canceled, a.totalTokens].some(
      (v) => v !== undefined && (!Number.isSafeInteger(v) || v < 0),
    ) ||
    (a.queued ?? 0) > a.started! - a.completed! ||
    (a.canceled ?? 0) > a.failed! ||
    (a.phase !== undefined &&
      (typeof a.phase !== "string" || a.phase.length > 200)) ||
    (a.profile !== undefined &&
      (typeof a.profile !== "string" || a.profile.length > 40))
  )
    throw new Error("background_invalid_activity");
}
export interface Store {
  read(): Execution[];
  write(records: Execution[]): void;
}
/** Atomic bounded sidecar, distinct from every historical observer receipt. */
export function fileStore(sessionFile: string): Store {
  const path = sessionFile + STORE_SUFFIX;
  const directory = dirname(path);
  const safe = (target: string, directory = false) => {
    const s = lstatSync(target);
    if (
      s.isSymbolicLink() ||
      (directory ? !s.isDirectory() : !s.isFile()) ||
      (process.getuid && s.uid !== process.getuid())
    )
      throw new Error("background_storage_unsafe");
    return s;
  };
  safe(directory, true);
  return {
    read() {
      if (!existsSync(path)) return [];
      if (safe(path).size > LIMITS.storeBytes)
        throw new Error("background_storage_invalid");
      const data = JSON.parse(readFileSync(path, "utf8"));
      if (data.version !== 1) throw new Error("background_storage_invalid");
      return validate(data.records);
    },
    write(records) {
      const data = JSON.stringify({ version: 1, records: validate(records) });
      if (Buffer.byteLength(data) > LIMITS.storeBytes)
        throw new Error("background_storage_full");
      safe(directory, true);
      if (existsSync(path)) safe(path);
      const staging = `${path}.${randomUUID()}.tmp`;
      const fd = openSync(
        staging,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(fd, data);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(staging, path);
      const parent = openSync(directory, constants.O_RDONLY);
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
    },
  };
}
