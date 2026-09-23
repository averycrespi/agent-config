import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const signature = (r) =>
  createHash("sha256").update(JSON.stringify(r)).digest("hex");
const registrationIdentity = (r) =>
  signature([
    r.id,
    r.createdAt,
    r.deadline,
    r.cycleMs,
    r.maxWakes,
    r.recurring,
  ]);
const need = (condition, message) => {
  if (!condition) throw new Error(message);
};
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const text = (s) => typeof s === "string" && s.trim().length > 0;

// Stored once as JSON in the index's Observation section; never a child CI ledger.
export function allowance(deadline, maxAttempts) {
  need(
    integer(deadline) && integer(maxAttempts) && maxAttempts > 0,
    "finite supervision authority required",
  );
  return { deadline, maxAttempts, used: 0, groups: {} };
}
export function supervision(current, operation, now = Date.now()) {
  need(
    integer(now) &&
      integer(current?.deadline) &&
      integer(current?.maxAttempts) &&
      current.maxAttempts > 0 &&
      integer(current?.used) &&
      current.used <= current.maxAttempts &&
      current.groups &&
      typeof current.groups === "object" &&
      !Array.isArray(current.groups),
    "invalid supervision accounting",
  );
  for (const g of Object.values(current.groups)) {
    need(
      g &&
        typeof g === "object" &&
        !Array.isArray(g) &&
        Object.keys(g).every((k) => ["pending", "last"].includes(k)),
      "corrupt group accounting",
    );
    if (g.pending) {
      const p = g.pending;
      need(
        Array.isArray(p.members) &&
          p.members.length > 0 &&
          p.members.every(text) &&
          new Set(p.members).size === p.members.length &&
          text(p.reference) &&
          integer(p.preparedAt) &&
          integer(p.cycleMs) &&
          p.cycleMs >= 1000 &&
          p.cycleMs <= 1500000 &&
          integer(p.lifetimeMs) &&
          p.lifetimeMs >= p.cycleMs &&
          p.preparedAt + p.lifetimeMs <= current.deadline &&
          (p.id === null ||
            (text(p.id) && /^[a-f0-9]{64}$/.test(p.registrationSignature))),
        "corrupt reservation",
      );
    }
    if (g.last)
      need(
        text(g.last.id) &&
          text(g.last.reference) &&
          /^[a-f0-9]{64}$/.test(g.last.signature),
        "corrupt receipt anchor",
      );
  }
  need(
    current.used +
      Object.values(current.groups).filter((g) => g.pending).length <=
      current.maxAttempts,
    "corrupt reserved allowance",
  );
  const s = structuredClone(current);
  need(
    /^[a-zA-Z0-9_-]+$/.test(operation.group) &&
      !["__proto__", "constructor", "prototype"].includes(operation.group),
    "invalid group",
  );
  const group = s.groups[operation.group];
  if (operation.action === "reserve") {
    need(!group?.pending, "reconcile existing registration first");
    const reserved = Object.values(s.groups).filter((g) => g.pending).length;
    const remaining = s.deadline - now;
    need(
      remaining >= 1000 && s.used + reserved < s.maxAttempts,
      "supervision allowance exhausted",
    );
    need(
      text(operation.reference) &&
        Array.isArray(operation.members) &&
        operation.members.length > 0 &&
        new Set(operation.members).size === operation.members.length &&
        operation.members.every(text),
      "membership and registration intent reference required",
    );
    s.groups[operation.group] = {
      ...group,
      pending: {
        members: [...operation.members],
        reference: operation.reference,
        preparedAt: now,
        lifetimeMs: Math.min(remaining, 86400000),
        cycleMs: Math.min(remaining, 1500000),
        id: null,
      },
    };
  } else if (operation.action === "attach") {
    const p = group?.pending,
      r = operation.receipt;
    need(
      p &&
        r &&
        text(r.id) &&
        integer(r.createdAt) &&
        r.createdAt >= p.preparedAt &&
        r.createdAt <= now &&
        integer(r.deadline) &&
        r.deadline > r.createdAt &&
        r.deadline <= s.deadline &&
        r.deadline - r.createdAt <= p.lifetimeMs &&
        integer(r.cycleMs) &&
        r.cycleMs >= 1000 &&
        r.cycleMs <= p.cycleMs &&
        r.maxWakes === 1 &&
        r.recurring === false &&
        (!p.id ||
          (p.id === r.id &&
            p.registrationSignature === registrationIdentity(r))) &&
        !Object.entries(s.groups).some(
          ([key, other]) =>
            key !== operation.group &&
            (other.pending?.id === r.id || other.last?.id === r.id),
        ),
      "registration identity/bounds mismatch",
    );
    p.id = r.id;
    p.registrationSignature = registrationIdentity(r);
  } else if (operation.action === "reconcile") {
    const r = operation.receipt;
    need(r && text(operation.reference), "terminal receipt reference required");
    if (!group?.pending) {
      need(
        group?.last?.id === r.id && group.last.signature === signature(r),
        "receipt does not match pending registration",
      );
      return s;
    }
    const p = group.pending;
    need(
      p.id === r.id &&
        p.registrationSignature === registrationIdentity(r) &&
        ["finished", "cancelled", "invalidated"].includes(r.status) &&
        !r.inFlight &&
        integer(r.wakes) &&
        r.wakes <= 1 &&
        r.maxWakes === 1 &&
        r.recurring === false &&
        r.attention?.disposition !== "pending",
      "reconcile inactivity/pending attention before accounting",
    );
    s.used += r.wakes;
    need(s.used <= s.maxAttempts, "supervision allowance exceeded");
    s.groups[operation.group] = {
      last: {
        id: r.id,
        reference: operation.reference,
        signature: signature(r),
      },
    };
  } else throw new Error("unknown supervision operation");
  return s;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  try {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const request = JSON.parse(input);
    const result =
      request.action === "init"
        ? allowance(request.deadline, request.maxAttempts)
        : supervision(request.current, request.operation);
    process.stdout.write(JSON.stringify({ result }) + "\n");
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error.message }) + "\n");
    process.exitCode = 1;
  }
}
