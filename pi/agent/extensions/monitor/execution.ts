import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  executeScript,
  snapshotScriptJson,
  type JsonValue,
} from "../script/api.ts";
import type { Registration, Trigger } from "./contract.ts";
export function evaluateMonitor(
  pi: Pick<ExtensionAPI, "events">,
  cwd: string,
  reg: Registration,
  trigger: Trigger,
  state: JsonValue,
  signal: AbortSignal,
  deadlineMs: number,
) {
  return executeScript(pi, cwd, {
    // Parse data, rather than reinterpreting JSON __proto__ keys as object-literal syntax.
    source: `return await (async (trigger, state) => {\n${reg.source}\n})(JSON.parse(${JSON.stringify(snapshotScriptJson(trigger))}), JSON.parse(${JSON.stringify(snapshotScriptJson(state))}));`,
    providers: reg.providers,
    capabilityCeiling: reg.providers,
    limits: { maxCalls: 8, maxConcurrency: 2, timeoutMs: 30000 },
    signal,
    deadlineMs,
  });
}
