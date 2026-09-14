export type InputOutcome = "answered" | "cancelled" | "failed";

export type InputRequestedEvent = { requestId: string };
export type InputResolvedEvent = {
  requestId: string;
  outcome: InputOutcome;
};
