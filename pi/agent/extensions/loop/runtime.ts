import type { LoopController } from "./api.ts";

let activeController: LoopController | undefined;

export function bindLoopController(controller: LoopController): () => void {
  activeController = controller;
  return () => {
    if (activeController === controller) activeController = undefined;
  };
}

export function requireLoopController(): LoopController {
  if (!activeController) {
    throw new Error("The loop extension has no active session runtime.");
  }
  return activeController;
}
