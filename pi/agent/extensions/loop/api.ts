import { requireLoopController } from "./runtime.ts";
import type { LoopLimitPatch, LoopState } from "./state.ts";

export type StartLoopInput = {
  message: string;
  maxContinuations?: number;
  maxActiveMinutes?: number;
  delaySeconds?: number;
};

export type LoopEventType =
  | "started"
  | "continued"
  | "yielded"
  | "stopped"
  | "resumed"
  | "extended"
  | "cleared"
  | "exhausted";

export type LoopEvent = {
  type: LoopEventType;
  loop?: LoopState;
};

export type LoopController = {
  get(): LoopState | undefined;
  start(input: StartLoopInput): LoopState;
  yield(reason: string): LoopState;
  stop(reason?: string): LoopState;
  resume(): LoopState;
  extend(limits: LoopLimitPatch): LoopState;
  clear(): void;
  subscribe(listener: (event: LoopEvent) => void): () => void;
};

export const loop: LoopController = {
  get: () => requireLoopController().get(),
  start: (input) => requireLoopController().start(input),
  yield: (reason) => requireLoopController().yield(reason),
  stop: (reason) => requireLoopController().stop(reason),
  resume: () => requireLoopController().resume(),
  extend: (limits) => requireLoopController().extend(limits),
  clear: () => requireLoopController().clear(),
  subscribe: (listener) => requireLoopController().subscribe(listener),
};

export type { LoopLimitPatch, LoopLimits, LoopState } from "./state.ts";
