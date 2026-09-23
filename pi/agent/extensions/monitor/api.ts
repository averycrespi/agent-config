export { registerMonitorProvider } from "./providers.ts";
export type {
  MonitorProvider,
  EventSource,
  Subscription,
  Selection,
} from "./providers.ts";
export interface MonitorEvent {
  type: "registered" | "attention" | "terminated" | "notification";
  id: string;
  status: "active" | "finished" | "cancelled" | "invalidated";
  notification:
    | "none"
    | "pending"
    | "suppressed"
    | "handoff_unknown"
    | "handed_to_pi";
}
