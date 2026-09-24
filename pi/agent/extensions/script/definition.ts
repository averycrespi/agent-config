import ts from "typescript";
import { Script } from "node:vm";
import { createHash } from "node:crypto";
import { Ajv, type ValidateFunction } from "ajv";
import { MAX_LIMITS } from "./config.ts";
import { validName } from "./provider.ts";
import { jsonSnapshot, MAX_ARGS_BYTES } from "./value.ts";

export const SAVED_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_DEFINITION_BYTES = 256 * 1024;
export { MAX_ARGS_BYTES } from "./value.ts";
export type Definition = {
  source: string;
  executable: string;
  digest: string;
  meta: {
    name: string;
    description: string;
    args: Record<string, unknown>;
    providers: string[];
    limits: typeof MAX_LIMITS;
  };
  validate: ValidateFunction;
};
const fail = (code: string): never => {
  throw new Error(code);
};
function literal(node: ts.Expression, depth = 0): unknown {
  if (depth > 32) return fail("invalid_metadata");
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node))
    return ts.isStringLiteral(node) ? node.text : Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  )
    return -Number(node.operand.text);
  if (ts.isArrayLiteralExpression(node))
    return node.elements.map((n) => literal(n, depth + 1));
  if (ts.isObjectLiteralExpression(node)) {
    const out = Object.create(null);
    for (const p of node.properties) {
      if (
        !ts.isPropertyAssignment(p) ||
        !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
      )
        return fail("invalid_metadata");
      const key = p.name.text;
      if (Object.hasOwn(out, key)) return fail("invalid_metadata");
      out[key] = literal(p.initializer, depth + 1);
    }
    return out;
  }
  return fail("invalid_metadata");
}

/** Parse/compile only: neither metadata nor guest code executes in the host. */
export function parseDefinition(source: string): Definition {
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source) > MAX_DEFINITION_BYTES
  )
    fail("invalid_definition");
  const file = ts.createSourceFile(
    "saved.js",
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const [first, entry] = file.statements;
  if (
    file.statements.length !== 2 ||
    !first ||
    !ts.isVariableStatement(first) ||
    first.modifiers?.length !== 1 ||
    first.modifiers[0].kind !== ts.SyntaxKind.ExportKeyword ||
    !(first.declarationList.flags & ts.NodeFlags.Const) ||
    first.declarationList.declarations.length !== 1
  )
    fail("invalid_definition");
  const decl = (first as ts.VariableStatement).declarationList.declarations[0];
  if (
    !ts.isIdentifier(decl.name) ||
    decl.name.text !== "meta" ||
    !decl.initializer
  )
    fail("invalid_metadata");
  const meta = JSON.parse(jsonSnapshot(literal(decl.initializer!), 20 * 1024));
  if (
    !meta ||
    Object.keys(meta).sort().join() !==
      "args,description,limits,name,providers" ||
    typeof meta.name !== "string" ||
    !SAVED_NAME.test(meta.name) ||
    typeof meta.description !== "string" ||
    !meta.description.trim() ||
    meta.description.length > 240 ||
    /[\p{Cc}\p{Cf}]/u.test(meta.description) ||
    !Array.isArray(meta.providers) ||
    meta.providers.length > 32 ||
    !meta.providers.every(validName) ||
    new Set(meta.providers).size !== meta.providers.length
  )
    fail("invalid_metadata");
  if (
    !meta.limits ||
    Object.keys(meta.limits).sort().join() !==
      "maxCalls,maxConcurrency,timeoutMs" ||
    (Object.keys(MAX_LIMITS) as Array<keyof typeof MAX_LIMITS>).some(
      (k) =>
        !Number.isSafeInteger(meta.limits[k]) ||
        meta.limits[k] < 1 ||
        meta.limits[k] > MAX_LIMITS[k],
    )
  )
    fail("invalid_limits");
  let validate: ValidateFunction;
  try {
    const schema = JSON.parse(jsonSnapshot(meta.args, 16384));
    if (schema.type !== "object" || JSON.stringify(schema).includes('"$async"'))
      throw new Error();
    validate = new Ajv({
      strict: true,
      ownProperties: true,
      validateFormats: true,
    }).compile(schema);
  } catch {
    return fail("invalid_argument_schema");
  }
  if (
    !entry ||
    !ts.isFunctionDeclaration(entry) ||
    entry.name?.text !== "run" ||
    entry.parameters.length ||
    !entry.body ||
    entry.asteriskToken ||
    entry.modifiers?.length !== 2 ||
    !entry.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ||
    !entry.modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
  )
    fail("invalid_entry_point");
  function visit(node: ts.Node) {
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      (ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    )
      fail("imports_not_allowed");
    ts.forEachChild(node, visit);
  }
  visit(entry);
  const executable =
    source
      .slice(first.getStart(file), first.getEnd())
      .replace(/^export\s+/, "") +
    "\n" +
    source
      .slice(entry.getStart(file), entry.getEnd())
      .replace(/^export\s+/, "") +
    "\nreturn await run();";
  try {
    // Compile the original metadata syntax too, without executing its initializer.
    new Script(`(async () => {\n${executable}\n})`);
  } catch {
    return fail("invalid_definition");
  }
  return {
    source,
    executable,
    digest: createHash("sha256").update(source).digest("hex"),
    meta,
    validate,
  };
}

export function validateArguments(
  definition: Definition,
  args: unknown,
): string {
  const json = jsonSnapshot(args === undefined ? {} : args, MAX_ARGS_BYTES);
  if (!definition.validate(JSON.parse(json))) fail("invalid_arguments");
  return json;
}
