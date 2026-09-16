import type { Notification, State } from "./engine.ts";
export {
  Bridge as SessionEventBridge,
  subscribeEvents,
  discover as discoverSessions,
} from "./transport.ts";
export {
  EVENTS as SESSION_EVENTS,
  subscribeBus as subscribeSessionBus,
  project as projectSessionEvent,
  filters as sessionEventFilters,
  validNotice as validSessionNotice,
} from "./events.ts";
export type {
  EventName as SessionEventName,
  Notice as SessionNotice,
} from "./events.ts";
export type {
  Target as SessionTarget,
  EventSubscription,
} from "./transport.ts";

/** Observational, content-free pi.events payload. See API.md. */
export interface WatchEvent {
  type: "registered" | "terminated" | "notification";
  id: string;
  state: State;
  notification: Notification;
}
