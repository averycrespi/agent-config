import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type Outcome = {
  status: "success" | "failed" | "cancelled" | "timeout" | "interrupted";
  effectsMayPersist: boolean;
  outcomeUnknown: boolean;
  /** Bounded adapter-owned JSON result/accounting, never source. */
  result?: unknown;
};
export type Progress = { completed: number; total: number; failed: number };
export type Activity = {
  started: number;
  completed: number;
  failed: number;
  phase?: string;
  /** Optional bounded policy label for a single child; display only. */
  profile?: string;
};
export type ProgressUpdate = {
  progress?: Progress;
  activity?: Activity;
  result?: unknown;
};
export type Execution = {
  id: string;
  owner: string;
  label: string;
  anchor: string;
  createdAt: number;
  deadlineMs: number;
  status: "running" | Outcome["status"];
  endedAt?: number;
  cancelRequested: boolean;
  dismissed: boolean;
  effectsMayPersist: boolean;
  outcomeUnknown: boolean;
  result?: unknown;
  persistenceFailed?: boolean;
  progress?: Progress;
  activity?: Activity;
  notification: {
    id: string;
    intent: boolean;
    handoff: "none" | "unknown" | "handed_to_pi";
    consumed: boolean;
  };
};
export type Admission = {
  owner: string;
  label: string;
  deadlineMs: number;
  /** Optional initial bounded artifact references/accounting persisted at admission. */
  result?: unknown;
  /** Prepared adapter: all authorization/selection validation must precede admission. */
  run(
    signal: AbortSignal,
    report: (update: ProgressUpdate) => void,
  ): Promise<Outcome>;
};
export interface BackgroundService {
  admit(request: Admission): Execution;
  list(owner: string): Execution[];
  inspect(owner: string, id: string): Execution;
  cancel(owner: string, id: string): Execution;
  dismiss(owner: string, id: string): Execution;
}
export const SERVICE_EVENT = "background:service-v1";
/** Host-only synchronous discovery; missing/duplicate service fails closed. */
export function getBackgroundService(
  pi: Pick<ExtensionAPI, "events">,
): BackgroundService {
  const services: BackgroundService[] = [];
  pi.events.emit(SERVICE_EVENT, {
    accept: (service: BackgroundService) => services.push(service),
  });
  if (services.length !== 1) throw new Error("background_unavailable");
  return services[0];
}
