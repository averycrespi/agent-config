import {
  clearPartialTimer,
  displayLabel,
  expandedResult,
  getTruncatedText,
  partialElapsed,
  plural,
  toolCall,
  outcomeSections,
} from "../_shared/render.ts";

function urlLabel(value: unknown): string {
  try {
    const url = new URL(String(value));
    return url.origin === "null" ? "" : displayLabel(url.origin);
  } catch {
    return "";
  }
}
export function webRenderers(name: "web_search" | "web_fetch") {
  const target = (args: any) =>
    name === "web_search" ? displayLabel(args?.query) : urlLabel(args?.url);
  return {
    renderCall(args: any, theme: any, context: any) {
      return getTruncatedText(context.lastComponent, [
        toolCall(
          theme,
          name,
          "",
          name === "web_search" && target(args)
            ? `"${target(args)}"`
            : target(args),
        ),
      ]);
    },
    renderResult(
      result: any,
      { isPartial, expanded }: any,
      theme: any,
      context: any,
    ) {
      const elapsed = isPartial ? partialElapsed(context) : "";
      if (!isPartial) clearPartialTimer(context);
      const d = result.details;
      const failed = context.isError || !!d?.errorPreview;
      const unknown = d?.outcomeUnknown === true;
      const outcome = isPartial
        ? `reading${elapsed}`
        : unknown
          ? failed
            ? "failed; unknown effects; no replay"
            : "effects unknown; no replay"
          : failed
            ? "request failed"
            : name === "web_search"
              ? typeof d?.resultCount === "number"
                ? plural(d.resultCount, "result")
                : "results read"
              : d?.clonePath
                ? "repository read"
                : typeof d?.pageCount === "number"
                  ? `${plural(d.pageCount, "page")} read`
                  : "page read";
      const summary =
        !isPartial &&
        !failed &&
        !unknown &&
        ["results read", "repository read", "page read"].includes(outcome)
          ? ""
          : outcome;
      return getTruncatedText(context.lastComponent, [
        ...(summary || d?.spilled
          ? [
              outcomeSections(
                theme,
                [summary, d?.spilled ? "retained output" : ""],
                isPartial || unknown || d?.spilled
                  ? "warning"
                  : failed
                    ? "error"
                    : "muted",
              ),
            ]
          : []),
        ...(expanded ? expandedResult(result) : []),
      ]);
    },
  };
}
