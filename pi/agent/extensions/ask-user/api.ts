/** Non-answer returned without opening an interaction in parent-managed mode. */
export type DecisionRequiredDetails = {
  status: "decision_required";
  mode: "parent";
  requestId: string;
  cancelled: false;
  answerSupplied: false;
  approvalSupplied: false;
};

export type InputOutcome = "answered" | "cancelled" | "failed";

export type InputRequestedEvent = { requestId: string };
export type InputResolvedEvent = {
  requestId: string;
  outcome: InputOutcome;
};
