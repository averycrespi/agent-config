import {
  clearPartialTimer,
  displayLabel,
  expandedResult,
  getTruncatedText,
  partialElapsed,
  plural,
  toolSummary,
} from "../_shared/render.ts";

function urlLabel(value: unknown): string {
  try {
    const url = new URL(String(value));
    return url.origin === "null" ? "URL" : displayLabel(url.origin);
  } catch {
    return "URL";
  }
}
export function webRenderers(name: "web_search" | "web_fetch") {
  const target = (args: any) =>
    name === "web_search" ? displayLabel(args?.query) : urlLabel(args?.url);
  return {
    renderCall(args: any, theme: any, context: any) {
      return getTruncatedText(context.lastComponent, [
        toolSummary(theme, name, "", "", target(args)),
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
      return getTruncatedText(context.lastComponent, [
        toolSummary(
          theme,
          name,
          "",
          outcome + (d?.spilled ? " · retained output" : ""),
          target(context.args),
          isPartial
            ? "warning"
            : failed
              ? "error"
              : unknown
                ? "warning"
                : "success",
        ),
        ...(expanded ? expandedResult(result) : []),
      ]);
    },
  };
}
