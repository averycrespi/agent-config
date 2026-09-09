#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  updateMonitor,
  validateMonitor,
  remainingWaitMs,
} from "./ci-monitor.js";

const LIMIT = 64 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
const FIELDS = [
  "scope",
  "authorization",
  "plan",
  "progress",
  "blocker",
  "next",
  "evidenceRefs",
  "findingRefs",
  "pr",
];
function need(ok, message) {
  if (!ok) throw new Error(message);
}
function text(s, label, max = 4000) {
  need(
    typeof s === "string" &&
      s.trim() &&
      s.length <= max &&
      !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s),
    `invalid ${label}`,
  );
  return s;
}
function id(s) {
  need(typeof s === "string" && ID.test(s), "invalid owner/action ID");
  return s;
}
function integer(n) {
  need(Number.isSafeInteger(n) && n >= 0, "invalid nonnegative counter");
  return n;
}
function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: LIMIT,
  }).trim();
}
async function exists(p) {
  try {
    await lstat(p);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function directory(p, create = false) {
  if (create)
    await mkdir(p, { mode: 0o700 }).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
  const s = await lstat(p);
  need(
    s.isDirectory() && !s.isSymbolicLink() && (await realpath(p)) === p,
    "checkpoint directory must be real, not a symlink",
  );
}
async function jsonFile(p) {
  const s = await lstat(p);
  need(
    s.isFile() && !s.isSymbolicLink() && s.size <= LIMIT,
    "checkpoint must be a bounded regular file",
  );
  return JSON.parse(await readFile(p, "utf8"));
}
function validate(s) {
  need(
    s?.schemaVersion === 2 && UUID.test(s.ticketId),
    "invalid checkpoint schema/identity",
  );
  integer(s.revision);
  id(s.owner);
  need(
    isAbsolute(s.checkout) && typeof s.released === "boolean",
    "invalid checkout ownership",
  );
  text(s.branch, "branch");
  for (const key of ["scope", "authorization", "plan", "progress"])
    text(s[key], key);
  if (s.blocker !== null) text(s.blocker, "blocker");
  text(s.next?.actor, "next actor", 200);
  text(s.next?.action, "next action");
  for (const key of ["evidenceRefs", "findingRefs"]) {
    need(Array.isArray(s[key]), `invalid ${key}`);
    s[key].forEach((x) => text(x, key, 2000));
  }
  if (s.pr !== null) text(s.pr, "PR reference", 2000);
  need(Array.isArray(s.overrides), "invalid overrides");
  for (const o of s.overrides) {
    id(o.id);
    for (const k of [
      "requirement",
      "scope",
      "action",
      "instruction",
      "reference",
    ])
      text(o[k], k);
  }
  for (const kind of ["review", "ci"]) {
    const b = s.repairs?.[kind];
    integer(b?.limit);
    need(
      Array.isArray(b.batches) && b.batches.length <= b.limit,
      "invalid repair allowance",
    );
    b.batches.forEach((x) => {
      id(x.id);
      text(x.plan, "repair plan");
    });
    need(
      new Set(b.batches.map((x) => x.id)).size === b.batches.length &&
        (b.active === null || b.batches.some((x) => x.id === b.active)),
      "invalid repair identity",
    );
  }
  for (const e of [s.pendingEffect, s.lastEffect])
    if (e !== null) {
      id(e?.id);
      text(e.target, "external target");
      text(e === s.pendingEffect ? e.intent : e.reference, "external evidence");
    }
  if (s.monitor !== null) validateMonitor(s.monitor);
  integer(s.recoveredWaitingMs);
}
function checkpoint(s, patch) {
  need(
    patch && typeof patch === "object" && !Array.isArray(patch),
    "checkpoint patch required",
  );
  for (const [key, value] of Object.entries(patch)) {
    need(FIELDS.includes(key), `checkpoint cannot change ${key}`);
    if (["evidenceRefs", "findingRefs"].includes(key)) {
      need(Array.isArray(value), `invalid ${key}`);
      s[key] = [...new Set([...s[key], ...value])];
    } else s[key] = value;
  }
}
function apply(s, r) {
  switch (r.action) {
    case "checkpoint":
      checkpoint(s, r.patch);
      break;
    case "release":
      s.released = true;
      break;
    case "repair": {
      need(
        ["review", "ci"].includes(r.kind),
        "repair kind must be review or ci",
      );
      const b = s.repairs[r.kind];
      id(r.id);
      if (r.operation === "begin") {
        text(r.plan, "repair plan");
        const prior = b.batches.find((x) => x.id === r.id);
        if (prior) {
          need(prior.plan === r.plan, "repair ID conflicts with prior plan");
          break;
        }
        need(b.active === null, "finish or resume the active repair batch");
        need(
          b.batches.length < b.limit,
          "repair allowance exhausted; record an explicit user override with an additive allowance",
        );
        b.batches.push({ id: r.id, plan: r.plan });
        b.active = r.id;
      } else {
        need(
          r.operation === "finish" && b.active === r.id,
          "repair batch is not active",
        );
        b.active = null;
      }
      break;
    }
    case "override": {
      const o = r.override;
      need(o && typeof o === "object", "scoped user override required");
      need(
        Object.keys(o).every((k) =>
          [
            "id",
            "requirement",
            "scope",
            "action",
            "instruction",
            "reference",
            "budget",
            "additional",
          ].includes(k),
        ),
        "unknown override field",
      );
      id(o.id);
      for (const k of [
        "requirement",
        "scope",
        "action",
        "instruction",
        "reference",
      ])
        text(o[k], k);
      const prior = s.overrides.find((x) => x.id === o.id);
      if (prior) {
        need(
          JSON.stringify(prior) === JSON.stringify(o),
          "override ID conflicts with prior instruction",
        );
        break;
      }
      if (o.budget !== undefined) {
        need(
          ["review", "ci", "wait"].includes(o.budget) &&
            integer(o.additional) > 0,
          "override requires a positive allowance addition",
        );
        if (o.budget === "wait") {
          need(s.monitor, "start monitoring before extending its allowance");
          s.monitor = updateMonitor(s.monitor, {
            operation: "extend",
            additionalMs: o.additional,
          });
        } else s.repairs[o.budget].limit += o.additional;
      } else
        need(o.additional === undefined, "allowance addition needs a budget");
      s.overrides.push(structuredClone(o));
      break;
    }
    case "external": {
      id(r.id);
      if (r.operation === "begin") {
        const effect = {
          id: r.id,
          target: text(r.target, "external target"),
          intent: text(r.intent, "external intent"),
        };
        need(
          s.lastEffect?.id !== r.id,
          "effect already confirmed; reread authoritative surface",
        );
        need(
          !s.pendingEffect ||
            JSON.stringify(s.pendingEffect) === JSON.stringify(effect),
          "reconcile pending effect before another external action",
        );
        s.pendingEffect = effect;
      } else {
        need(r.operation === "confirm", "unknown external operation");
        text(r.reference, "external observation");
        if (!s.pendingEffect && s.lastEffect?.id === r.id) break;
        need(
          s.pendingEffect?.id === r.id,
          "pending external identity mismatch",
        );
        s.lastEffect = {
          id: r.id,
          target: s.pendingEffect.target,
          reference: r.reference,
        };
        s.pendingEffect = null;
      }
      break;
    }
    case "ci":
      need(
        r.operation !== "extend",
        "use a scoped user override to extend CI waiting",
      );
      s.monitor = updateMonitor(s.monitor, {
        ...r,
        waitUsedMs: s.recoveredWaitingMs,
      });
      break;
    default:
      throw new Error(
        "unknown action; read work-ticket/references/helper.md for the checkpoint interface (legacy delivery gates are retired)",
      );
  }
}

export async function ticketState(r) {
  need(
    r && typeof r === "object" && !Array.isArray(r),
    "JSON request object required",
  );
  need(
    typeof r.cwd === "string" && isAbsolute(r.cwd) && UUID.test(r.ticketId),
    "absolute repository cwd and immutable Plane ticket UUID required",
  );
  const root = await realpath(r.cwd);
  need(
    (await realpath(git(root, "rev-parse", "--show-toplevel"))) === root,
    "cwd must be a repository root",
  );
  const common = await realpath(
    resolve(root, git(root, "rev-parse", "--git-common-dir")),
  );
  const store = join(common, "pi-ticket-checkpoints");
  const file = join(store, `${r.ticketId}.json`);
  const legacy = join(root, ".pi", "tickets", r.ticketId, "state.json");
  if (r.action === "status" && !(await exists(store)))
    return { missing: true, legacy: (await exists(legacy)) ? legacy : null };
  await directory(store, r.action !== "status");
  if (r.action === "status") {
    if (!(await exists(file)))
      return { missing: true, legacy: (await exists(legacy)) ? legacy : null };
    const s = await jsonFile(file);
    validate(s);
    need(s.ticketId === r.ticketId, "ticket identity mismatch");
    return s;
  }
  id(r.owner);
  const lock = join(store, ".writer.lock");
  await mkdir(lock, { mode: 0o700 }).catch((e) => {
    if (e.code === "EEXIST")
      throw new Error(
        `checkpoint writer lock exists: ${lock}; inspect process before removing this lock only`,
      );
    throw e;
  });
  try {
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, owner: r.owner }),
      { flag: "wx", mode: 0o600 },
    );
    let s;
    if (r.action === "init") {
      need(
        !(await exists(file)),
        "checkpoint exists; read status, do not initialize again",
      );
      let recovered = 0;
      if (await exists(join(root, ".pi", "tickets"))) {
        await directory(join(root, ".pi"));
        await directory(join(root, ".pi", "tickets"));
        if ((await readdir(join(root, ".pi", "tickets"))).length)
          need(
            r.recovery,
            "legacy state exists; explicit recovery of prior writers and allowances is required",
          );
      }
      if (await exists(legacy)) {
        await directory(join(root, ".pi", "tickets", r.ticketId));
        const oldStat = await lstat(legacy);
        need(
          oldStat.isFile() &&
            !oldStat.isSymbolicLink() &&
            oldStat.size <= 256 * 1024,
          "legacy state must be a bounded regular file",
        );
        const old = JSON.parse(await readFile(legacy, "utf8"));
        need(old.ticketId === r.ticketId, "legacy ticket identity mismatch");
        need(
          r.recovery,
          "legacy state exists; explicit recovery with retained allowances and pending effects is required",
        );
        recovered = integer(old.repairCount);
      }
      const recovery = r.recovery;
      if (recovery) {
        text(recovery.reference, "retained recovery evidence");
        text(recovery.instruction, "recovery authority");
        need(
          integer(recovery.reviewUsed) >= recovered,
          "recovery cannot refund review repairs",
        );
        integer(recovery.ciUsed);
        integer(recovery.waitingMs);
        need(
          recovery.reviewUsed <= 1000 && recovery.ciUsed <= 1000,
          "recovery counters exceed compact checkpoint capacity",
        );
        need(
          recovery.effectsReconciled === true,
          "reconcile all legacy pending effects before checkpoint adoption",
        );
      }
      const repairs = Object.fromEntries(
        ["review", "ci"].map((kind) => {
          const used = recovery?.[`${kind}Used`] ?? 0;
          const retained = recovery?.repairs?.[kind];
          if (retained !== undefined)
            need(
              Array.isArray(retained?.batches) &&
                retained.batches.length === used,
              "retained repair count must match consumed allowance",
            );
          return [
            kind,
            {
              limit: Math.max(2, used),
              active: retained === undefined ? null : retained.active,
              batches:
                retained === undefined
                  ? Array.from({ length: used }, (_, i) => ({
                      id: `retained-${i + 1}`,
                      plan: recovery.reference,
                    }))
                  : structuredClone(retained.batches),
            },
          ];
        }),
      );
      s = {
        schemaVersion: 2,
        revision: 0,
        ticketId: r.ticketId,
        owner: r.owner,
        checkout: root,
        branch: git(root, "symbolic-ref", "--short", "HEAD"),
        released: false,
        scope: "",
        authorization: "",
        plan: "",
        progress: "Checkpoint initialized",
        blocker: null,
        next: null,
        evidenceRefs: recovery ? [recovery.reference] : [],
        findingRefs: [],
        pr: null,
        repairs,
        overrides: [],
        pendingEffect: null,
        lastEffect: null,
        monitor: null,
        recoveredWaitingMs: recovery?.waitingMs ?? 0,
      };
      checkpoint(s, r.patch);
    } else {
      s = await jsonFile(file);
      validate(s);
      need(s.ticketId === r.ticketId, "ticket identity mismatch");
      if (r.action === "claim") {
        need(r.previousOwner === s.owner, "previous owner mismatch");
        text(r.instruction, "ownership transfer instruction");
        text(r.evidence, "released/absent prior writer evidence");
        if (root !== s.checkout)
          need(
            r.previousCheckout === s.checkout,
            "explicit previous checkout required for relocation",
          );
        s.owner = r.owner;
        s.released = false;
        s.checkout = root;
        s.branch = git(root, "symbolic-ref", "--short", "HEAD");
        s.evidenceRefs.push(`Ownership: ${r.instruction}; ${r.evidence}`);
      } else {
        need(
          s.owner === r.owner,
          "checkpoint belongs to another owner; use explicit claim after reconciling writer absence",
        );
        const confirming = r.action === "external" && r.operation === "confirm";
        need(
          confirming ||
            (!s.released &&
              root === s.checkout &&
              git(root, "symbolic-ref", "--short", "HEAD") === s.branch),
          "checkout/branch or released ownership conflict; reconcile with claim",
        );
        apply(s, r);
      }
    }
    if (!s.released)
      for (const entry of await readdir(store)) {
        if (entry === ".writer.lock" || entry === `${r.ticketId}.json`)
          continue;
        need(
          /^[a-f0-9-]{36}\.json$/.test(entry),
          "unexpected checkpoint store entry; inspect before proceeding",
        );
        const other = await jsonFile(join(store, entry));
        validate(other);
        need(
          other.released ||
            other.checkout !== s.checkout ||
            other.ticketId === s.ticketId,
          "checkout has another ticket owner; release or reconcile it first",
        );
      }
    s.revision += 1;
    validate(s);
    const bytes = JSON.stringify(s, null, 2) + "\n";
    need(
      Buffer.byteLength(bytes) <= LIMIT,
      "checkpoint too large; retain artifact references rather than transcripts",
    );
    await directory(store);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
    return {
      saved: true,
      file,
      next: s.next,
      repairs: Object.fromEntries(
        Object.entries(s.repairs).map(([k, b]) => [
          k,
          { used: b.batches.length, limit: b.limit, active: b.active },
        ]),
      ),
      ci: s.monitor
        ? {
            head: s.monitor.head,
            disposition: s.monitor.disposition,
            waitUsedMs: s.monitor.waitUsedMs,
            waitLimitMs: s.monitor.waitLimitMs,
            nextPollAt: s.monitor.nextPollAt,
            waitRemainingMs: remainingWaitMs(s.monitor),
            watcher: s.monitor.watcher ?? null,
            lastWatcher: s.monitor.lastWatcher ?? null,
          }
        : null,
    };
  } finally {
    await rm(lock, { recursive: true });
  }
}

async function cli() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    need(Buffer.byteLength(input) <= LIMIT, "request too large");
  }
  process.stdout.write(
    JSON.stringify({ result: await ticketState(JSON.parse(input)) }) + "\n",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  cli().catch((e) => {
    process.stdout.write(JSON.stringify({ error: e.message }) + "\n");
    process.exitCode = 1;
  });
}
