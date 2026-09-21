#!/usr/bin/env node
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  lstat,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

const need = (ok, message) => {
  if (!ok) throw new Error(message);
};
const id = (s) =>
  typeof s === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(s);
const number = (n) => Number.isSafeInteger(n) && n >= 0;
const text = (s) => typeof s === "string" && s.trim() && s.length <= 2000;

export function allowance(s, now = Date.now()) {
  return {
    deadline: s.deadline,
    remainingMs:
      s.deadline === null ? s.durationMs : Math.max(0, s.deadline - now),
    wakesRemaining: Math.max(
      0,
      s.wakeLimit - s.attempts.filter((a) => !a.unused).length,
    ),
    watcher: s.watcher,
    unresolved: s.attempts.filter((a) => a.uncertain).map((a) => a.id),
  };
}
function validate(s) {
  need(
    s?.schemaVersion === 1 &&
      id(s.owner) &&
      id(s.stackId) &&
      id(s.childId) &&
      id(s.incarnation),
    "invalid observation identity",
  );
  need(
    number(s.durationMs) &&
      s.durationMs >= 1000 &&
      number(s.wakeLimit) &&
      s.wakeLimit > 0 &&
      (s.deadline === null || number(s.deadline)) &&
      (s.initialDeadline === null ||
        (number(s.initialDeadline) && s.initialDeadline <= s.deadline)) &&
      Array.isArray(s.attempts) &&
      s.attempts.length <= 1000 &&
      new Set(s.attempts.map((a) => a.id)).size === s.attempts.length &&
      s.attempts.every(
        (a) =>
          id(a.id) &&
          typeof a.unused === "boolean" &&
          typeof a.uncertain === "boolean" &&
          !(a.unused && a.uncertain),
      ) &&
      (s.watcher === null || s.attempts.some((a) => a.id === s.watcher.id)),
    "invalid observation allowance",
  );
  need(
    text(s.authority) &&
      Array.isArray(s.receiptRefs) &&
      s.receiptRefs.every(text) &&
      Array.isArray(s.additions) &&
      s.additions.every(
        (a) =>
          id(a.id) &&
          text(a.authority) &&
          text(a.reference) &&
          number(a.additionalMs) &&
          number(a.additionalWakes),
      ),
    "invalid observation evidence",
  );
  if (s.watcher !== null)
    need(
      number(s.watcher.preparedAt) &&
        number(s.watcher.cycleMs) &&
        s.watcher.cycleMs >= 1000 &&
        number(s.watcher.lifetimeMs) &&
        s.watcher.lifetimeMs >= s.watcher.cycleMs &&
        (s.watcher.jobId === null || id(s.watcher.jobId)),
      "invalid observation reservation",
    );
}

