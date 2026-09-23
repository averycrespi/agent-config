import { validateAnswer } from "../../spin-out/scripts/coordination.js";
const text = (v) => typeof v === "string" && v.trim().length > 0;
const identity = [
  "assignmentId",
  "revision",
  "runId",
  "sessionId",
  "incarnation",
];
const equal = (a, b) => identity.every((k) => a[k] === b[k]);

// Coordination convention only: mailbox storage does not interpret report contents.
export function incorporate(current, messages, assignments) {
  const next = structuredClone(current);
  const ack = [];
  for (const message of messages) {
    const report = JSON.parse(message.message);
    const owner = assignments.find((a) => equal(a, report));
    if (
      !owner ||
      !text(message.id) ||
      !text(report.reportId) ||
      !text(report.checkpoint) ||
      !text(report.reference) ||
      !text(report.head) ||
      !["question", "blocker", "result", "resolution"].includes(message.type)
    )
      throw new Error("unattributed or malformed report; retain without ack");
    const existing = next.reports[report.reportId];
    if (existing) {
      if (
        existing.content !== message.message ||
        existing.type !== message.type
      )
        throw new Error("conflicting report identity; retain without ack");
      ack.push(message.id);
      continue;
    }
    if (message.type === "question") {
      if (
        !text(report.requestId) ||
        !Number.isSafeInteger(report.contextRevision) ||
        report.contextRevision < 1 ||
        next.questions[report.requestId]
      )
        throw new Error("conflicting question identity");
      next.questions[report.requestId] = {
        ...report,
        status: "pending",
        messageId: message.id,
        announced: false,
      };
    }
    if (message.type === "resolution") {
      const q = next.questions[report.requestId];
      if (
        !q ||
        !equal(q, report) ||
        q.contextRevision !== report.contextRevision ||
        q.head !== report.questionHead ||
        !q.answer ||
        q.answer.reference !== report.answerReference ||
        !["answered-relay-pending", "relay-unknown"].includes(q.status)
      )
        throw new Error("unmatched answer application; retain without ack");
      q.status = "resolved";
      q.application = report.reference;
      q.applicationHead = report.head;
    }
    next.reports[report.reportId] = {
      content: message.message,
      type: message.type,
      messageId: message.id,
      reference: report.reference,
    };
    ack.push(message.id);
  }
  return { state: next, ack };
}
export function answerQuestion(current, requestId, answer) {
  const next = structuredClone(current);
  const q = next.questions[requestId];
  validateAnswer(q, answer);
  q.answer = structuredClone(answer);
  q.status = "answered-relay-pending";
  return next;
}
export function relayIntent(current, requestId, intentReference) {
  const next = structuredClone(current);
  const q = next.questions[requestId];
  if (!q || q.status !== "answered-relay-pending" || !text(intentReference))
    throw new Error("reconcile existing relay before another effect");
  q.status = "relay-unknown";
  q.relayIntent = intentReference;
  return next;
}
export function wellness({
  now,
  quietSince,
  quietMs,
  processAlive,
  checkpointAt,
  staleMs,
}) {
  if (
    ![now, quietSince, quietMs, staleMs].every(
      (v) => Number.isSafeInteger(v) && v >= 0,
    )
  )
    throw new Error("invalid wellness policy");
  if (now - quietSince < quietMs) return "quiet-window";
  if (processAlive === false) return "exited";
  if (
    processAlive !== true ||
    !Number.isSafeInteger(checkpointAt) ||
    checkpointAt > now
  )
    return "unknown";
  return now - checkpointAt > staleMs ? "stale" : "healthy-quiet";
}
