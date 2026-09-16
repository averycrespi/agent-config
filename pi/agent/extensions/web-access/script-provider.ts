import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerScriptProvider, type JsonValue } from "../script/api.ts";

type WebOperation = {
  parameters: object;
  execute(
    id: string,
    params: any,
    signal: AbortSignal,
  ): Promise<{
    content: unknown;
    details: Record<string, unknown>;
  }>;
};

/** Reuse the tools' routing, framing and host effects, not a raw network API. */
export function registerWebScriptProvider(
  pi: Pick<ExtensionAPI, "events">,
  available: () => boolean,
  operations: { search: WebOperation; fetch: WebOperation },
): () => void {
  return registerScriptProvider(pi, {
    namespace: "web",
    available,
    methods: Object.fromEntries(
      Object.entries(operations).map(([name, operation]) => [
        name,
        {
          description:
            name === "search"
              ? "Search through configured web providers. Returns web_search content/details with untrusted framing; may create host spills."
              : "Fetch a public URL through web_fetch routing. Returns untrusted content/details; may create/reuse host GitHub clones or spills. No guest filesystem access.",
          inputSchema: {
            type: "array",
            items: [JSON.parse(JSON.stringify(operation.parameters))],
            minItems: 1,
            maxItems: 1,
            additionalItems: false,
          },
          async handler(
            args: JsonValue[],
            { signal, deadlineMs }: { signal: AbortSignal; deadlineMs: number },
          ) {
            const timer = new AbortController();
            const timeout = setTimeout(
              () => timer.abort(),
              Math.max(0, deadlineMs - Date.now()),
            );
            const active = AbortSignal.any([signal, timer.signal]);
            try {
              if (Date.now() >= deadlineMs) timer.abort();
              active.throwIfAborted();
              const result = await operation.execute(
                `script-web-${randomUUID()}`,
                args[0],
                active,
              );
              active.throwIfAborted();
              // Tool metadata can contain optional undefined fields. The web
              // transport omits those fields; core still validates plain JSON.
              return {
                value: JSON.parse(JSON.stringify(result)) as JsonValue,
                isError: typeof result.details.errorPreview === "string",
                outcomeUnknown: typeof result.details.errorPreview === "string",
              };
            } finally {
              clearTimeout(timeout);
            }
          },
        },
      ]),
    ),
  });
}
