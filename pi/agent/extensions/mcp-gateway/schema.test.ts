import assert from "node:assert/strict";
import test from "node:test";
import { isGatewayError, GatewayError } from "./client.ts";
import { validateArguments } from "./schema.ts";

test("header annotations retain strict argument validation in both supported drafts", () => {
  for (const dialect of [
    undefined,
    "https://json-schema.org/draft/2020-12/schema",
  ]) {
    const schema = {
      ...(dialect ? { $schema: dialect } : {}),
      type: "object",
      required: ["owner", "repo"],
      additionalProperties: false,
      properties: {
        owner: { type: "string", "x-mcp-header": "owner" },
        repo: { type: "string", "x-mcp-header": "repo" },
        fields: {
          type: "array",
          items: { type: "string", enum: ["name", "type"] },
        },
        perPage: { type: "number", minimum: 1, maximum: 100 },
      },
    };
    const args = {
      owner: "example",
      repo: "demo",
      fields: ["name"],
      perPage: 2,
    };
    validateArguments(schema, args);
    assert.deepEqual(args, {
      owner: "example",
      repo: "demo",
      fields: ["name"],
      perPage: 2,
    });
    for (const invalid of [
      {},
      { ...args, owner: 1 },
      { ...args, perPage: 0 },
      { ...args, fields: ["unknown"] },
      { ...args, extra: true },
    ]) {
      assert.throws(
        () => validateArguments(schema, invalid),
        (e) => isGatewayError(e) && e.code === "invalid_arguments",
      );
    }
  }
});

test("unknown keywords and malformed header annotations still fail closed", () => {
  for (const property of [
    { type: "string", "x-mcp-header": 7 },
    { type: "string", "x-unknown-validation": true },
    { type: "string", format: "unknown-format" },
  ]) {
    assert.throws(
      () =>
        validateArguments(
          { type: "object", properties: { owner: property } },
          { owner: "example" },
        ),
      (e) => isGatewayError(e) && e.code === "unsupported_schema",
    );
  }
});

test("gateway error recognition requires a host-only brand, not JSON-shaped fields", () => {
  assert.equal(
    isGatewayError(new GatewayError("safe", "invalid_arguments")),
    true,
  );
  for (const value of [
    null,
    "error",
    new Error("error"),
    { code: "invalid_arguments", outcomeUnknown: false },
    { "pi:mcp-gateway:GatewayError:v1": true },
  ]) {
    assert.equal(isGatewayError(value), false);
  }
});
