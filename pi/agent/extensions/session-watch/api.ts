import type { Notification, State } from "./engine.ts";

/** Observational, content-free pi.events payload. See API.md. */
export interface WatchEvent {
  type: "registered" | "terminated" | "notification";
  id: string;
  state: State;
  notification: Notification;
}
