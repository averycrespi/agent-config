const SUPPORTED_TYPES = new Set([
  "null",
  "boolean",
  "object",
  "array",
  "number",
  "integer",
  "string",
]);

const BASE_KEYWORDS = new Set([
  "type",
  "enum",
  "const",
  "title",
  "description",
]);
const STRUCTURAL_KEYWORDS = new Set([
  "required",
  "properties",
  "additionalProperties",
  "items",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function validateOutputSchema(
  schema: unknown,
  path = "output_schema",
): string[] {
  const errors: string[] = [];
  const ancestors = new Set<object>();

  function visit(value: unknown, currentPath: string): void {
    if (!isPlainObject(value)) {
      errors.push(`${currentPath} must be an object`);
      return;
    }
    if (ancestors.has(value)) {
      errors.push(`${currentPath} contains a cyclic schema definition`);
      return;
    }
    ancestors.add(value);

    const type = value.type;
    if (
      type !== undefined &&
      (typeof type !== "string" || !SUPPORTED_TYPES.has(type))
    ) {
      errors.push(
        `${currentPath}.type must be one supported string; received ${String(type)}`,
      );
    }

    for (const key of Object.keys(value)) {
      if (!BASE_KEYWORDS.has(key) && !STRUCTURAL_KEYWORDS.has(key)) {
        errors.push(`${currentPath}.${key} is unsupported`);
      }
    }

    if ("title" in value && typeof value.title !== "string") {
      errors.push(`${currentPath}.title must be a string`);
    }
    if ("description" in value && typeof value.description !== "string") {
      errors.push(`${currentPath}.description must be a string`);
    }

    if ("enum" in value) {
      if (!Array.isArray(value.enum) || value.enum.length === 0) {
        errors.push(`${currentPath}.enum must be a non-empty array`);
      } else {
        value.enum.forEach((entry, index) => {
          if (!isJsonScalar(entry)) {
            errors.push(`${currentPath}.enum[${index}] must be a JSON scalar`);
          }
        });
      }
    }
    if ("const" in value && !isJsonScalar(value.const)) {
      errors.push(`${currentPath}.const must be a JSON scalar`);
    }

    for (const key of STRUCTURAL_KEYWORDS) {
      if (!(key in value)) continue;
      const allowed =
        (type === "object" && key !== "items") ||
        (type === "array" && key === "items");
      if (!allowed) {
        errors.push(
          `${currentPath}.${key} is not valid for type ${String(type)}`,
        );
      }
    }

    if (type === "object") {
      if ("required" in value) {
        if (!Array.isArray(value.required)) {
          errors.push(
            `${currentPath}.required must be an array of unique strings`,
          );
        } else {
          const names = new Set<string>();
          value.required.forEach((entry, index) => {
            if (typeof entry !== "string") {
              errors.push(`${currentPath}.required[${index}] must be a string`);
            } else if (names.has(entry)) {
              errors.push(`${currentPath}.required[${index}] must be unique`);
            } else {
              names.add(entry);
            }
          });
        }
      }

      if ("properties" in value) {
        if (!isPlainObject(value.properties)) {
          errors.push(`${currentPath}.properties must be an object`);
        } else {
          for (const [name, propertySchema] of Object.entries(
            value.properties,
          )) {
            visit(propertySchema, `${currentPath}.properties.${name}`);
          }
        }
      }

      if (
        "additionalProperties" in value &&
        typeof value.additionalProperties !== "boolean"
      ) {
        errors.push(`${currentPath}.additionalProperties must be a boolean`);
      }
      if (value.additionalProperties === false && !("properties" in value)) {
        errors.push(
          `${currentPath}.properties is required when additionalProperties is false`,
        );
      }
    } else if (type === "array" && "items" in value) {
      visit(value.items, `${currentPath}.items`);
    }

    ancestors.delete(value);
  }

  visit(schema, path);
  return errors;
}