// Accounting only: never launch, prompt, qualify delivery, or change a child checkpoint.
export function updateObservation(previous, r, now = Date.now()) {
  need(number(now), "invalid host clock");
  if (previous) validate(previous);
  let s = previous ? structuredClone(previous) : null;
  if (!s) {
    need(
      r.action === "init" && text(r.authority),
      "initialize with actual parent observation authority",
    );
    s = {
      schemaVersion: 1,
      owner: r.owner,
      stackId: r.stackId,
      childId: r.childId,
      incarnation: r.incarnation,
      authority: r.authority,
      durationMs: r.durationMs ?? 7200000,
      wakeLimit: r.wakeLimit ?? 30,
      deadline: null,
      initialDeadline: null,
      attempts: [],
      watcher: null,
      receiptRefs: [],
      additions: [],
    };
    if (r.recovery) {
      need(
        text(r.recovery.reference) &&
          r.recovery.inactive === true &&
          number(r.recovery.deadline) &&
          number(r.recovery.initialDeadline),
        "legacy recovery requires retained evidence and inactive observer",
      );
      s.deadline = r.recovery.deadline;
      s.initialDeadline = r.recovery.initialDeadline;
      s.attempts = structuredClone(r.recovery.attempts);
      s.receiptRefs.push(r.recovery.reference);
    }
  } else {
    if (r.action === "claim") {
      need(
        s.owner === r.previousOwner &&
          s.incarnation === r.previousIncarnation &&
          s.stackId === r.stackId &&
          s.childId === r.childId &&
          (!s.watcher || r.incarnation === s.incarnation) &&
          text(r.authority) &&
          text(r.reference),
        "explicit reconciled parent ownership transfer required",
      );
      s.owner = r.owner;
      s.incarnation = r.incarnation;
      s.receiptRefs.push(`Ownership: ${r.authority}; ${r.reference}`);
      validate(s);
      return s;
    }
    need(
      s.owner === r.owner &&
        s.stackId === r.stackId &&
        s.childId === r.childId &&
        s.incarnation === r.incarnation,
      "parent/child/incarnation mismatch; reconcile original owner before transfer",
    );
    const a = allowance(s, now);
    switch (r.action) {
      case "prepare": {
        need(
          !s.watcher && !a.unresolved.length,
          "reconcile registration and uncertain handoff before replacement",
        );
        need(
          a.remainingMs >= 1000 && a.wakesRemaining > 0,
          "parent observation allowance exhausted; child authority is unchanged",
        );
        const attempt = { id: randomUUID(), unused: false, uncertain: true };
        s.attempts.push(attempt);
        s.watcher = {
          id: attempt.id,
          jobId: null,
          preparedAt: now,
          cycleMs: Math.min(1500000, a.remainingMs),
          lifetimeMs: a.remainingMs,
          deadline: s.deadline,
        };
        break;
      }
      case "attach": {
        const w = s.watcher,
          receipt = r.receipt;
        need(
          w &&
            receipt &&
            id(receipt.id) &&
            receipt.recurring === false &&
            receipt.maxWakes === 1 &&
            receipt.cycleMs === w.cycleMs &&
            number(receipt.createdAt) &&
            receipt.createdAt >= w.preparedAt &&
            receipt.createdAt <= now &&
            number(receipt.deadline) &&
            receipt.deadline > receipt.createdAt &&
            receipt.deadline - receipt.createdAt <= w.lifetimeMs &&
            (s.deadline === null || receipt.deadline <= s.deadline) &&
            (!w.jobId || w.jobId === receipt.id) &&
            text(r.reference),
          "registration receipt/bounds mismatch",
        );
        s.deadline ??= receipt.createdAt + s.durationMs;
        s.initialDeadline ??= s.deadline;
        w.jobId = receipt.id;
        w.createdAt = receipt.createdAt;
        w.hostDeadline = receipt.deadline;
        s.receiptRefs = [...new Set([...s.receiptRefs, r.reference])];
        break;
      }
      case "reconcile": {
        const receipt = r.receipt;
        const w = s.watcher ?? s.lastWatcher;
        need(
          w?.jobId &&
            receipt?.id === w.jobId &&
            receipt.createdAt === w.createdAt &&
            receipt.deadline === w.hostDeadline &&
            ["finished", "cancelled", "invalidated"].includes(receipt.status) &&
            receipt.recurring === false &&
            receipt.maxWakes === 1 &&
            receipt.cycleMs === w.cycleMs &&
            number(receipt.wakes) &&
            receipt.wakes <= 1 &&
            text(r.reference),
          "terminal host receipt identity mismatch",
        );
        const attention = receipt.attention ?? receipt.lastAttention;
        const attempt = s.attempts.find((x) => x.id === w.id);
        attempt.uncertain =
          receipt.inFlight !== false ||
          receipt.outcomeUnknown !== false ||
          ["pending", "handoff_unknown"].includes(attention?.disposition);
        attempt.unused =
          receipt.wakes === 0 &&
          !attempt.uncertain &&
          (!attention || attention.disposition === "suppressed");
        s.lastWatcher = w;
        s.watcher = null;
        s.receiptRefs = [...new Set([...s.receiptRefs, r.reference])];
        break;
      }
      case "recover": {
        need(
          s.watcher && r.inactive === true && text(r.reference),
          "concrete original registration inactivity evidence required",
        );
        // An unavailable first registration cannot establish a new two-hour clock.
        s.deadline ??= s.watcher.preparedAt + s.durationMs;
        s.initialDeadline ??= s.deadline;
        s.lastWatcher = s.watcher;
        s.watcher = null;
        s.receiptRefs.push(r.reference);
        break;
      }
      case "resolve": {
        const attempt = s.attempts.find((x) => x.id === r.attemptId);
        need(
          attempt && !s.watcher && text(r.reference),
          "explicit uncertainty reconciliation required",
        );
        attempt.uncertain = false; // Reservation remains charged; never replay/refund an unknown handoff.
        s.receiptRefs.push(r.reference);
        break;
      }
      case "extend": {
        need(
          !s.watcher &&
            !a.unresolved.length &&
            id(r.id) &&
            text(r.authority) &&
            text(r.reference) &&
            number(r.additionalMs ?? 0) &&
            number(r.additionalWakes ?? 0) &&
            (r.additionalMs > 0 || r.additionalWakes > 0),
          "explicit additive authority and reconciled observer required",
        );
        const addition = {
          id: r.id,
          authority: r.authority,
          reference: r.reference,
          additionalMs: r.additionalMs ?? 0,
          additionalWakes: r.additionalWakes ?? 0,
        };
        const prior = s.additions.find((x) => x.id === r.id);
        if (prior)
          need(
            JSON.stringify(prior) === JSON.stringify(addition),
            "conflicting allowance addition",
          );
        else {
          if (s.deadline !== null) s.deadline += addition.additionalMs;
          s.durationMs += addition.additionalMs;
          s.wakeLimit += addition.additionalWakes;
          s.additions.push(addition);
        }
        break;
      }
      default:
        throw new Error("unknown observation accounting action");
    }
  }
  validate(s);
  return s;
}

