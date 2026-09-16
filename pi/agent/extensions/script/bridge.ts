import type {
  JsonValue,
  MethodResult,
  RegisteredProvider,
  ScriptExecutionContext,
} from "./provider.ts";
import { methodAvailable } from "./provider.ts";
import { jsonSnapshot } from "./value.ts";

export class AdmissionError extends Error {
  constructor(
    readonly code:
      | "capability_unavailable"
      | "invalid_arguments"
      | "provider_error",
  ) {
    super(code);
  }
}
export type ScriptBridge = {
  bindings: Record<string, string[]>;
  call(
    name: string,
    args: unknown[],
    signal: AbortSignal,
    deadlineMs: number,
    dispatch: () => void,
  ): Promise<MethodResult>;
};
export function createBridge(
  providers: RegisteredProvider[],
  execution?: ScriptExecutionContext,
): ScriptBridge {
  const methods = new Map<
    string,
    {
      provider: RegisteredProvider;
      method: RegisteredProvider["methods"] extends ReadonlyMap<string, infer M>
        ? M
        : never;
    }
  >(
    providers.flatMap((provider) =>
      [...provider.methods.entries()].map(
        ([name, method]) =>
          [`${provider.namespace}.${name}`, { provider, method }] as const,
      ),
    ),
  );
  return {
    bindings: Object.fromEntries(
      providers.map((p) => [p.namespace, [...p.methods.keys()]]),
    ),
    async call(name, args, signal, deadlineMs, dispatch) {
      const found = methods.get(name);
      if (!found) throw new AdmissionError("capability_unavailable");
      let available = false;
      try {
        available = found.provider.available();
      } catch {
        /* Fail closed without exception text. */
      }
      if (!available || !methodAvailable(found.method))
        throw new AdmissionError("capability_unavailable");
      if (!found.method.validate(args))
        throw new AdmissionError("invalid_arguments");
      signal.throwIfAborted();
      dispatch();
      const result = await found.method.handler(args as JsonValue[], {
        signal,
        deadlineMs,
        execution,
      });
      if (
        !result ||
        typeof result !== "object" ||
        !Object.hasOwn(result, "value") ||
        (result.isError !== undefined && typeof result.isError !== "boolean") ||
        (result.outcomeUnknown !== undefined &&
          typeof result.outcomeUnknown !== "boolean") ||
        (result.error !== undefined &&
          (typeof result.error !== "string" ||
            !found.method.errorCodes?.includes(result.error) ||
            result.value !== null))
      )
        throw new Error("invalid_provider_result");
      // Snapshot before IPC, excluding host objects, accessors, and serialization hooks.
      return {
        value: JSON.parse(jsonSnapshot(result.value)),
        isError:
          result.isError === true ||
          result.outcomeUnknown === true ||
          result.error !== undefined,
        outcomeUnknown: result.outcomeUnknown === true,
        error: result.error,
      };
    },
  };
}
