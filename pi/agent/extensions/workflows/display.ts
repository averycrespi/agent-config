import { workflowDisplayName } from "./parser.ts";
import {
  clearPartialTimer,
  displayLabel,
  expandedBodyResult,
  getResultText,
  getResultTextComponent,
  getTruncatedText,
  toolCall,
} from "../_shared/render.ts";
import { renderExecutionResult } from "../background/render.ts";

export function renderWorkflowCall(params: any, theme: any, context: any) {
  const state = (context.state ??= {});
  if (state.displayScript !== params?.script) {
    state.displayScript = params?.script;
    state.displayName = workflowDisplayName(params?.script);
  }
  return getTruncatedText(context.lastComponent, [
    toolCall(
      theme,
      "workflow",
      params?.action ?? "run",
      params?.name ??
        state.displayName ??
        (typeof params?.id === "string" ? params.id.slice(0, 8) : undefined),
    ),
  ]);
}

export function renderWorkflowResult(
  result: any,
  { isPartial, expanded }: { isPartial?: boolean; expanded?: boolean },
  theme: any,
  context: any,
) {
  clearPartialTimer(context);
  const value = result.details?.execution ?? result.details?.background;
  if (value && typeof value === "object")
    return renderExecutionResult(
      "workflow",
      Array.isArray(value) ? value : [value],
      result,
      { expanded, isPartial },
      theme,
      context,
      /^Error|^Invalid workflow input:/.test(getResultText(result)),
    );
  const text = getResultText(result);
  const failed =
    context.isError || /^Error|^Invalid workflow input:/.test(text);
  const details: string[] = [];
  let summary: string;
  if (isPartial) summary = theme.fg("muted", "starting");
  else if (failed) {
    summary = theme.fg(
      context.args?.action === "validate" ? "muted" : "error",
      "request failed",
    );
    if (expanded)
      details.push(
        ...expandedBodyResult(result).map((row) => theme.fg("text", row)),
      );
  } else if (result.details?.action === "list") {
    const inventory = result.details.inventory;
    const entries = inventory?.entries ?? [];
    summary = theme.fg(
      "muted",
      `${entries.length} saved workflow${entries.length === 1 ? "" : "s"}${inventory?.truncated ? " (truncated)" : ""}`,
    );
    if (expanded) {
      details.push(
        theme.fg("muted", "  store: ") +
          theme.fg("text", displayLabel(inventory?.storeDir ?? "unknown")),
      );
      for (const entry of entries.slice(0, 200)) {
        details.push(
          theme.fg("text", entry.valid ? "valid" : "invalid") +
            " " +
            theme.fg("text", displayLabel(entry.name ?? entry.filename)) +
            (entry.description || !entry.valid
              ? theme.fg("dim", " · ") +
                theme.fg(
                  "text",
                  displayLabel(
                    entry.valid
                      ? entry.description
                      : (entry.diagnostic ?? "invalid definition"),
                  ),
                )
              : ""),
        );
      }
      if (inventory?.truncated)
        details.push(theme.fg("warning", displayLabel(inventory.truncated)));
    }
  } else if (result.details?.action === "validate") {
    summary = theme.fg("muted", "validated (not executed)");
    if (expanded)
      details.push(
        theme.fg("muted", "  source: ") +
          theme.fg("text", displayLabel(result.details.sourceFile ?? "inline")),
      );
  } else {
    summary = theme.fg("muted", "historical result");
    if (expanded)
      details.push(
        ...expandedBodyResult(result).map((row) => theme.fg("text", row)),
      );
  }
  if (expanded && !isPartial) {
    if (result.details?.recoveryFile)
      details.push(
        theme.fg("muted", "  recovery: ") +
          theme.fg("text", displayLabel(result.details.recoveryFile, 2000)),
      );
    if (result.details?.persistenceWarning)
      details.push(
        theme.fg(
          "warning",
          displayLabel(result.details.persistenceWarning, 2000),
        ),
      );
  }
  return getResultTextComponent(context.lastComponent, [summary], details);
}