export async function observationState(r) {
  need(
    isAbsolute(r.cwd) && id(r.stackId) && id(r.childId),
    "absolute cwd and exact stack/child IDs required",
  );
  const common = await realpath(
    resolve(
      r.cwd,
      execFileSync("git", ["-C", r.cwd, "rev-parse", "--git-common-dir"], {
        encoding: "utf8",
      }).trim(),
    ),
  );
  const dir = join(common, "pi-stack-checkpoints");
  await mkdir(dir, { mode: 0o700 }).catch((e) => {
    if (e.code !== "EEXIST") throw e;
  });
  need(
    (await realpath(dir)) === dir && (await lstat(dir)).isDirectory(),
    "unsafe stack accounting directory",
  );
  const file = join(dir, `${r.stackId}-${r.childId}.observation.json`);
  const lock = `${file}.lock`;
  await mkdir(lock, { mode: 0o700 });
  try {
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, owner: r.owner }),
      { flag: "wx", mode: 0o600 },
    );
    let previous = null;
    try {
      const stat = await lstat(file);
      need(
        stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536,
        "unsafe observation record",
      );
      previous = JSON.parse(await readFile(file, "utf8"));
      validate(previous);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (r.action === "status")
      return previous
        ? { file, state: previous, allowance: allowance(previous) }
        : { missing: true };
    need(
      r.action !== "init" || !previous,
      "observation record exists; reconcile rather than reinitialize",
    );
    let request = r;
    if (r.receiptArtifact) {
      const { path, sha256 } = r.receiptArtifact;
      const root = join(common, "pi-delivery-artifacts", "background");
      need(
        /^[a-f0-9]{64}$/.test(sha256) &&
          path === join(root, `${sha256}.json`) &&
          (await realpath(root)) === root,
        "invalid receipt artifact path",
      );
      const stat = await lstat(path);
      need(
        stat.isFile() && !stat.isSymbolicLink() && stat.size <= 4 * 1024 * 1024,
        "invalid receipt artifact",
      );
      const bytes = await readFile(path);
      need(
        createHash("sha256").update(bytes).digest("hex") === sha256,
        "receipt digest mismatch",
      );
      request = {
        ...r,
        receipt: JSON.parse(bytes).receipt,
        reference: `${path} sha256 ${sha256}`,
      };
    }
    const next = updateObservation(previous, request);
    const bytes = JSON.stringify(next, null, 2) + "\n";
    need(Buffer.byteLength(bytes) <= 65536, "observation ledger exceeds bound");
    const staging = `${file}.${randomUUID()}.tmp`;
    await writeFile(staging, bytes, { flag: "wx", mode: 0o600 });
    await rename(staging, file);
    return { file, allowance: allowance(next) };
  } finally {
    await rm(lock, { recursive: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let input = "";
  try {
    for await (const chunk of process.stdin) {
      input += chunk;
      need(Buffer.byteLength(input) <= 65536, "request too large");
    }
    console.log(
      JSON.stringify({ result: await observationState(JSON.parse(input)) }),
    );
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exitCode = 1;
  }
}
