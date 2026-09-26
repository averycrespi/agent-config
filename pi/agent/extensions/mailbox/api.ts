import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { address } from "./store.ts";

/** Read-only readiness/count projection. No report contents or mutations. */
export function inspectMailbox(
  pi: Pick<ExtensionAPI, "events">,
  mailbox: string,
) {
  address(mailbox);
  let result:
    | { pending: number; sessionId: string; listening: boolean }
    | undefined;
  pi.events.emit("mailbox:inspect-v1", {
    mailbox,
    reply(value: typeof result) {
      result = value && {
        pending: value.pending,
        sessionId: value.sessionId,
        listening: value.listening,
      };
    },
  });
  return result;
}
