export const host: {
  now(): number;
  home: string;
  env: NodeJS.ProcessEnv;
  exec(file: string, args: string[], timeout?: number): Promise<string>;
  read(path: string, limit?: number): Promise<string>;
  exists(path: string): Promise<boolean>;
  real(path: string): Promise<string>;
};
export function preflightWorker(
  request: { brief: Record<string, unknown>; launchId: string },
  io?: object,
): Promise<unknown>;
export function launchWorker(
  request: {
    phase: "prepare" | "submit";
    repo: string;
    indexId: string;
    launchId: string;
  },
  io?: object,
): Promise<{
  launchId: string;
  status: string;
  index: string;
  worker?: import("../../../extensions/coordinate/state.ts").Worker;
  handoff?: string;
  resources?: { workspace: string; pane: string; terminal: string };
  execution?: {
    submittedEntry: string | null;
    activity: boolean;
    seq: number;
    status: string;
    transcript: string;
  };
  wait?: { outcome: string; reference: string };
  next: string;
  effect?: string;
  reason?: string;
}>;
