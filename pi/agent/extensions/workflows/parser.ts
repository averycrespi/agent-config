import ts from "typescript";
import type { ParsedWorkflow, WorkflowMeta } from "./types.ts";

const FORBIDDEN_IDENTIFIERS = new Set([
  "require",
  "process",
  "global",
  "globalThis",
  "Buffer",
  "Date",
  "performance",
  "crypto",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "Worker",
  "importScripts",
]);

function fail(message: string): never {
  throw new Error(message);
}

function textOf(source: ts.SourceFile, node: ts.Node): string {
  return source.text.slice(node.getStart(source), node.getEnd());
}

function literalString(node: ts.Node | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function readMeta(
  node: ts.Statement,
): { meta: WorkflowMeta; literalMeta: WorkflowMeta } | undefined {
  if (!ts.isVariableStatement(node)) return undefined;
  if (
    (node.modifiers ?? []).some((m) => m.kind !== ts.SyntaxKind.ExportKeyword)
  ) {
    return undefined;
  }
  if (
    !(node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  ) {
    return undefined;
  }
  if (!(node.declarationList.flags & ts.NodeFlags.Const)) return undefined;
  if (node.declarationList.declarations.length !== 1) return undefined;
  const decl = node.declarationList.declarations[0];
  if (!ts.isIdentifier(decl.name) || decl.name.text !== "meta")
    return undefined;
  if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) {
    fail("meta must be a literal object");
  }

  let name: string | undefined;
  let description: string | undefined;
  for (const prop of decl.initializer.properties) {
    if (!ts.isPropertyAssignment(prop))
      fail("meta must contain only literal properties");
    const key =
      prop.name &&
      (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name))
        ? prop.name.text
        : undefined;
    const value = literalString(prop.initializer);
    if (!key || value === undefined)
      fail("meta name and description must be string literals");
    if (key === "name") name = value;
    if (key === "description") description = value;
  }
  if (!name?.trim()) fail("meta.name is required");
  if (!description?.trim()) fail("meta.description is required");
  return {
    meta: { name: name.trim(), description: description.trim() },
    literalMeta: { name, description },
  };
}

function isSpawningCall(node: ts.CallExpression): boolean {
  return (
    ts.isIdentifier(node.expression) &&
    (node.expression.text === "agent" || node.expression.text === "verify")
  );
}

function hasReportBinding(node: ts.Node): boolean {
  if (
    (ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node)) &&
    node.name &&
    ts.isIdentifier(node.name) &&
    node.name.text === "report"
  )
    return true;
  return ts.forEachChild(node, hasReportBinding) ?? false;
}

function checkReportOptions(node: ts.CallExpression): void {
  if (node.arguments.some(ts.isSpreadElement)) return;
  const options = node.arguments[1];
  if (
    !options ||
    (ts.isObjectLiteralExpression(options) &&
      options.properties.every(
        (prop) =>
          !ts.isSpreadAssignment(prop) &&
          prop.name !== undefined &&
          !ts.isComputedPropertyName(prop.name) &&
          !(ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)
            ? prop.name.text === "gate"
            : false),
      ))
  )
    fail(
      "report() requires options with a callable gate; use return await report(value, { gate: () => verdict })",
    );
}

function checkRunResult(body: ts.ConciseBody | undefined): void {
  if (!body || !ts.isBlock(body)) return;
  // Only diagnose straight-line fall-through; runtime owns control-flow and value validation.
  if (
    body.statements.every(
      (statement) =>
        ts.isVariableStatement(statement) ||
        ts.isExpressionStatement(statement) ||
        ts.isFunctionDeclaration(statement) ||
        ts.isEmptyStatement(statement) ||
        (ts.isReturnStatement(statement) && !statement.expression),
    )
  )
    fail(
      "run() must return a result; use return results, return await report(results, { gate: () => verdict }), or return null",
    );
}

export function parseWorkflowScript(script: string): ParsedWorkflow {
  const source = ts.createSourceFile(
    "workflow.mjs",
    script,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const first = source.statements[0];
  if (!first) fail("script is empty");
  const metadata = readMeta(first);
  if (!metadata)
    fail("script must start with: export const meta = { name, description }");

  let hasSpawningCall = false;
  // Conservatively skip helper-specific checks if the name is bound anywhere in user code.
  const reportIsShadowed = hasReportBinding(source);

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      fail("imports are not allowed");
    }
    if (ts.isExportDeclaration(node)) fail("re-exports are not allowed");
    if (ts.isCallExpression(node)) {
      if (isSpawningCall(node)) hasSpawningCall = true;
      if (
        !reportIsShadowed &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "report"
      ) {
        checkReportOptions(node);
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword)
        fail("dynamic import is not allowed");
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require"
      )
        fail("require is not allowed");
      if (ts.isPropertyAccessExpression(node.expression)) {
        const expr = textOf(source, node.expression);
        if (expr === "Date.now") fail("Date.now is not allowed");
        if (expr === "Math.random") fail("Math.random is not allowed");
      }
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date"
    ) {
      fail("new Date is not allowed");
    }
    if (ts.isIdentifier(node) && FORBIDDEN_IDENTIFIERS.has(node.text)) {
      fail(`${node.text} is not allowed`);
    }
    ts.forEachChild(node, visit);
  }

  for (const statement of source.statements) visit(statement);
  if (!hasSpawningCall)
    fail("workflow must call agent() or verify() at least once");

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === "run") {
      checkRunResult(statement.body);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === "run" &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        ) {
          checkRunResult(declaration.initializer.body);
        }
      }
    }
  }

  const replacements: Array<{ start: number; end: number; text: string }> = [
    {
      start: first.getStart(source),
      end: first.getEnd(),
      text: `const meta = ${textOf(source, (first as ts.VariableStatement).declarationList.declarations[0].initializer!)};`,
    },
  ];
  for (const statement of source.statements.slice(1)) {
    for (const modifier of (ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : []) ?? []) {
      if (modifier.kind === ts.SyntaxKind.ExportKeyword) {
        replacements.push({
          start: modifier.getStart(source),
          end: modifier.getEnd(),
          text: "",
        });
      }
    }
  }
  let executableScript = script;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    executableScript =
      executableScript.slice(0, replacement.start) +
      replacement.text +
      executableScript.slice(replacement.end);
  }
  return {
    script,
    executableScript,
    meta: metadata.meta,
    literalMeta: metadata.literalMeta,
  };
}
