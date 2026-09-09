import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { GatewayError } from "./client.ts";

/** No coercion, defaults, remote references, or ignored validation keywords. */
export function validateArguments(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): void {
  let valid: boolean;
  try {
    const Constructor =
      schema.$schema === "https://json-schema.org/draft/2020-12/schema"
        ? Ajv2020
        : Ajv;
    const validator = new Constructor({
      strict: true,
      strictTypes: false,
      strictTuples: false,
      allowUnionTypes: true,
      logger: false,
    });
    addFormats.default(validator);
    // Provider header-routing metadata is an annotation, not an argument constraint.
    validator.addKeyword({
      keyword: "x-mcp-header",
      schemaType: "string",
      valid: true,
    });
    const check = validator.compile(schema);
    if ("$async" in check && check.$async)
      throw new Error("Async schemas are unsupported");
    valid = check(args) === true;
  } catch {
    throw new GatewayError(
      "Tool input schema is unsupported or invalid; no invocation sent.",
      "unsupported_schema",
    );
  }
  if (!valid)
    throw new GatewayError(
      "Arguments do not match the discovered input schema; no invocation sent.",
      "invalid_arguments",
    );
}
