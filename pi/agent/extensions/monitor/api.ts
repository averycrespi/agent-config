export type MonitorTerminalState =
  | "condition"
  | "deadline"
  | "failure_limit"
  | "unsafe_failure"
  | "cancelled"
  | "invalidated";

export type MonitorEvent =
  | { type: "registered"; id: string }
  | {
      type: "terminated";
      id: string;
      state: MonitorTerminalState;
      notification: "pending" | "suppressed";
    }
  | {
      type: "notification";
      id: string;
      notification: "handoff_unknown" | "handed_to_pi";
    };
