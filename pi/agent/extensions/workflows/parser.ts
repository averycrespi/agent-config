import ts from "typescript";
import type { ParsedWorkflow, WorkflowMeta } from "./types.ts";

const FORBIDDEN_IDENTIFIERS = new Set([
  "require",
  "process",
  "global",
  "globalThis",
  "Buffer",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "importScripts",
]);

const FORBIDDEN_MODULES = new Set([
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "net",
  "node:net",
  "http",
  "node:http",
  "https",
  "node:https",
  "dgram",
  "node:dgram",
  "child_process",
  "node:child_process",
  "worker_threads",
  "node:worker_threads",
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

function readMeta(node: ts.Statement): WorkflowMeta | undefined {
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
  return { name: name.trim(), description: description.trim() };
}

function isAgentCall(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === "agent";
}

function isForbiddenModuleSpecifier(text: string): boolean {
  return FORBIDDEN_MODULES.has(text) || text.startsWith("node:");
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
  const meta = readMeta(first);
  if (!meta)
    fail("script must start with: export const meta = { name, description }");

  let hasAgentCall = false;

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
      fail("imports are not allowed");
    }
    if (ts.isExportDeclaration(node)) fail("re-exports are not allowed");
    if (ts.isCallExpression(node)) {
      if (isAgentCall(node)) hasAgentCall = true;
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
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      isForbiddenModuleSpecifier(node.moduleSpecifier.text)
    ) {
      fail(`module ${node.moduleSpecifier.text} is not allowed`);
    }
    ts.forEachChild(node, visit);
  }

  for (const statement of source.statements) visit(statement);
  if (!hasAgentCall) fail("workflow must call agent() at least once");

  const firstStart = first.getStart(source);
  const firstEnd = first.getEnd();
  const executableScript = `${script.slice(0, firstStart)}const meta = ${textOf(source, (first as ts.VariableStatement).declarationList.declarations[0].initializer!)};${script.slice(firstEnd)}`;
  return { script, executableScript, meta };
}
