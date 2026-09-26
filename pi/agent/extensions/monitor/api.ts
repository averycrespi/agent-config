import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Receipt } from "./contract.ts";

/** Read-only, process-local inspection; absence means unknown, never inactive. */
export function inspectMonitor(
  pi: Pick<ExtensionAPI, "events">,
  id: string,
  source: string,
) {
  let result: { receipt: Receipt; sourceMatches: boolean } | undefined;
  pi.events.emit("monitor:inspect-v1", {
    id,
    source,
    reply(value: typeof result) {
      result = value && structuredClone(value);
    },
  });
  return result;
}

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
