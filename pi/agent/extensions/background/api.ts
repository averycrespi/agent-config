export { registerBackgroundProvider } from "./providers.ts";
export type {
  BackgroundProvider,
  EventSource,
  Subscription,
  Selection,
} from "./providers.ts";
export interface BackgroundEvent {
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
