const nonempty = (s) => typeof s === "string" && s.trim().length > 0;
const fields = [
  "assignmentId",
  "revision",
  "disposition",
  "pendingRef",
  "nextActor",
  "furtherWrites",
];
export function validateCoordination(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !fields.includes(k)) ||
    !nonempty(value.assignmentId) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !["working", "decision needed", "result offered", "stopped"].includes(
      value.disposition,
    ) ||
    !(value.pendingRef === null || nonempty(value.pendingRef)) ||
    !nonempty(value.nextActor) ||
    typeof value.furtherWrites !== "boolean" ||
    (["decision needed", "result offered"].includes(value.disposition) &&
      !nonempty(value.pendingRef))
  )
    throw new Error("invalid child coordination section");
  return value;
}

// This checks correlation, not the truth or authority of a supplied instruction.
export function validateAnswer(pending, answer) {
  const tuple = [
    "assignmentId",
    "revision",
    "runId",
    "sessionId",
    "incarnation",
    "requestId",
    "contextRevision",
    "head",
  ];
  if (
    !pending ||
    !answer ||
    pending.status !== "pending" ||
    answer.cancelled !== false ||
    !tuple.every(
      (k) =>
        (k === "revision" || k === "contextRevision"
          ? Number.isSafeInteger(pending[k]) && pending[k] > 0
          : nonempty(pending[k])) && answer[k] === pending[k],
    ) ||
    !["human", "parent decision"].includes(answer.provenance) ||
    !nonempty(answer.reference) ||
    !nonempty(answer.answer)
  )
    throw new Error(
      "unanswered, ambiguous or stale decision; reconcile without continuation",
    );
  return answer;
}
