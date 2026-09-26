import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { address } from "./store.ts";

/** Read-only readiness/count projection. No report contents or mutations. */
export function inspectMailbox(
  pi: Pick<ExtensionAPI, "events">,
  mailbox: string,
) {
  address(mailbox);
  let result: { pending: number } | undefined;
  pi.events.emit("mailbox:inspect-v1", {
    mailbox,
    reply(value: typeof result) {
      result = value && { pending: value.pending };
    },
  });
  return result;
}
import { batchPolicy, type BatchPolicy } from "./supervision.ts";

export { DEFAULT_BATCH_POLICY } from "./supervision.ts";
export type { BatchPolicy, BatchCheckpoint } from "./supervision.ts";

export const MAILBOX_WAKE_GUIDANCE =
  "List/read pending mailbox messages in bounded pages; start a fresh scan after cursor exhaustion for later arrivals. Validate reports, durably incorporate relevant facts and report identities, then ACK incorporated message IDs. ACK means recorded, not answered, accepted or completed; questions awaiting humans may be ACKed once safely recorded. Unacknowledged messages will trigger another reminder within the original lifetime/wake limits. Evaluators never ACK or mutate coordination records. Reconcile this receipt; cancel when no useful authorized observation remains. Never replay uncertain handoffs or resume unanswered work.";

/** Recipe fields only: caller supplies explicit authorized name, clocks and wake cap. */
export function mailboxSupervision(options: {
  mailbox: string;
  policy?: Partial<BatchPolicy>;
  instructions?: string;
  events?: boolean;
}) {
  address(options.mailbox);
  const policy = batchPolicy(options.policy);
  const message = options.instructions
    ? `${MAILBOX_WAKE_GUIDANCE}\n${options.instructions}`
    : MAILBOX_WAKE_GUIDANCE;
  if (message.length > 2000)
    throw new Error("mailbox instructions exceed Monitor limit");
  return {
    providers: ["mailbox"],
    recurring: true,
    message,
    source: `return await mailbox.observe(${JSON.stringify(options.mailbox)}, state, ${JSON.stringify(policy)});`,
    ...(options.events !== false
      ? {
          events: [
            { provider: "mailbox", event: "changed", args: [options.mailbox] },
          ],
        }
      : {}),
  };
}
