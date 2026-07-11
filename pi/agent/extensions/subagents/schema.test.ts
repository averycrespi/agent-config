import assert from "node:assert/strict";
import test from "node:test";

import { validateOutputSchema } from "./schema.ts";

const supported = [
  {},
  { type: "null" },
  { type: "boolean", title: "Flag", description: "A flag" },
  { type: "number", enum: [null, true, 1, "one"] },
  { type: "integer", const: 3 },
  { type: "string" },
  {
    type: "object",
    properties: {
      name: { type: "string" },
      nested: {
        type: "array",
        items: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    required: ["name", "nested"],
    additionalProperties: false,
  },
  { type: "array", items: { enum: ["x", "y"] } },
];

for (const [index, schema] of supported.entries()) {
  test(`schema accepts supported definition ${index}`, () => {
    assert.deepEqual(validateOutputSchema(schema), []);
  });
}

test("schema rejects a non-object root and type arrays", () => {
  assert.deepEqual(validateOutputSchema(null), [
    "output_schema must be an object",
  ]);
  assert.match(
    validateOutputSchema({ type: ["string", "null"] }).join("\n"),
    /output_schema\.type.*supported string/,
  );
});

test("schema rejects unknown types and keywords with qualified paths", () => {
  const errors = validateOutputSchema({
    type: "date",
    minLength: 1,
    $ref: "#/thing",
  });
  assert.match(errors.join("\n"), /output_schema\.type.*date/);
  assert.match(errors.join("\n"), /output_schema\.minLength.*unsupported/);
  assert.match(errors.join("\n"), /output_schema\.\$ref.*unsupported/);
});

test("schema rejects misplaced structural keywords", () => {
  const errors = validateOutputSchema({
    type: "string",
    required: [],
    properties: {},
    additionalProperties: true,
    items: {},
  });
  for (const field of [
    "required",
    "properties",
    "additionalProperties",
    "items",
  ]) {
    assert.match(errors.join("\n"), new RegExp(`output_schema\\.${field}`));
  }
});

test("schema validates malformed object keywords and nested paths", () => {
  const errors = validateOutputSchema({
    type: "object",
    required: ["x", "x", 1],
    properties: {
      good: { type: "string" },
      bad: { type: "array", items: { type: "wat" } },
      malformed: null,
    },
    additionalProperties: "no",
  });
  const joined = errors.join("\n");
  assert.match(joined, /output_schema\.required\[1\].*unique/);
  assert.match(joined, /output_schema\.required\[2\].*string/);
  assert.match(joined, /output_schema\.properties\.bad\.items\.type.*wat/);
  assert.match(
    joined,
    /output_schema\.properties\.malformed must be an object/,
  );
  assert.match(joined, /output_schema\.additionalProperties.*boolean/);
});

test("schema validates malformed array items", () => {
  assert.match(
    validateOutputSchema({ type: "array", items: [] }).join("\n"),
    /output_schema\.items must be an object/,
  );
});

test("schema requires properties when additionalProperties is false", () => {
  assert.match(
    validateOutputSchema({
      type: "object",
      additionalProperties: false,
    }).join("\n"),
    /output_schema\.properties.*required/,
  );
});

test("schema rejects malformed annotations, enum, and const", () => {
  const errors = validateOutputSchema({
    title: 1,
    description: false,
    enum: [],
    const: { nested: true },
  });
  const joined = errors.join("\n");
  assert.match(joined, /output_schema\.title.*string/);
  assert.match(joined, /output_schema\.description.*string/);
  assert.match(joined, /output_schema\.enum.*non-empty/);
  assert.match(joined, /output_schema\.const.*JSON scalar/);
});

test("schema rejects non-scalar enum entries and non-finite numbers", () => {
  const errors = validateOutputSchema({
    enum: [1, { x: true }, ["x"], Number.NaN, Number.POSITIVE_INFINITY],
  });
  const joined = errors.join("\n");
  for (const index of [1, 2, 3, 4]) {
    assert.match(joined, new RegExp(`output_schema\\.enum\\[${index}\\]`));
  }
});

test("schema rejects non-JSON and cyclic definitions", () => {
  const cyclic: Record<string, unknown> = { type: "object" };
  cyclic.properties = { self: cyclic };
  assert.match(
    validateOutputSchema(cyclic).join("\n"),
    /output_schema\.properties\.self.*cyclic/,
  );
  assert.match(
    validateOutputSchema({ const: undefined }).join("\n"),
    /output_schema\.const.*JSON scalar/,
  );
});
