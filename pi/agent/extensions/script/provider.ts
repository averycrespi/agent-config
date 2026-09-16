import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Ajv, type ValidateFunction } from "ajv";
import { jsonSnapshot } from "./value.ts";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type MethodResult = {
  value: JsonValue;
  isError?: boolean;
  outcomeUnknown?: boolean;
};
export type MethodContext = { signal: AbortSignal; deadlineMs: number };
export type ScriptMethod = {
  description: string;
  /** JSON Schema draft-07 for the positional argument array. */
  inputSchema: Record<string, unknown>;
  handler: (args: JsonValue[], context: MethodContext) => Promise<MethodResult>;
};
export type ScriptProvider = {
  namespace: string;
  methods: Record<string, ScriptMethod>;
  available: () => boolean;
};
export type RegisteredProvider = {
  namespace: string;
  methods: ReadonlyMap<string, ScriptMethod & { validate: ValidateFunction }>;
  available: () => boolean;
  signal: AbortSignal;
};
type Bus = Pick<ExtensionAPI, "events">;
const EVENT = "script:providers-v1";
// Lower-case namespace names cannot shadow JS intrinsics. Helper/privileged names are reserved.
const reserved = new Set([
  "parallel",
  "globalThis",
  "process",
  "require",
  "fetch",
  "eval",
  "constructor",
  "prototype",
  "__proto__",
  "then",
  "console",
  "performance",
  "crypto",
  "setTimeout",
  "setInterval",
  "undefined",
  "escape",
  "unescape",
  "await",
  "yield",
  "let",
  "var",
  "const",
  "function",
  "class",
  "return",
  "throw",
  "try",
  "catch",
  "finally",
  "if",
  "else",
  "switch",
  "case",
  "default",
  "for",
  "while",
  "do",
  "break",
  "continue",
  "new",
  "delete",
  "typeof",
  "void",
  "in",
  "instanceof",
  "this",
  "super",
  "import",
  "export",
  "extends",
  "with",
  "debugger",
  "null",
  "true",
  "false",
  "enum",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "static",
]);
export const validName = (name: unknown): name is string =>
  typeof name === "string" &&
  /^[a-z][a-z0-9_]{0,47}$/.test(name) &&
  !reserved.has(name);
export function collectProviders(pi: Bus): RegisteredProvider[] {
  const providers: RegisteredProvider[] = [];
  pi.events.emit(EVENT, {
    accept: (provider: RegisteredProvider) => providers.push(provider),
  });
  if (
    providers.length > 32 ||
    new Set(providers.map((p) => p.namespace)).size !== providers.length
  )
    throw new Error("provider_conflict");
  return providers;
}

/** Validate everything before installing one session-bus listener. No module-global registry. */
export function registerScriptProvider(
  pi: Bus,
  provider: ScriptProvider,
): () => void {
  const errors: string[] = [];
  if (!provider || !validName(provider.namespace))
    errors.push("invalid_namespace");
  if (typeof provider?.available !== "function")
    errors.push("invalid_availability");
  const entries =
    provider?.methods && typeof provider.methods === "object"
      ? Object.entries(provider.methods)
      : [];
  if (!entries.length || entries.length > 32) errors.push("invalid_methods");
  const methods = new Map<
    string,
    ScriptMethod & { validate: ValidateFunction }
  >();
  for (const [name, method] of entries) {
    if (
      !validName(name) ||
      !method ||
      typeof method.handler !== "function" ||
      typeof method.description !== "string" ||
      !method.description.trim() ||
      method.description.length > 500 ||
      /[\p{Cc}\p{Cf}]/u.test(method.description)
    ) {
      errors.push("invalid_method");
      continue;
    }
    try {
      const schema = JSON.parse(
        jsonSnapshot(method.inputSchema, 16384),
      ) as Record<string, unknown>;
      if (
        schema.type !== "array" ||
        JSON.stringify(schema).includes('"$async"')
      )
        throw new Error();
      const ajv = new Ajv({
        strict: true,
        allErrors: false,
        validateFormats: true,
        ownProperties: true,
      });
      const validate = ajv.compile(schema);
      methods.set(name, {
        description: method.description,
        inputSchema: schema,
        handler: method.handler,
        validate,
      });
    } catch {
      errors.push("invalid_schema");
    }
  }
  const existing = collectProviders(pi);
  if (existing.some((p) => p.namespace === provider?.namespace))
    errors.push("provider_conflict");
  if (existing.length >= 32) errors.push("provider_limit");
  if (errors.length) throw new Error([...new Set(errors)].join(", "));
  const controller = new AbortController();
  const available = provider.available;
  const registered: RegisteredProvider = {
    namespace: provider.namespace,
    methods,
    available: () => !controller.signal.aborted && available() === true,
    signal: controller.signal,
  };
  const unsubscribe = pi.events.on(EVENT, (request: unknown) => {
    if (
      request &&
      typeof request === "object" &&
      "accept" in request &&
      typeof request.accept === "function"
    )
      request.accept(registered);
  });
  return () => {
    controller.abort();
    unsubscribe();
  };
}
